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
import { useStore } from '@/lib/store/store';
import { SEED_DRUGS, SEED_PROTOCOLS } from '@/lib/data/seed';
import { getSupabaseClient } from './client';
import { importStoreSnapshotToSupabase, type ImportSummary } from './importStore';

export type PullSummary = {
  customDrugs: number;
  protocols: number;
  protocolItems: number;
  activeProtocols: number;
  scheduledDoses: number;
  doseRecords: number;
};

type SnapshotState = {
  profile: UserProfile | null;
  notificationSettings: NotificationSettings;
  protocols: Protocol[];
  activeProtocols: ActiveProtocol[];
  scheduledDoses: ScheduledDose[];
  doseRecords: DoseRecord[];
  drugs: Drug[];
};

function profileFromStoreForExport(profile: UserProfile | null): UserProfile | null {
  if (!profile) return null;
  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    timezone: profile.timezone,
    ageRange: profile.ageRange,
    onboarded: profile.onboarded,
    createdAt: profile.createdAt,
  };
}

export function buildCurrentStoreSnapshot(): SnapshotState {
  const s = useStore.getState();
  return {
    profile: profileFromStoreForExport(s.profile),
    notificationSettings: s.notificationSettings,
    protocols: s.protocols.filter(p => !p.isTemplate),
    activeProtocols: s.activeProtocols,
    scheduledDoses: s.scheduledDoses,
    doseRecords: s.doseRecords,
    drugs: s.drugs.filter(d => d.isCustom),
  };
}

export function downloadCurrentStoreSnapshot() {
  const payload = JSON.stringify({ state: buildCurrentStoreSnapshot() }, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const a = document.createElement('a');
  a.href = url;
  a.download = `medremind-store-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function backupCurrentStoreToSupabase(): Promise<ImportSummary> {
  const payload = JSON.stringify({ state: buildCurrentStoreSnapshot() });
  return importStoreSnapshotToSupabase(payload);
}

function defaultNotificationSettings(): NotificationSettings {
  return {
    pushEnabled: false,
    emailEnabled: false,
    leadTimeMin: 0,
    digestTime: '07:00',
  };
}

export async function pullStoreFromSupabase(): Promise<PullSummary> {
  const supabase = getSupabaseClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error('You must be signed in to load cloud data.');
  const user = authData.user;

  const [
    profileRes,
    notifRes,
    customDrugsRes,
    protocolsRes,
    activeRes,
    scheduledRes,
    recordsRes,
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase.from('notification_settings').select('*').eq('user_id', user.id).maybeSingle(),
    supabase.from('drugs').select('*').eq('created_by', user.id).eq('is_custom', true),
    supabase.from('protocols').select('*').eq('owner_id', user.id),
    supabase.from('active_protocols').select('*').eq('user_id', user.id),
    supabase.from('scheduled_doses').select('*').eq('user_id', user.id),
    supabase.from('dose_records').select('*').eq('user_id', user.id),
  ]);

  if (profileRes.error) {
    throw new Error(`Profile read failed: ${profileRes.error.message}`);
  }
  if (notifRes.error) {
    throw new Error(`Notification settings read failed: ${notifRes.error.message}`);
  }
  if (customDrugsRes.error) throw new Error(`Custom drugs read failed: ${customDrugsRes.error.message}`);
  if (protocolsRes.error) throw new Error(`Protocols read failed: ${protocolsRes.error.message}`);
  if (activeRes.error) throw new Error(`Active protocols read failed: ${activeRes.error.message}`);
  if (scheduledRes.error) throw new Error(`Scheduled doses read failed: ${scheduledRes.error.message}`);
  if (recordsRes.error) throw new Error(`Dose records read failed: ${recordsRes.error.message}`);

  const ownedProtocolsRaw = (protocolsRes.data ?? []) as Record<string, unknown>[];
  const activeProtocolRows = (activeRes.data ?? []) as Record<string, unknown>[];
  const activeProtocolIds = activeProtocolRows.map(row => String(row.protocol_id));
  const ownedProtocolIds = ownedProtocolsRaw.map(p => String(p.id));
  const missingActiveProtocolIds = activeProtocolIds.filter(id => !ownedProtocolIds.includes(id));

  const extraProtocolsRes = missingActiveProtocolIds.length
    ? await supabase.from('protocols').select('*').in('id', missingActiveProtocolIds)
    : { data: [], error: null as { message: string } | null };
  if (extraProtocolsRes.error) throw new Error(`Active protocol templates read failed: ${extraProtocolsRes.error.message}`);

  const cloudProtocolsRaw = [...ownedProtocolsRaw, ...((extraProtocolsRes.data ?? []) as Record<string, unknown>[])];
  const cloudProtocolIds = Array.from(new Set(cloudProtocolsRaw.map(p => String(p.id))));

  const protocolItemsRes = cloudProtocolIds.length
    ? await supabase.from('protocol_items').select('*').in('protocol_id', cloudProtocolIds)
    : { data: [], error: null as { message: string } | null };

  if (protocolItemsRes.error) throw new Error(`Protocol items read failed: ${protocolItemsRes.error.message}`);

  const itemsByProtocol = new Map<string, ProtocolItem[]>();
  for (const row of (protocolItemsRes.data ?? []) as Record<string, unknown>[]) {
    const protocolId = String(row.protocol_id);
    const item: ProtocolItem = {
      id: String(row.id),
      protocolId,
      itemType: String(row.item_type) as ProtocolItem['itemType'],
      name: String(row.name ?? ''),
      drugId: row.drug_id ? String(row.drug_id) : undefined,
      doseAmount: typeof row.dose_amount === 'number' ? row.dose_amount : row.dose_amount ? Number(row.dose_amount) : undefined,
      doseUnit: row.dose_unit ? String(row.dose_unit) : undefined,
      doseForm: row.dose_form ? String(row.dose_form) as ProtocolItem['doseForm'] : undefined,
      route: row.route ? String(row.route) as ProtocolItem['route'] : undefined,
      frequencyType: String(row.frequency_type) as ProtocolItem['frequencyType'],
      frequencyValue: typeof row.frequency_value === 'number' ? row.frequency_value : row.frequency_value ? Number(row.frequency_value) : undefined,
      times: Array.isArray(row.times) ? (row.times.map(v => String(v))) : [],
      withFood: row.with_food ? String(row.with_food) as ProtocolItem['withFood'] : undefined,
      instructions: row.instructions ? String(row.instructions) : undefined,
      startDay: typeof row.start_day === 'number' ? row.start_day : Number(row.start_day ?? 1),
      endDay: typeof row.end_day === 'number' ? row.end_day : row.end_day ? Number(row.end_day) : undefined,
      sortOrder: typeof row.sort_order === 'number' ? row.sort_order : Number(row.sort_order ?? 0),
      icon: row.icon ? String(row.icon) : undefined,
      color: row.color ? String(row.color) : undefined,
    };
    const list = itemsByProtocol.get(protocolId) ?? [];
    list.push(item);
    itemsByProtocol.set(protocolId, list);
  }

  const cloudProtocols: Protocol[] = cloudProtocolsRaw.map(row => ({
    id: String(row.id),
    ownerId: row.owner_id ? String(row.owner_id) : undefined,
    name: String(row.name ?? ''),
    description: row.description ? String(row.description) : undefined,
    category: String(row.category ?? 'custom') as Protocol['category'],
    durationDays: typeof row.duration_days === 'number' ? row.duration_days : row.duration_days ? Number(row.duration_days) : undefined,
    isTemplate: Boolean(row.is_template),
    isArchived: Boolean(row.is_archived),
    items: itemsByProtocol.get(String(row.id)) ?? [],
    createdAt: row.created_at ? String(row.created_at) : new Date().toISOString(),
  }));

  const allProtocols = [...SEED_PROTOCOLS, ...cloudProtocols];
  const protocolMap = new Map<string, Protocol>(allProtocols.map(p => [p.id, p]));
  const itemMap = new Map<string, ProtocolItem>();
  for (const p of allProtocols) {
    for (const i of p.items) itemMap.set(i.id, i);
  }

  const activeProtocols: ActiveProtocol[] = activeProtocolRows
    .map(row => {
      const protocolId = String(row.protocol_id);
      const protocol = protocolMap.get(protocolId);
      if (!protocol) return null;
      return {
        id: String(row.id),
        userId: String(row.user_id),
        protocolId,
        protocol,
        status: String(row.status) as ActiveProtocol['status'],
        startDate: String(row.start_date),
        endDate: row.end_date ? String(row.end_date) : undefined,
        pausedAt: row.paused_at ? String(row.paused_at) : undefined,
        completedAt: row.completed_at ? String(row.completed_at) : undefined,
        notes: row.notes ? String(row.notes) : undefined,
        createdAt: row.created_at ? String(row.created_at) : new Date().toISOString(),
      };
    })
    .filter(Boolean) as ActiveProtocol[];

  const activeMap = new Map<string, ActiveProtocol>(activeProtocols.map(ap => [ap.id, ap]));

  const scheduledDoses: ScheduledDose[] = ((scheduledRes.data ?? []) as Record<string, unknown>[])
    .map(row => {
      const activeId = String(row.active_protocol_id);
      const itemId = String(row.protocol_item_id);
      const activeProtocol = activeMap.get(activeId);
      const protocolItem = itemMap.get(itemId);
      if (!activeProtocol || !protocolItem) return null;
      return {
        id: String(row.id),
        userId: String(row.user_id),
        activeProtocolId: activeId,
        protocolItemId: itemId,
        protocolItem,
        activeProtocol,
        scheduledDate: String(row.scheduled_date),
        scheduledTime: String(row.scheduled_time).slice(0, 5),
        status: String(row.status) as ScheduledDose['status'],
        snoozedUntil: row.snoozed_until ? String(row.snoozed_until) : undefined,
      };
    })
    .filter(Boolean) as ScheduledDose[];

  const doseRecords: DoseRecord[] = ((recordsRes.data ?? []) as Record<string, unknown>[])
    .map(row => ({
      id: String(row.id),
      userId: String(row.user_id),
      scheduledDoseId: String(row.scheduled_dose_id),
      action: String(row.action) as DoseRecord['action'],
      recordedAt: row.recorded_at ? String(row.recorded_at) : new Date().toISOString(),
      note: row.note ? String(row.note) : undefined,
    }));

  const profileRow = profileRes.data as Record<string, unknown> | null;
  const profile: UserProfile = {
    id: user.id,
    email: user.email ?? '',
    name: profileRow?.name ? String(profileRow.name) : String(user.user_metadata?.name ?? user.email?.split('@')[0] ?? 'User'),
    timezone: profileRow?.timezone ? String(profileRow.timezone) : Intl.DateTimeFormat().resolvedOptions().timeZone,
    ageRange: profileRow?.age_range ? String(profileRow.age_range) as UserProfile['ageRange'] : undefined,
    onboarded: profileRow?.onboarded ? Boolean(profileRow.onboarded) : false,
    createdAt: user.created_at,
  };

  const nRow = notifRes.data as Record<string, unknown> | null;
  const notificationSettings: NotificationSettings = nRow
    ? {
        pushEnabled: Boolean(nRow.push_enabled),
        emailEnabled: Boolean(nRow.email_enabled),
        leadTimeMin: Number(nRow.lead_time_min ?? 0),
        digestTime: String(nRow.digest_time ?? '07:00').slice(0, 5),
      }
    : defaultNotificationSettings();

  const customDrugs: Drug[] = ((customDrugsRes.data ?? []) as Record<string, unknown>[]).map(row => ({
    id: String(row.id),
    name: String(row.name ?? ''),
    genericName: row.generic_name ? String(row.generic_name) : undefined,
    category: row.category ? String(row.category) : undefined,
    commonDoses: Array.isArray(row.common_doses) ? (row.common_doses as Drug['commonDoses']) : undefined,
    routes: Array.isArray(row.routes) ? (row.routes as Drug['routes']) : undefined,
    notes: row.notes ? String(row.notes) : undefined,
    isCustom: Boolean(row.is_custom),
    createdBy: row.created_by ? String(row.created_by) : undefined,
  }));

  useStore.setState({
    profile,
    notificationSettings,
    protocols: allProtocols,
    activeProtocols,
    scheduledDoses,
    doseRecords,
    drugs: [...SEED_DRUGS, ...customDrugs],
  });

  return {
    customDrugs: customDrugs.length,
    protocols: cloudProtocols.length,
    protocolItems: (protocolItemsRes.data ?? []).length,
    activeProtocols: activeProtocols.length,
    scheduledDoses: scheduledDoses.length,
    doseRecords: doseRecords.length,
  };
}
