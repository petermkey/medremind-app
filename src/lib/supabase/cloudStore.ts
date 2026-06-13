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
import { addDays, format } from 'date-fns';
import { useStore } from '@/lib/store/store';
import { doseSlotKey } from '@/lib/store/storeHelpers';
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

type CloudRowsResult = {
  data: Record<string, unknown>[];
  error: { message: string } | null;
};

const CLOUD_PULL_PAGE_SIZE = 1000;

type OccurrenceRow = Record<string, unknown>;

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

async function fetchAllUserRows(
  supabase: ReturnType<typeof getSupabaseClient>,
  tableName: string,
  userId: string,
  orderBy: string[],
): Promise<CloudRowsResult> {
  const rows: Record<string, unknown>[] = [];
  type CloudRangeQuery = {
    order: (column: string, options: { ascending: boolean }) => CloudRangeQuery;
    range: (from: number, to: number) => Promise<CloudRowsResult>;
  };
  const client = supabase as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          order: (column: string, options: { ascending: boolean }) => CloudRangeQuery;
        };
      };
    };
  };

  for (let from = 0; ; from += CLOUD_PULL_PAGE_SIZE) {
    let query = client
      .from(tableName)
      .select('*')
      .eq('user_id', userId)
      .order(orderBy[0] ?? 'id', { ascending: true });
    for (const column of orderBy.slice(1)) {
      query = query.order(column, { ascending: true });
    }
    const page = await query.range(from, from + CLOUD_PULL_PAGE_SIZE - 1);

    if (page.error) return { data: rows, error: page.error };
    rows.push(...(page.data ?? []));
    if ((page.data ?? []).length < CLOUD_PULL_PAGE_SIZE) break;
  }

  return { data: rows, error: null };
}

// V2: paginated fetch of planned_occurrences with nested execution_events.
// Uses unknown-cast because planned_occurrences is not in the generated schema types.
// Cancelled occurrences are only worth pulling for two reasons: today/future
// removal tombstones (so rolling-horizon regeneration won't recreate a
// removed slot) and cancelled-with-events (history-safe removeDose keeps the
// action). Past cancelled-no-event rows — the bulk left by lifecycle cleanup
// migrations — are pure boot-time payload weight. This query keeps
// non-cancelled rows (any date) plus today/future cancelled; the small
// cancelled-with-events history set is fetched separately via an inner join.
const V2_SELECT = 'id, user_id, active_protocol_id, protocol_item_id, occurrence_date, occurrence_time, status, execution_events(id, event_type, event_at, note)';

type V2RangeQuery = {
  order: (column: string, options: { ascending: boolean }) => V2RangeQuery;
  range: (from: number, to: number) => Promise<{ data: OccurrenceRow[] | null; error: { message: string } | null }>;
};

async function paginate(
  build: (from: number, to: number) => Promise<{ data: OccurrenceRow[] | null; error: { message: string } | null }>,
): Promise<{ data: OccurrenceRow[]; error: { message: string } | null }> {
  const rows: OccurrenceRow[] = [];
  for (let from = 0; ; from += CLOUD_PULL_PAGE_SIZE) {
    const page = await build(from, from + CLOUD_PULL_PAGE_SIZE - 1);
    if (page.error) return { data: rows, error: page.error };
    rows.push(...(page.data ?? []));
    if ((page.data ?? []).length < CLOUD_PULL_PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}

async function fetchAllOccurrencesWithEvents(
  supabase: ReturnType<typeof getSupabaseClient>,
  userId: string,
): Promise<{ data: OccurrenceRow[]; error: { message: string } | null }> {
  const todayDate = format(new Date(), 'yyyy-MM-dd');
  const client = supabase as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          is: (column: string, value: null) => { or: (filter: string) => V2RangeQuery } & V2RangeQuery;
        };
      };
    };
  };

  const ordered = (q: V2RangeQuery): V2RangeQuery =>
    q.order('occurrence_date', { ascending: true })
      .order('occurrence_time', { ascending: true })
      .order('id', { ascending: true });

  // Main set: everything except past cancelled tombstones.
  const main = await paginate((from, to) =>
    ordered(
      client
        .from('planned_occurrences')
        .select(V2_SELECT)
        .eq('user_id', userId)
        .is('superseded_by_occurrence_id', null)
        .or(`status.neq.cancelled,occurrence_date.gte.${todayDate}`),
    ).range(from, to),
  );
  if (main.error) return main;

  // History recovery: cancelled occurrences that still carry an action
  // (inner join → only rows with ≥1 execution_event). Small, rarely paged.
  const innerClient = supabase as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          eq: (column: string, value: string) => {
            is: (column: string, value: null) => V2RangeQuery;
          };
        };
      };
    };
  };
  const cancelledHistory = await paginate((from, to) =>
    ordered(
      innerClient
        .from('planned_occurrences')
        .select('id, user_id, active_protocol_id, protocol_item_id, occurrence_date, occurrence_time, status, execution_events!inner(id, event_type, event_at, note)')
        .eq('user_id', userId)
        .eq('status', 'cancelled')
        .is('superseded_by_occurrence_id', null),
    ).range(from, to),
  );
  if (cancelledHistory.error) return cancelledHistory;

  const seen = new Set(main.data.map(row => String(row.id)));
  const merged = main.data.concat(cancelledHistory.data.filter(row => !seen.has(String(row.id))));
  return { data: merged, error: null };
}

// Fallback for execution_events written without planned_occurrence_id
// (all client writes before the linking fix): they are invisible to the
// nested embed above, so fetch them separately and match by slot.
async function fetchUnlinkedExecutionEvents(
  supabase: ReturnType<typeof getSupabaseClient>,
  userId: string,
): Promise<{ data: OccurrenceRow[]; error: { message: string } | null }> {
  const rows: OccurrenceRow[] = [];
  type UnlinkedQuery = {
    order: (column: string, options: { ascending: boolean }) => UnlinkedQuery;
    range: (from: number, to: number) => Promise<{ data: OccurrenceRow[] | null; error: { message: string } | null }>;
  };
  const client = supabase as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          is: (column: string, value: null) => UnlinkedQuery;
        };
      };
    };
  };

  for (let from = 0; ; from += CLOUD_PULL_PAGE_SIZE) {
    const query = client
      .from('execution_events')
      .select('id, protocol_item_id, event_type, event_at, effective_date, effective_time, note')
      .eq('user_id', userId)
      .is('planned_occurrence_id', null)
      .order('event_at', { ascending: true });
    const page = await query.range(from, from + CLOUD_PULL_PAGE_SIZE - 1);

    if (page.error) return { data: rows, error: page.error };
    rows.push(...(page.data ?? []));
    if ((page.data ?? []).length < CLOUD_PULL_PAGE_SIZE) break;
  }

  return { data: rows, error: null };
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
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase.from('notification_settings').select('*').eq('user_id', user.id).maybeSingle(),
    supabase.from('drugs').select('*').eq('created_by', user.id).eq('is_custom', true),
    supabase.from('protocols').select('*').eq('owner_id', user.id),
    supabase.from('active_protocols').select('*').eq('user_id', user.id),
  ]);

  // V2 Phase 1 step 3: read from planned_occurrences + execution_events.
  const occurrencesRes = await fetchAllOccurrencesWithEvents(supabase, user.id);
  const unlinkedEventsRes = await fetchUnlinkedExecutionEvents(supabase, user.id);

  if (profileRes.error) {
    throw new Error(`Profile read failed: ${profileRes.error.message}`);
  }
  if (notifRes.error) {
    throw new Error(`Notification settings read failed: ${notifRes.error.message}`);
  }
  if (customDrugsRes.error) throw new Error(`Custom drugs read failed: ${customDrugsRes.error.message}`);
  if (protocolsRes.error) throw new Error(`Protocols read failed: ${protocolsRes.error.message}`);
  if (activeRes.error) throw new Error(`Active protocols read failed: ${activeRes.error.message}`);
  if (occurrencesRes.error) throw new Error(`Occurrences read failed: ${occurrencesRes.error.message}`);
  if (unlinkedEventsRes.error) throw new Error(`Unlinked events read failed: ${unlinkedEventsRes.error.message}`);

  const ownedProtocolsRaw = (protocolsRes.data ?? []) as Record<string, unknown>[];
  const activeProtocolRows = (activeRes.data ?? []) as Record<string, unknown>[];
  const activeProtocolIds = activeProtocolRows.map(row => String(row.protocol_id));
  const activeProtocolIdSet = new Set(activeProtocolIds);
  const seedTemplateKeys = new Set(
    SEED_PROTOCOLS.map(p => `${p.name.toLowerCase()}|${p.category}`),
  );
  const isLikelyMirroredTemplate = (row: Record<string, unknown>) => {
    const key = `${String(row.name ?? '').toLowerCase()}|${String(row.category ?? 'custom')}`;
    return seedTemplateKeys.has(key) && activeProtocolIdSet.has(String(row.id));
  };
  const visibleOwnedProtocolsRaw = ownedProtocolsRaw.filter(row => !isLikelyMirroredTemplate(row));
  const ownedProtocolIds = visibleOwnedProtocolsRaw.map(p => String(p.id));
  const missingActiveProtocolIds = activeProtocolIds.filter(id => !ownedProtocolIds.includes(id));

  const extraProtocolsRes = missingActiveProtocolIds.length
    ? await supabase.from('protocols').select('*').in('id', missingActiveProtocolIds)
    : { data: [], error: null as { message: string } | null };
  if (extraProtocolsRes.error) throw new Error(`Active protocol templates read failed: ${extraProtocolsRes.error.message}`);

  const cloudProtocolsRaw = [...visibleOwnedProtocolsRaw, ...((extraProtocolsRes.data ?? []) as Record<string, unknown>[])];
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

  const activeCandidates: ActiveProtocol[] = activeProtocolRows
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

  const statusRank: Record<ActiveProtocol['status'], number> = {
    active: 3,
    paused: 2,
    completed: 1,
    abandoned: 0,
  };
  const seedTemplateKeysForActive = new Set(
    SEED_PROTOCOLS.map(p => `${p.name.toLowerCase()}|${p.category}`),
  );
  const activeGroupKey = (candidate: ActiveProtocol) => {
    const templateKey = `${candidate.protocol.name.toLowerCase()}|${candidate.protocol.category}`;
    if (seedTemplateKeysForActive.has(templateKey)) return `seed:${templateKey}`;
    return `protocol:${candidate.protocolId}`;
  };

  const canonicalByGroup = new Map<string, ActiveProtocol>();
  const groupByProtocolId = new Map<string, string>();
  for (const candidate of activeCandidates) {
    const group = activeGroupKey(candidate);
    groupByProtocolId.set(candidate.protocolId, group);
    const existing = canonicalByGroup.get(group);
    if (!existing) {
      canonicalByGroup.set(group, candidate);
      continue;
    }
    const existingRank = statusRank[existing.status] ?? 0;
    const candidateRank = statusRank[candidate.status] ?? 0;
    const existingTs = Date.parse(existing.createdAt || '');
    const candidateTs = Date.parse(candidate.createdAt || '');
    if (
      candidateRank > existingRank ||
      (candidateRank === existingRank && (Number.isFinite(candidateTs) ? candidateTs : 0) > (Number.isFinite(existingTs) ? existingTs : 0))
    ) {
      canonicalByGroup.set(group, candidate);
    }
  }

  const activeProtocols = Array.from(canonicalByGroup.values());
  const activeAliasMap = new Map<string, ActiveProtocol>();
  for (const candidate of activeCandidates) {
    const group = groupByProtocolId.get(candidate.protocolId);
    const canonical = group ? canonicalByGroup.get(group) : undefined;
    if (canonical) {
      activeAliasMap.set(candidate.id, canonical);
    }
  }

  // V2 Phase 1 step 3: map planned_occurrences → ScheduledDose[].
  // snoozedUntil is omitted — V2 models snooze via occurrence revision, not a timestamp field.
  const doseRecords: DoseRecord[] = [];
  const droppedOccurrences: Record<string, unknown>[] = [];
  // Cancelled occurrences without events are removal tombstones: excluded
  // from the schedule, and their slots must not be recreated by the
  // rolling-horizon regeneration below.
  const removedSlotKeys = new Set<string>();
  const scheduledDoses: ScheduledDose[] = occurrencesRes.data
    .map(row => {
      const sourceActiveId = String(row.active_protocol_id);
      const itemId = String(row.protocol_item_id);
      const activeProtocol = activeAliasMap.get(sourceActiveId);
      const protocolItem = itemMap.get(itemId);
      if (!activeProtocol || !protocolItem) {
        // Common causes: duplicate active-protocol instance conflict, orphaned protocol item.
        droppedOccurrences.push({ id: String(row.id), date: String(row.occurrence_date), status: String(row.status), activeProtocolId: sourceActiveId, protocolItemId: itemId, missingActiveProtocol: !activeProtocol, missingProtocolItem: !protocolItem });
        return null;
      }

      const events = (row.execution_events as Record<string, unknown>[] | null) ?? [];
      const latestEvent = events.slice().sort((a, b) =>
        String(b.event_at ?? '').localeCompare(String(a.event_at ?? '')),
      )[0];
      const occStatus = String(row.status);
      if (occStatus === 'cancelled' && !latestEvent) {
        removedSlotKeys.add(doseSlotKey(itemId, String(row.occurrence_date), String(row.occurrence_time)));
        return null;
      }
      // cancelled-without-event already returned null above, so a missing
      // latestEvent here always means a live planned slot.
      const derivedStatus: ScheduledDose['status'] = latestEvent
        ? (String(latestEvent.event_type) as ScheduledDose['status'])
        : 'pending';

      // Collect execution_events as DoseRecord equivalents.
      for (const ev of events) {
        doseRecords.push({
          id: String(ev.id),
          userId: String(row.user_id),
          scheduledDoseId: String(row.id),  // planned_occurrence.id
          action: String(ev.event_type) as DoseRecord['action'],
          recordedAt: ev.event_at ? String(ev.event_at) : new Date().toISOString(),
          note: ev.note ? String(ev.note) : undefined,
        });
      }

      return {
        id: String(row.id),
        userId: String(row.user_id),
        activeProtocolId: activeProtocol.id,
        protocolItemId: itemId,
        protocolItem,
        activeProtocol,
        scheduledDate: String(row.occurrence_date),
        scheduledTime: String(row.occurrence_time).slice(0, 5),
        status: derivedStatus,
        snoozedUntil: undefined,
      };
    })
    .filter(Boolean) as ScheduledDose[];

  if (droppedOccurrences.length > 0) {
    // One consolidated warning per boot instead of one line per occurrence.
    console.warn(
      '[cloud-pull-occurrences-dropped]',
      { count: droppedOccurrences.length, sample: droppedOccurrences.slice(0, 3) },
    );
  }

  // Apply unlinked events (written before the planned_occurrence_id linking
  // fix) by slot match: protocol item + date + time. Only terminal actions —
  // snooze states are reconstructed from occurrence lineage, not from events.
  const unlinkedBySlot = new Map<string, Record<string, unknown>[]>();
  for (const ev of unlinkedEventsRes.data) {
    const evType = String(ev.event_type);
    if (evType !== 'taken' && evType !== 'skipped') continue;
    if (!ev.effective_date || !ev.effective_time) continue;
    const slot = `${String(ev.protocol_item_id)}|${String(ev.effective_date)}|${String(ev.effective_time).slice(0, 5)}`;
    const list = unlinkedBySlot.get(slot) ?? [];
    list.push(ev);
    unlinkedBySlot.set(slot, list);
  }
  if (unlinkedBySlot.size > 0) {
    for (const dose of scheduledDoses) {
      if (dose.status !== 'pending') continue;
      const events = unlinkedBySlot.get(`${dose.protocolItemId}|${dose.scheduledDate}|${dose.scheduledTime}`);
      if (!events?.length) continue;
      const latest = events.slice().sort((a, b) =>
        String(b.event_at ?? '').localeCompare(String(a.event_at ?? '')),
      )[0];
      dose.status = String(latest.event_type) as ScheduledDose['status'];
      for (const ev of events) {
        doseRecords.push({
          id: String(ev.id),
          userId: user.id,
          scheduledDoseId: dose.id,
          action: String(ev.event_type) as DoseRecord['action'],
          recordedAt: ev.event_at ? String(ev.event_at) : new Date().toISOString(),
          note: ev.note ? String(ev.note) : undefined,
        });
      }
    }
  }

  // Defensive slot dedupe: parallel rows for the same slot can still reach
  // here (legacy-keyed + write-through rows, or duplicate protocol instances
  // aliased onto one canonical instance). Keep the row that carries history
  // (non-pending status), drop the rest and re-point their dose records.
  const slotWinners = new Map<string, ScheduledDose>();
  const slotOf = (d: ScheduledDose) =>
    `${d.activeProtocolId}|${d.protocolItemId}|${d.scheduledDate}|${d.scheduledTime}`;
  for (const dose of scheduledDoses) {
    const slot = slotOf(dose);
    const current = slotWinners.get(slot);
    if (!current || (dose.status !== 'pending' && current.status === 'pending')) {
      slotWinners.set(slot, dose);
    }
  }
  let dedupedDoses = scheduledDoses;
  if (slotWinners.size < scheduledDoses.length) {
    const loserToWinner = new Map<string, string>();
    for (const dose of scheduledDoses) {
      const winner = slotWinners.get(slotOf(dose));
      if (winner && winner.id !== dose.id) loserToWinner.set(dose.id, winner.id);
    }
    dedupedDoses = scheduledDoses.filter(d => !loserToWinner.has(d.id));
    for (const record of doseRecords) {
      const winnerId = loserToWinner.get(record.scheduledDoseId);
      if (winnerId) record.scheduledDoseId = winnerId;
    }
    console.warn('[cloud-pull-slot-dedupe]', { dropped: loserToWinner.size });
  }

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
    scheduledDoses: dedupedDoses,
    doseRecords,
    drugs: [...SEED_DRUGS, ...customDrugs],
  });

  // Rolling horizon: regenerate doses for active protocols that have
  // no pending doses within the next 14 days (e.g. after a long gap).
  const HORIZON_DAYS = 14;
  const horizonDate = format(addDays(new Date(), HORIZON_DAYS), 'yyyy-MM-dd');
  const storeActions = useStore.getState();
  for (const ap of activeProtocols) {
    if (ap.status !== 'active') continue;
    const hasFutureDoses = dedupedDoses.some(
      d => d.activeProtocolId === ap.id && d.scheduledDate >= horizonDate && d.status === 'pending',
    );
    if (!hasFutureDoses) {
      storeActions.regenerateDoses(ap.id, removedSlotKeys);
    }
  }

  return {
    customDrugs: customDrugs.length,
    protocols: cloudProtocols.length,
    protocolItems: (protocolItemsRes.data ?? []).length,
    activeProtocols: activeProtocols.length,
    scheduledDoses: dedupedDoses.length,     // occurrences count
    doseRecords: doseRecords.length,          // execution events count
  };
}
