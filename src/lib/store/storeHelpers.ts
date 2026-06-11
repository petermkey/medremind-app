import { v4 as uuid } from 'uuid';
import { format, addDays, parseISO, isBefore, isAfter } from 'date-fns';
import type {
  UserProfile, ActiveProtocol, ProtocolItem,
  ScheduledDose, DoseRecord, PlannedOccurrence, OccurrenceStatus, ExecutionEvent,
} from '@/types';

export function nowDateTimeForTimezone(timezone?: string): { date: string; time: string } {
  const now = new Date();
  const resolvedTimezone = timezone && timezone.trim().length > 0
    ? timezone
    : Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: resolvedTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const lookup = new Map(parts.map(p => [p.type, p.value]));
    const date = `${lookup.get('year')}-${lookup.get('month')}-${lookup.get('day')}`;
    const time = `${lookup.get('hour')}:${lookup.get('minute')}`;
    if (date.length === 10 && time.length === 5) return { date, time };
  } catch (error) {
    console.warn('[timezone-now-fallback]', error);
  }
  return {
    date: format(now, 'yyyy-MM-dd'),
    time: format(now, 'HH:mm'),
  };
}

export const today = () => nowDateTimeForTimezone().date;

export function isFutureDoseByDate(
  dose: ScheduledDose,
  profile?: UserProfile | null,
): boolean {
  const { date: todayDate } = nowDateTimeForTimezone(profile?.timezone);
  return dose.scheduledDate > todayDate;
}

// overdue is a derived UI concept — never persisted as a terminal status.
// A pending dose is overdue when its scheduled slot is in the past.
export function isOverdue(dose: ScheduledDose, profile?: UserProfile | null): boolean {
  if (dose.status !== 'pending') return false;
  const { date: todayDate, time: currentTime } = nowDateTimeForTimezone(profile?.timezone);
  return dose.scheduledDate < todayDate ||
    (dose.scheduledDate === todayDate && dose.scheduledTime < currentTime);
}

// ─── F5: getDayScheduleFromState ──────────────────────────────────────
// Pure helper — returns sorted doses for a date from raw state slices.
// Past dates: all doses (any protocol status) to preserve history.
// Today/future: only doses belonging to active protocol instances.
export function getDayScheduleFromState(
  scheduledDoses: ScheduledDose[],
  activeProtocols: ActiveProtocol[],
  date: string,
): ScheduledDose[] {
  const todayDate = today();
  const sorted = (arr: ScheduledDose[]) =>
    [...arr].sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
  if (date < todayDate) {
    return sorted(scheduledDoses.filter(d => d.scheduledDate === date));
  }
  const activeIds = new Set(
    activeProtocols.filter(ap => ap.status === 'active').map(ap => ap.id),
  );
  return sorted(
    scheduledDoses.filter(d => d.scheduledDate === date && activeIds.has(d.activeProtocolId)),
  );
}

// ─── F4: ExecutionEvent builder ────────────────────────────────────────
// Constructs a local ExecutionEvent from a dose action at write time.
// idempotencyKey matches the clientOperationId used in cloud sync so
// the local and remote events can be correlated later.
export function buildExecutionEvent(
  dose: ScheduledDose,
  record: DoseRecord,
  eventType: ExecutionEvent['eventType'],
  idempotencyKey: string,
): ExecutionEvent {
  return {
    id: record.id,
    userId: record.userId,
    legacyScheduledDoseId: dose.id,
    activeProtocolId: dose.activeProtocolId,
    protocolItemId: dose.protocolItemId,
    eventType,
    eventAt: record.recordedAt,
    effectiveDate: dose.scheduledDate,
    effectiveTime: dose.scheduledTime,
    note: record.note,
    idempotencyKey,
  };
}

// ─── Occurrence model (F3) ─────────────────────────────────────────────
//
// Projects a ScheduledDose into a PlannedOccurrence at read time.
// occurrenceStatus is derived — never written — following these rules:
//   superseded: dose has an explicit successor (F2 lineage) OR legacy snoozed status
//   cancelled:  dose was removed from the plan without an action record
//   planned:    everything else (live, actionable slot)
//
// PlannedOccurrence extends ScheduledDose so all existing consumers
// (MedCard, page.tsx, etc.) can receive it without modification.
export function projectToOccurrence(dose: ScheduledDose): PlannedOccurrence {
  let occurrenceStatus: OccurrenceStatus = 'planned';
  if (dose.successorDoseId || dose.status === 'snoozed') {
    occurrenceStatus = 'superseded';
  }
  const occurrenceKey = `${dose.activeProtocolId}|${dose.protocolItemId}|${dose.scheduledDate}|${dose.scheduledTime}`;
  return { ...dose, occurrenceStatus, occurrenceKey };
}

export function generateId(prefix: string): string {
  try {
    return uuid();
  } catch (error) {
    console.error('[id-generation-fallback]', prefix, error);
    const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
    if (c?.randomUUID) return c.randomUUID();
    const rand = Math.random().toString(16).slice(2, 10);
    return `${prefix}-${Date.now()}-${rand}`;
  }
}

export function hash32(input: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function stableUuid(namespace: string, source: string): string {
  const input = `${namespace}:${source}`;
  const p1 = hash32(input, 0x811c9dc5).toString(16).padStart(8, '0');
  const p2 = hash32(input, 0x9e3779b9).toString(16).padStart(8, '0');
  const p3 = hash32(input, 0x85ebca6b).toString(16).padStart(8, '0');
  const p4 = hash32(input, 0xc2b2ae35).toString(16).padStart(8, '0');
  const hex = `${p1}${p2}${p3}${p4}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function buildSnoozeReplacementDoseId(sourceDoseId: string, scheduledDate: string, scheduledTime: string): string {
  return stableUuid(`dose-snooze-replacement:${sourceDoseId}`, `${scheduledDate}|${scheduledTime}`);
}

export function resolveSnoozeTargetSlot(
  doses: ScheduledDose[],
  sourceDose: ScheduledDose,
  baseTarget: Date,
): { scheduledDate: string; scheduledTime: string; snoozedUntil: string; reuseExistingId?: string } {
  const scheduledDate = format(baseTarget, 'yyyy-MM-dd');
  const scheduledTime = format(baseTarget, 'HH:mm');
  // If a pending dose for the same protocol item already exists at the target slot,
  // reuse it — don't create a second dose.
  const existing = doses.find(d =>
    d.activeProtocolId === sourceDose.activeProtocolId
    && d.protocolItemId === sourceDose.protocolItemId
    && d.scheduledDate === scheduledDate
    && d.scheduledTime === scheduledTime
    && d.id !== sourceDose.id
    && d.status === 'pending'
  );
  if (existing) {
    return { scheduledDate, scheduledTime, snoozedUntil: baseTarget.toISOString(), reuseExistingId: existing.id };
  }
  return { scheduledDate, scheduledTime, snoozedUntil: baseTarget.toISOString() };
}

export function normalizeDurationDays(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const days = Math.trunc(value);
  return days > 0 ? days : undefined;
}

export function computeInclusiveEndDate(startDate: string, durationDays: number | undefined): string | undefined {
  if (!durationDays) return undefined;
  return format(addDays(parseISO(startDate), durationDays - 1), 'yyyy-MM-dd');
}

export function doseSlotKey(protocolItemId: string, scheduledDate: string, scheduledTime: string): string {
  return `${protocolItemId}|${scheduledDate}|${scheduledTime.slice(0, 5)}`;
}

export function buildLifecycleCommandOperationId(
  kind: 'pause' | 'resume' | 'complete' | 'archive',
  entityId: string,
  at: string,
): string {
  return `${kind}:${entityId}:${at}`;
}

/** Expand a protocol item into scheduled_doses for a date range */
export function expandItemToDoses(
  item: ProtocolItem,
  activeProtocol: ActiveProtocol,
  fromDate: string,
  toDate: string,
): Omit<ScheduledDose, 'protocolItem' | 'activeProtocol'>[] {
  const doses: Omit<ScheduledDose, 'protocolItem' | 'activeProtocol'>[] = [];
  const start = parseISO(activeProtocol.startDate);
  const from = parseISO(fromDate);
  const to = parseISO(toDate);

  // analyses / therapies with no times → generate a single reminder on target date
  if (item.itemType === 'analysis' || item.times.length === 0) {
    if (item.frequencyValue) {
      const targetDate = addDays(start, (item.startDay - 1) + (item.frequencyValue - 1));
      const td = format(targetDate, 'yyyy-MM-dd');
      if (td >= fromDate && td <= toDate) {
        doses.push({
          id: generateId('dose'),
          userId: activeProtocol.userId,
          activeProtocolId: activeProtocol.id,
          protocolItemId: item.id,
          scheduledDate: td,
          scheduledTime: '08:00',
          status: 'pending',
        });
      }
    }
    return doses;
  }

  // Walk day by day within range
  let cursor = new Date(Math.max(from.getTime(), start.getTime()));
  let end = to;
  if (activeProtocol.endDate) {
    const protocolEnd = parseISO(activeProtocol.endDate);
    if (isBefore(protocolEnd, end)) end = protocolEnd;
  }

  while (!isAfter(cursor, end)) {
    const dateStr = format(cursor, 'yyyy-MM-dd');
    const dayNum = Math.floor((cursor.getTime() - start.getTime()) / 86400000) + 1;

    // Check start/end day bounds
    if (dayNum < item.startDay) { cursor = addDays(cursor, 1); continue; }
    if (item.endDay && dayNum > item.endDay) break;

    // Check frequency
    let include = false;
    switch (item.frequencyType) {
      case 'daily':
      case 'twice_daily':
      case 'three_times_daily':
        include = true; break;
      case 'every_n_days':
        include = (dayNum - item.startDay) % (item.frequencyValue ?? 1) === 0; break;
      case 'weekly':
        include = (dayNum - item.startDay) % 7 === 0; break;
      default:
        include = true;
    }

    if (include) {
      for (const time of item.times) {
        doses.push({
          id: generateId('dose'),
          userId: activeProtocol.userId,
          activeProtocolId: activeProtocol.id,
          protocolItemId: item.id,
          scheduledDate: dateStr,
          scheduledTime: time,
          status: 'pending',
        });
      }
    }
    cursor = addDays(cursor, 1);
  }
  return doses;
}
