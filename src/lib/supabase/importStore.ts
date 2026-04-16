'use client';

import type {
  ActiveProtocol,
  DoseRecord,
  Drug,
  NotificationSettings,
  Protocol,
  ProtocolItem,
  ScheduledDose,
  UserProfile,
} from '@/types';
import { getSupabaseClient } from './client';

type PersistedStoreState = {
  profile?: UserProfile | null;
  notificationSettings?: NotificationSettings;
  protocols?: Protocol[];
  activeProtocols?: ActiveProtocol[];
  scheduledDoses?: ScheduledDose[];
  doseRecords?: DoseRecord[];
  drugs?: Drug[];
};

type PersistedEnvelope = {
  state?: PersistedStoreState;
};

export type ImportSummary = {
  customDrugs: number;
  protocols: number;
  protocolItems: number;
  activeProtocols: number;
  scheduledDoses: number;
  doseRecords: number;
};

function isUuid(value: string | undefined | null): value is string {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function hash32(input: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function stableUuid(namespace: string, source: string): string {
  const input = `${namespace}:${source}`;
  const p1 = hash32(input, 0x811c9dc5).toString(16).padStart(8, '0');
  const p2 = hash32(input, 0x9e3779b9).toString(16).padStart(8, '0');
  const p3 = hash32(input, 0x85ebca6b).toString(16).padStart(8, '0');
  const p4 = hash32(input, 0xc2b2ae35).toString(16).padStart(8, '0');
  const hex = `${p1}${p2}${p3}${p4}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function toIso(value: string | undefined | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function parseStore(raw: string): PersistedStoreState {
  const parsed = JSON.parse(raw) as PersistedEnvelope | PersistedStoreState;
  if (parsed && typeof parsed === 'object' && 'state' in parsed) {
    return (parsed.state ?? {}) as PersistedStoreState;
  }
  return (parsed ?? {}) as PersistedStoreState;
}

export async function importStoreSnapshotToSupabase(raw: string): Promise<ImportSummary> {
  const supabase = getSupabaseClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error('You must be signed in to import data.');
  const userId = authData.user.id;
  const state = parseStore(raw);

  const summary: ImportSummary = {
    customDrugs: 0,
    protocols: 0,
    protocolItems: 0,
    activeProtocols: 0,
    scheduledDoses: 0,
    doseRecords: 0,
  };

  const profilePatch = state.profile ?? null;
  const notifPatch = state.notificationSettings ?? null;

  if (profilePatch) {
    const { error } = await supabase.from('profiles').upsert({
      id: userId,
      name: profilePatch.name ?? authData.user.user_metadata?.name ?? authData.user.email?.split('@')[0] ?? 'User',
      timezone: profilePatch.timezone ?? 'UTC',
      age_range: profilePatch.ageRange ?? null,
      onboarded: Boolean(profilePatch.onboarded),
    });
    if (error) throw new Error(`Profile import failed: ${error.message}`);
  }

  if (notifPatch) {
    const { error } = await supabase.from('notification_settings').upsert({
      user_id: userId,
      push_enabled: Boolean(notifPatch.pushEnabled),
      email_enabled: Boolean(notifPatch.emailEnabled),
      lead_time_min: Number.isFinite(notifPatch.leadTimeMin) ? notifPatch.leadTimeMin : 0,
      digest_time: notifPatch.digestTime || '07:00',
    });
    if (error) throw new Error(`Notification settings import failed: ${error.message}`);
  }

  const customDrugs = (state.drugs ?? []).filter(d => d.isCustom);
  const drugIdMap = new Map<string, string>();
  if (customDrugs.length) {
    const rows = customDrugs.map(d => {
      const newId = isUuid(d.id) ? d.id : stableUuid(`drug:${userId}`, d.id);
      drugIdMap.set(d.id, newId);
      return {
        id: newId,
        name: d.name,
        generic_name: d.genericName ?? null,
        category: d.category ?? null,
        common_doses: d.commonDoses ?? null,
        routes: d.routes ?? null,
        notes: d.notes ?? null,
        is_custom: true,
        created_by: userId,
      };
    });
    for (const part of chunk(rows, 200)) {
      const { error } = await supabase.from('drugs').upsert(part, { onConflict: 'id' });
      if (error) throw new Error(`Custom drugs import failed: ${error.message}`);
    }
    summary.customDrugs = rows.length;
  }

  const protocolSources = new Map<string, Protocol>();
  for (const p of state.protocols ?? []) protocolSources.set(p.id, p);
  for (const ap of state.activeProtocols ?? []) {
    if (ap.protocol) protocolSources.set(ap.protocol.id, ap.protocol);
  }

  const protocolIdMap = new Map<string, string>();
  const protocolItemIdMap = new Map<string, string>();

  const protocolRows: Record<string, unknown>[] = [];
  const protocolItemRows: Record<string, unknown>[] = [];

  for (const protocol of protocolSources.values()) {
    const newProtocolId = isUuid(protocol.id) ? protocol.id : stableUuid(`protocol:${userId}`, protocol.id);
    protocolIdMap.set(protocol.id, newProtocolId);

    protocolRows.push({
      id: newProtocolId,
      owner_id: userId,
      name: protocol.name,
      description: protocol.description ?? null,
      category: protocol.category ?? 'custom',
      duration_days: protocol.durationDays ?? null,
      is_template: false,
      is_archived: Boolean(protocol.isArchived),
      created_at: toIso(protocol.createdAt) ?? new Date().toISOString(),
    });

    for (const item of protocol.items ?? []) {
      const newItemId = isUuid(item.id)
        ? item.id
        : stableUuid(`protocol-item:${newProtocolId}`, item.id);
      protocolItemIdMap.set(item.id, newItemId);
      const mappedDrugId = item.drugId
        ? (drugIdMap.get(item.drugId) ?? (isUuid(item.drugId) ? item.drugId : null))
        : null;

      protocolItemRows.push({
        id: newItemId,
        protocol_id: newProtocolId,
        item_type: item.itemType,
        name: item.name,
        drug_id: mappedDrugId,
        analysis_id: null,
        dose_amount: item.doseAmount ?? null,
        dose_unit: item.doseUnit ?? null,
        dose_form: item.doseForm ?? null,
        route: item.route ?? null,
        frequency_type: item.frequencyType,
        frequency_value: item.frequencyValue ?? null,
        times: item.times ?? [],
        with_food: item.withFood ?? null,
        instructions: item.instructions ?? null,
        start_day: item.startDay ?? 1,
        end_day: item.endDay ?? null,
        sort_order: item.sortOrder ?? 0,
        icon: item.icon ?? null,
        color: item.color ?? null,
      });
    }
  }

  if (protocolRows.length) {
    for (const part of chunk(protocolRows, 100)) {
      const { error } = await supabase.from('protocols').upsert(part, { onConflict: 'id' });
      if (error) throw new Error(`Protocols import failed: ${error.message}`);
    }
    summary.protocols = protocolRows.length;
  }

  if (protocolItemRows.length) {
    for (const part of chunk(protocolItemRows, 250)) {
      const { error } = await supabase.from('protocol_items').upsert(part, { onConflict: 'id' });
      if (error) throw new Error(`Protocol items import failed: ${error.message}`);
    }
    summary.protocolItems = protocolItemRows.length;
  }

  const activeIdMap = new Map<string, string>();
  const activeRows = (state.activeProtocols ?? [])
    .map(ap => {
      const mappedProtocolId = protocolIdMap.get(ap.protocolId) ?? null;
      if (!mappedProtocolId) return null;
      const newActiveId = isUuid(ap.id) ? ap.id : stableUuid(`active:${userId}`, ap.id);
      activeIdMap.set(ap.id, newActiveId);
      return {
        id: newActiveId,
        user_id: userId,
        protocol_id: mappedProtocolId,
        status: ap.status,
        start_date: ap.startDate,
        end_date: ap.endDate ?? null,
        paused_at: toIso(ap.pausedAt),
        completed_at: toIso(ap.completedAt),
        notes: ap.notes ?? null,
        created_at: toIso(ap.createdAt) ?? new Date().toISOString(),
      };
    })
    .filter(Boolean) as Record<string, unknown>[];

  if (activeRows.length) {
    for (const part of chunk(activeRows, 200)) {
      const { error } = await supabase.from('active_protocols').upsert(part, { onConflict: 'id' });
      if (error) throw new Error(`Active protocols import failed: ${error.message}`);
    }
    summary.activeProtocols = activeRows.length;
  }

  const doseIdMap = new Map<string, string>();
  const scheduledRows = (state.scheduledDoses ?? [])
    .map(d => {
      const mappedActiveId = activeIdMap.get(d.activeProtocolId) ?? null;
      const mappedItemId = protocolItemIdMap.get(d.protocolItemId) ?? null;
      if (!mappedActiveId || !mappedItemId) return null;
      const newDoseId = isUuid(d.id) ? d.id : stableUuid(`dose:${mappedActiveId}`, d.id);
      doseIdMap.set(d.id, newDoseId);
      return {
        id: newDoseId,
        user_id: userId,
        active_protocol_id: mappedActiveId,
        protocol_item_id: mappedItemId,
        scheduled_date: d.scheduledDate,
        scheduled_time: d.scheduledTime,
        status: d.status,
        snoozed_until: toIso(d.snoozedUntil),
      };
    })
    .filter(Boolean) as Record<string, unknown>[];

  if (scheduledRows.length) {
    for (const part of chunk(scheduledRows, 250)) {
      const { error } = await supabase.from('scheduled_doses').upsert(part, {
        onConflict: 'active_protocol_id,protocol_item_id,scheduled_date,scheduled_time',
      });
      if (error) throw new Error(`Scheduled doses import failed: ${error.message}`);
    }
    summary.scheduledDoses = scheduledRows.length;
  }

  const recordRows = (state.doseRecords ?? [])
    .map(r => {
      const mappedDoseId = doseIdMap.get(r.scheduledDoseId) ?? null;
      if (!mappedDoseId) return null;
      const newRecordId = isUuid(r.id) ? r.id : stableUuid(`record:${userId}`, r.id);
      return {
        id: newRecordId,
        user_id: userId,
        scheduled_dose_id: mappedDoseId,
        action: r.action,
        recorded_at: toIso(r.recordedAt) ?? new Date().toISOString(),
        note: r.note ?? null,
      };
    })
    .filter(Boolean) as Record<string, unknown>[];

  if (recordRows.length) {
    for (const part of chunk(recordRows, 250)) {
      const { error } = await supabase.from('dose_records').upsert(part, { onConflict: 'id' });
      if (error) throw new Error(`Dose records import failed: ${error.message}`);
    }
    summary.doseRecords = recordRows.length;
  }

  return summary;
}
