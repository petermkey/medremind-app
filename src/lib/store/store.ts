'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuid } from 'uuid';
import { format, addDays, parseISO, isBefore, isAfter } from 'date-fns';
import type {
  UserProfile, ActiveProtocol, Protocol, ProtocolItem,
  ScheduledDose, DoseRecord, DoseStatus, NotificationSettings,
  ProtocolStatus,
} from '@/types';
import { SEED_PROTOCOLS, SEED_DRUGS } from '@/lib/data/seed';
import type { Drug } from '@/types';
import {
  syncArchiveProtocolCommand,
  syncActivation,
  syncCompleteProtocolCommand,
  syncPauseProtocolCommand,
  syncResumeProtocolCommand,
  syncSnoozeDoseCommand,
  syncSkipDoseCommand,
  syncTakeDoseCommand,
  syncProtocolDelete,
  syncProtocolItemDelete,
  syncProtocolUpsert,
  syncRegeneratedDoses,
  syncEndProtocolFromTodayCommand,
  syncRemoveDoseCommand,
} from '@/lib/supabase/realtimeSync';
import {
  enqueueSyncOperation,
  markSyncFailure,
  markSyncSuccess,
  type SyncOperation,
} from '@/lib/supabase/syncOutbox';

const inflightRealtimeSync = new Set<Promise<unknown>>();

function trackRealtimeSync(task: Promise<unknown>) {
  inflightRealtimeSync.add(task);
  void task.finally(() => {
    inflightRealtimeSync.delete(task);
  });
  return task;
}

export async function waitForRealtimeSyncIdle(timeoutMs = 8_000): Promise<{ ok: boolean; pending: number }> {
  const startedAt = Date.now();
  while (inflightRealtimeSync.size > 0) {
    if (Date.now() - startedAt >= timeoutMs) {
      return { ok: false, pending: inflightRealtimeSync.size };
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return { ok: true, pending: 0 };
}

// ─── Helpers ───────────────────────────────────────────────────────────

function nowDateTimeForTimezone(timezone?: string): { date: string; time: string } {
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

const today = () => nowDateTimeForTimezone().date;
const nowTime = () => format(new Date(), 'HH:mm');

function isFutureDoseByDate(
  dose: ScheduledDose,
  profile?: UserProfile | null,
): boolean {
  const { date: todayDate } = nowDateTimeForTimezone(profile?.timezone);
  return dose.scheduledDate > todayDate;
}

function generateId(prefix: string): string {
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

function buildSnoozeReplacementDoseId(sourceDoseId: string, scheduledDate: string, scheduledTime: string): string {
  return stableUuid(`dose-snooze-replacement:${sourceDoseId}`, `${scheduledDate}|${scheduledTime}`);
}

function resolveSnoozeTargetSlot(
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

function normalizeDurationDays(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const days = Math.trunc(value);
  return days > 0 ? days : undefined;
}

function computeInclusiveEndDate(startDate: string, durationDays: number | undefined): string | undefined {
  if (!durationDays) return undefined;
  return format(addDays(parseISO(startDate), durationDays - 1), 'yyyy-MM-dd');
}

function doseSlotKey(protocolItemId: string, scheduledDate: string, scheduledTime: string): string {
  return `${protocolItemId}|${scheduledDate}|${scheduledTime.slice(0, 5)}`;
}

function buildLifecycleCommandOperationId(
  kind: 'pause' | 'resume' | 'complete' | 'archive',
  entityId: string,
  at: string,
): string {
  return `${kind}:${entityId}:${at}`;
}

function syncFireAndForget(task: Promise<unknown>, fallbackOp?: SyncOperation) {
  const tracked = trackRealtimeSync(task);
  void tracked
    .then(() => {
      markSyncSuccess();
    })
    .catch((err: unknown) => {
      markSyncFailure(err);
      if (fallbackOp) enqueueSyncOperation(fallbackOp);
    // Keep UX responsive; failed writes are queued for retry and logged for diagnostics.
    console.error('[realtime-sync]', err);
  });
}

/** Expand a protocol item into scheduled_doses for a date range */
function expandItemToDoses(
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

// ─── Store shape ───────────────────────────────────────────────────────

interface AppState {
  // Auth
  profile: UserProfile | null;
  notificationSettings: NotificationSettings;

  // Data
  protocols: Protocol[];      // global templates + user custom
  activeProtocols: ActiveProtocol[];
  scheduledDoses: ScheduledDose[];
  doseRecords: DoseRecord[];
  drugs: Drug[];

  // Actions — Auth
  setProfile: (profile: UserProfile | null) => void;
  resetUserData: () => void;
  signUp: (email: string, password: string, name: string) => UserProfile;
  signIn: (email: string, password: string) => UserProfile | null;
  signOut: () => void;
  updateProfile: (patch: Partial<UserProfile>) => void;
  completeOnboarding: (patch: Partial<UserProfile>) => void;

  // Actions — Protocols
  activateProtocol: (protocolId: string, startDate: string) => ActiveProtocol;
  pauseProtocol: (activeId: string) => void;
  resumeProtocol: (activeId: string) => void;
  completeProtocol: (activeId: string) => void;
  createCustomProtocol: (p: Omit<Protocol, 'id' | 'createdAt' | 'ownerId' | 'isTemplate'>) => Protocol;
  updateProtocol: (id: string, patch: Partial<Protocol>) => void;
  deleteProtocol: (id: string) => { mode: 'deleted' | 'archived' };
  addProtocolItem: (protocolId: string, item: Omit<ProtocolItem, 'id' | 'protocolId'>) => void;
  removeProtocolItem: (protocolId: string, itemId: string) => void;

  // Actions — Schedule
  getDaySchedule: (date: string) => ScheduledDose[];
  selectAppActionableDoses: (date: string) => ScheduledDose[];
  selectAppNextDose: (date: string) => ScheduledDose | undefined;
  selectAppSummaryMetrics: (date: string) => { taken: number; total: number; pct: number };
  selectProtocolDetailReadModel: (protocolId: string, date: string) => {
    instance: ActiveProtocol | undefined;
    actionableFutureRows: ScheduledDose[];
    handledHistoryRows: ScheduledDose[];
    futureBoundaryDate: string | undefined;
    canActivate: boolean;
    canPause: boolean;
    canResume: boolean;
    canComplete: boolean;
    isArchived: boolean;
  };
  selectProgressDayDoses: (date: string) => ScheduledDose[];
  selectProgressSummaryForDates: (dates: string[]) => { total: number; taken: number; skipped: number; overdue: number; pct: number };
  selectProgressDayStatus: (date: string) => { taken: number; skipped: number; remaining: number };
  selectProgressDayProtocolStats: (date: string) => Record<string, { total: number; taken: number }>;
  selectProgressProtocolWeights: (dates: string[]) => Record<string, number>;
  selectTodayScheduleView: (date: string) => ScheduledDose[];
  selectCalendarVisibleDoseDates: (anchorDate: string, lookbackDays?: number, lookaheadDays?: number) => string[];
  selectHistoryDayRows: (date: string) => ScheduledDose[];
  takeDose: (doseId: string, note?: string) => void;
  skipDose: (doseId: string, note?: string) => void;
  snoozeDose: (doseId: string, option: number | { until: string }) => void;
  removeDose: (doseId: string) => void;
  endProtocolFromToday: (activeProtocolId: string, doseId: string, fromDate?: string) => void;
  regenerateDoses: (activeProtocolId: string) => void;

  // Actions — Settings
  updateNotificationSettings: (patch: Partial<NotificationSettings>) => void;

  // Derived helpers
  getAdherencePct: (date: string) => number;
  getStreak: () => number;
}

// ─── Store ─────────────────────────────────────────────────────────────

// Simulated password store (in real app: hashed on server)
const _passwords: Record<string, string> = {};

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      profile: null,
      notificationSettings: {
        pushEnabled: false,
        emailEnabled: false,
        leadTimeMin: 0,
        digestTime: '07:00',
      },
      protocols: SEED_PROTOCOLS,
      activeProtocols: [],
      scheduledDoses: [],
      doseRecords: [],
      drugs: SEED_DRUGS,

      // ── Auth ──────────────────────────────────────────────────────────

      setProfile: (profile) => set({ profile }),
      resetUserData: () => set({
        profile: null,
        notificationSettings: {
          pushEnabled: false,
          emailEnabled: false,
          leadTimeMin: 0,
          digestTime: '07:00',
        },
        protocols: SEED_PROTOCOLS,
        activeProtocols: [],
        scheduledDoses: [],
        doseRecords: [],
        drugs: SEED_DRUGS,
      }),

      signUp: (email, password, name) => {
        _passwords[email] = password;
        const profile: UserProfile = {
          id: generateId('profile'),
          email,
          name,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          onboarded: false,
          createdAt: new Date().toISOString(),
        };
        set({ profile });
        return profile;
      },

      signIn: (email, password) => {
        const stored = _passwords[email];
        if (!stored || stored !== password) return null;
        // In real app: fetch profile from server. Here we just keep current profile
        return get().profile;
      },

      signOut: () => set({
        profile: null,
        notificationSettings: {
          pushEnabled: false,
          emailEnabled: false,
          leadTimeMin: 0,
          digestTime: '07:00',
        },
        protocols: SEED_PROTOCOLS,
        activeProtocols: [],
        scheduledDoses: [],
        doseRecords: [],
        drugs: SEED_DRUGS,
      }),

      updateProfile: (patch) => {
        const p = get().profile;
        if (!p) {
          const hasRequired =
            typeof patch.id === 'string' &&
            typeof patch.email === 'string' &&
            typeof patch.name === 'string' &&
            typeof patch.timezone === 'string' &&
            typeof patch.createdAt === 'string';
          if (!hasRequired) return;
          const full = patch as UserProfile;
          set({
            profile: {
              id: full.id,
              email: full.email,
              name: full.name,
              timezone: full.timezone,
              ageRange: full.ageRange,
              onboarded: Boolean(full.onboarded),
              createdAt: full.createdAt,
            },
          });
          return;
        }
        set({ profile: { ...p, ...patch } });
      },

      completeOnboarding: (patch) => {
        const p = get().profile;
        if (!p) return;
        set({ profile: { ...p, ...patch, onboarded: true } });
      },

      // ── Protocols ─────────────────────────────────────────────────────

      activateProtocol: (protocolId, startDate) => {
        const state = get();
        const protocol = state.protocols.find(p => p.id === protocolId);
        if (!protocol || !state.profile) throw new Error('Protocol or profile not found');
        // Guard: prevent duplicate activation if already active or paused.
        const existingRunning = state.activeProtocols.find(
          ap => ap.protocolId === protocolId && (ap.status === 'active' || ap.status === 'paused'),
        );
        if (existingRunning) return existingRunning;
        const fixedDurationDays = normalizeDurationDays(protocol.durationDays);
        const endDate = computeInclusiveEndDate(startDate, fixedDurationDays);

        const active: ActiveProtocol = {
          id: generateId('active'),
          userId: state.profile.id,
          protocolId,
          protocol,
          status: 'active',
          startDate,
          endDate,
          createdAt: new Date().toISOString(),
        };

        set(s => ({ activeProtocols: [...s.activeProtocols, active] }));

        // Generate 90 days of doses
        const fromDate = startDate;
        const toDate = format(addDays(parseISO(startDate), 89), 'yyyy-MM-dd');
        const newDoses: ScheduledDose[] = [];
        for (const item of protocol.items) {
          const raw = expandItemToDoses(item, active, fromDate, toDate);
          newDoses.push(...raw.map(d => ({ ...d, protocolItem: item, activeProtocol: active })));
        }

        // Mark past doses as overdue
        const now = today();
        const nt = nowTime();
        const markedDoses = newDoses.map(d => {
          if (d.scheduledDate < now || (d.scheduledDate === now && d.scheduledTime < nt)) {
            return { ...d, status: 'overdue' as DoseStatus };
          }
          return d;
        });

        set(s => ({ scheduledDoses: [...s.scheduledDoses, ...markedDoses] }));
        syncFireAndForget(
          syncActivation(state.profile.id, active, markedDoses),
          { kind: 'activation', payload: { userId: state.profile.id, active, doses: markedDoses } },
        );
        return active;
      },

      pauseProtocol: (activeId) => {
        const pausedAt = new Date().toISOString();
        const profileId = get().profile?.id;
        const clientOperationId = buildLifecycleCommandOperationId('pause', activeId, pausedAt);
        set(s => ({
          activeProtocols: s.activeProtocols.map(ap =>
            ap.id === activeId ? { ...ap, status: 'paused' as ProtocolStatus, pausedAt } : ap
          ),
        }));
        if (profileId) {
          syncFireAndForget(
            syncPauseProtocolCommand(profileId, activeId, pausedAt, clientOperationId),
            { kind: 'pauseCommand', payload: { userId: profileId, activeId, pausedAt, clientOperationId } },
          );
        }
      },

      resumeProtocol: (activeId) => {
        const profileId = get().profile?.id;
        const resumedAt = new Date().toISOString();
        const clientOperationId = buildLifecycleCommandOperationId('resume', activeId, resumedAt);
        set(s => ({
          activeProtocols: s.activeProtocols.map(ap =>
            ap.id === activeId ? { ...ap, status: 'active' as ProtocolStatus, pausedAt: undefined } : ap
          ),
        }));
        if (profileId) {
          syncFireAndForget(
            syncResumeProtocolCommand(profileId, activeId, clientOperationId),
            { kind: 'resumeCommand', payload: { userId: profileId, activeId, clientOperationId } },
          );
        }
      },

      completeProtocol: (activeId) => {
        const completedAt = new Date().toISOString();
        const profileId = get().profile?.id;
        const clientOperationId = buildLifecycleCommandOperationId('complete', activeId, completedAt);
        set(s => ({
          activeProtocols: s.activeProtocols.map(ap =>
            ap.id === activeId ? { ...ap, status: 'completed' as ProtocolStatus, completedAt } : ap
          ),
        }));
        if (profileId) {
          syncFireAndForget(
            syncCompleteProtocolCommand(profileId, activeId, completedAt, clientOperationId),
            {
              kind: 'completeCommand',
              payload: { userId: profileId, activeId, completedAt, clientOperationId },
            },
          );
        }
      },

      createCustomProtocol: (p) => {
        const profileId = get().profile?.id;
        const protocol: Protocol = {
          ...p,
          durationDays: normalizeDurationDays(p.durationDays),
          id: generateId('protocol'),
          ownerId: profileId,
          isTemplate: false,
          createdAt: new Date().toISOString(),
        };
        set(s => ({ protocols: [...s.protocols, protocol] }));
        if (profileId) {
          syncFireAndForget(
            syncProtocolUpsert(profileId, protocol),
            { kind: 'protocolUpsert', payload: { userId: profileId, protocol } },
          );
        }
        return protocol;
      },

      updateProtocol: (id, patch) => {
        const profileId = get().profile?.id;
        const currentProtocol = get().protocols.find(p => p.id === id);
        const currentDurationDays = normalizeDurationDays(currentProtocol?.durationDays);
        let nextProtocol: Protocol | null = null;
        const normalizedPatch: Partial<Protocol> = {
          ...patch,
          ...(Object.prototype.hasOwnProperty.call(patch, 'durationDays')
            ? { durationDays: normalizeDurationDays(patch.durationDays) }
            : {}),
        };
        const nextDurationDays = normalizeDurationDays(
          Object.prototype.hasOwnProperty.call(normalizedPatch, 'durationDays')
            ? normalizedPatch.durationDays
            : currentDurationDays,
        );
        const durationChanged =
          Object.prototype.hasOwnProperty.call(normalizedPatch, 'durationDays') &&
          currentDurationDays !== nextDurationDays;
        const activeToRegenerate = new Set<string>();
        set(s => {
          const protocols = s.protocols.map(p => {
            if (p.id !== id) return p;
            nextProtocol = { ...p, ...normalizedPatch };
            return nextProtocol;
          });
          const activeProtocols = s.activeProtocols.map(ap => {
            if (ap.protocolId !== id || !nextProtocol) return ap;
            const nextActive = { ...ap, protocol: nextProtocol };
            if (!durationChanged || ap.status === 'completed') return nextActive;
            activeToRegenerate.add(ap.id);
            return {
              ...nextActive,
              endDate: computeInclusiveEndDate(ap.startDate, nextDurationDays),
            };
          });
          return { protocols, activeProtocols };
        });
        if (profileId && nextProtocol) {
          syncFireAndForget(
            syncProtocolUpsert(profileId, nextProtocol),
            { kind: 'protocolUpsert', payload: { userId: profileId, protocol: nextProtocol } },
          );
        }
        if (durationChanged && activeToRegenerate.size > 0) {
          for (const activeId of activeToRegenerate) {
            get().regenerateDoses(activeId);
          }
        }
      },

      deleteProtocol: (id) => {
        const profileId = get().profile?.id;
        const state = get();
        const relatedActive = state.activeProtocols.filter(ap => ap.protocolId === id);
        const relatedActiveIds = relatedActive.map(ap => ap.id);
        const relatedDoses = state.scheduledDoses.filter(d => relatedActiveIds.includes(d.activeProtocolId));
        const relatedDoseIds = new Set(relatedDoses.map(d => d.id));
        const hasDoseRecordHistory = state.doseRecords.some(r => relatedDoseIds.has(r.scheduledDoseId));
        const hasHandledDoseStatus = relatedDoses.some(d =>
          d.status === 'taken' || d.status === 'skipped' || d.status === 'snoozed'
        );
        const hasHandledHistory = hasDoseRecordHistory || hasHandledDoseStatus;

        if (hasHandledHistory) {
          const archivedAt = new Date().toISOString();
          const clientOperationId = buildLifecycleCommandOperationId('archive', id, archivedAt);
          let archivedProtocol: Protocol | null = null;
          set(s => {
            const protocols = s.protocols.map(p => {
              if (p.id !== id) return p;
              archivedProtocol = { ...p, isArchived: true };
              return archivedProtocol;
            });
            const activeProtocols = s.activeProtocols.map(ap => {
              if (ap.protocolId !== id) return ap;
              return {
                ...ap,
                status: 'abandoned' as ProtocolStatus,
                completedAt: undefined,
                protocol: archivedProtocol ?? ap.protocol,
              };
            });
            return { protocols, activeProtocols };
          });
          if (profileId && archivedProtocol) {
            syncFireAndForget(
              syncArchiveProtocolCommand(profileId, archivedProtocol, relatedActiveIds, clientOperationId),
              {
                kind: 'archiveCommand',
                payload: { userId: profileId, protocol: archivedProtocol, activeIds: relatedActiveIds, clientOperationId },
              },
            );
          }
          return { mode: 'archived' as const };
        }

        set(s => ({
          protocols: s.protocols.filter(p => p.id !== id),
          activeProtocols: s.activeProtocols.filter(ap => ap.protocolId !== id),
          scheduledDoses: s.scheduledDoses.filter(d => !relatedActiveIds.includes(d.activeProtocolId)),
          doseRecords: s.doseRecords.filter(r => !relatedDoseIds.has(r.scheduledDoseId)),
        }));
        if (profileId) {
          syncFireAndForget(
            syncProtocolDelete(profileId, id),
            { kind: 'protocolDelete', payload: { userId: profileId, protocolId: id } },
          );
        }
        return { mode: 'deleted' as const };
      },

      addProtocolItem: (protocolId, item) => {
        const profileId = get().profile?.id;
        const newItem: ProtocolItem = { ...item, id: generateId('protocol-item'), protocolId };
        let targetProtocol: Protocol | null = null;
        set(s => {
          const protocols = s.protocols.map(p => {
            if (p.id !== protocolId) return p;
            targetProtocol = { ...p, items: [...p.items, newItem] };
            return targetProtocol;
          });
          const activeProtocols = s.activeProtocols.map(ap =>
            ap.protocolId === protocolId && targetProtocol ? { ...ap, protocol: targetProtocol } : ap
          );
          return { protocols, activeProtocols };
        });
        if (profileId && targetProtocol) {
          syncFireAndForget(
            syncProtocolUpsert(profileId, targetProtocol),
            { kind: 'protocolUpsert', payload: { userId: profileId, protocol: targetProtocol } },
          );
        }
      },

      removeProtocolItem: (protocolId, itemId) => {
        const profileId = get().profile?.id;
        let targetProtocol: Protocol | null = null;
        set(s => {
          const protocols = s.protocols.map(p => {
            if (p.id !== protocolId) return p;
            targetProtocol = { ...p, items: p.items.filter(i => i.id !== itemId) };
            return targetProtocol;
          });
          const activeProtocols = s.activeProtocols.map(ap =>
            ap.protocolId === protocolId && targetProtocol ? { ...ap, protocol: targetProtocol } : ap
          );
          return { protocols, activeProtocols };
        });
        if (profileId) {
          syncFireAndForget(
            syncProtocolItemDelete(profileId, protocolId, itemId),
            { kind: 'protocolItemDelete', payload: { userId: profileId, protocolId, itemId } },
          );
          if (targetProtocol) {
            syncFireAndForget(
              syncProtocolUpsert(profileId, targetProtocol),
              { kind: 'protocolUpsert', payload: { userId: profileId, protocol: targetProtocol } },
            );
          }
        }
      },

      // ── Schedule ──────────────────────────────────────────────────────

      getDaySchedule: (date) => {
        const todayDate = today();
        const isPastDate = date < todayDate;
        if (isPastDate) {
          const pastDoses = get().scheduledDoses.filter(d => d.scheduledDate === date);
          return pastDoses.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
        }

        const activeIds = new Set(
          get().activeProtocols
            .filter(ap => ap.status === 'active')
            .map(ap => ap.id),
        );
        const doses = get().scheduledDoses.filter(
          d => d.scheduledDate === date && activeIds.has(d.activeProtocolId),
        );
        return doses.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
      },

      selectAppActionableDoses: (date) => {
        const doses = get().getDaySchedule(date);
        return doses.filter(d => d.status !== 'skipped' && d.status !== 'snoozed');
      },

      selectAppNextDose: (date) => {
        const actionable = get().selectAppActionableDoses(date);
        return actionable
          .filter(d => d.status === 'pending' || (d.status as string) === 'upcoming')
          .sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime))[0];
      },

      selectAppSummaryMetrics: (date) => {
        const actionable = get().selectAppActionableDoses(date);
        const taken = actionable.filter(d => d.status === 'taken').length;
        const total = actionable.length;
        const pct = total ? Math.round((taken / total) * 100) : 0;
        return { taken, total, pct };
      },

      selectProtocolDetailReadModel: (protocolId, date) => {
        const state = get();
        const protocol = state.protocols.find(p => p.id === protocolId);
        // Prefer the running (active/paused) instance; fall back to latest completed/abandoned.
        const instance =
          state.activeProtocols.find(ap => ap.protocolId === protocolId && (ap.status === 'active' || ap.status === 'paused')) ??
          state.activeProtocols.filter(ap => ap.protocolId === protocolId).at(-1);
        const instanceIds = new Set(
          state.activeProtocols
            .filter(ap => ap.protocolId === protocolId)
            .map(ap => ap.id),
        );
        const recordLinkedDoseIds = new Set(
          state.doseRecords
            .filter(record => Boolean(record.scheduledDoseId))
            .map(record => record.scheduledDoseId),
        );
        const actionableFutureRows = instance
          ? state.scheduledDoses
            .filter(d =>
              d.activeProtocolId === instance.id
              && d.scheduledDate >= date
              && d.status !== 'taken'
              && d.status !== 'skipped'
              && d.status !== 'snoozed',
            )
            .sort((a, b) => {
              if (a.scheduledDate === b.scheduledDate) return a.scheduledTime.localeCompare(b.scheduledTime);
              return a.scheduledDate.localeCompare(b.scheduledDate);
            })
          : [];
        const handledHistoryRows = state.scheduledDoses
          .filter(d => {
            if (!instanceIds.has(d.activeProtocolId)) return false;
            const isHandledStatus = d.status === 'taken' || d.status === 'skipped';
            return isHandledStatus || recordLinkedDoseIds.has(d.id);
          })
          .sort((a, b) => {
            if (a.scheduledDate === b.scheduledDate) return b.scheduledTime.localeCompare(a.scheduledTime);
            return b.scheduledDate.localeCompare(a.scheduledDate);
          });
        return {
          instance,
          actionableFutureRows,
          handledHistoryRows,
          futureBoundaryDate: instance?.endDate,
          canActivate: !instance || (instance.status !== 'active' && instance.status !== 'paused'),
          canPause: instance?.status === 'active',
          canResume: instance?.status === 'paused',
          canComplete: instance?.status === 'active',
          isArchived: Boolean(protocol?.isArchived),
        };
      },

      selectProgressDayDoses: (date) => {
        const doses = get().getDaySchedule(date);
        return doses.filter(d => d.status !== 'snoozed');
      },

      selectProgressSummaryForDates: (dates) => {
        const uniqueDates = [...new Set(dates)];
        let total = 0;
        let taken = 0;
        let skipped = 0;
        let overdue = 0;
        for (const date of uniqueDates) {
          const doses = get().selectProgressDayDoses(date);
          total += doses.length;
          taken += doses.filter(d => d.status === 'taken').length;
          skipped += doses.filter(d => d.status === 'skipped').length;
          overdue += doses.filter(d => d.status === 'overdue').length;
        }
        const pct = total ? Math.round((taken / total) * 100) : 0;
        return { total, taken, skipped, overdue, pct };
      },

      selectProgressDayStatus: (date) => {
        const doses = get().selectProgressDayDoses(date);
        return {
          taken: doses.filter(d => d.status === 'taken').length,
          skipped: doses.filter(d => d.status === 'skipped').length,
          remaining: doses.filter(d => d.status !== 'taken' && d.status !== 'skipped').length,
        };
      },

      selectProgressDayProtocolStats: (date) => {
        const doses = get().selectProgressDayDoses(date);
        const stats: Record<string, { total: number; taken: number }> = {};
        for (const dose of doses) {
          const current = stats[dose.activeProtocolId] ?? { total: 0, taken: 0 };
          current.total += 1;
          if (dose.status === 'taken') current.taken += 1;
          stats[dose.activeProtocolId] = current;
        }
        return stats;
      },

      selectProgressProtocolWeights: (dates) => {
        const uniqueDates = [...new Set(dates)];
        const weights: Record<string, number> = {};
        for (const date of uniqueDates) {
          const doses = get().selectProgressDayDoses(date);
          for (const dose of doses) {
            weights[dose.activeProtocolId] = (weights[dose.activeProtocolId] ?? 0) + 1;
          }
        }
        return weights;
      },

      selectTodayScheduleView: (date) => {
        return get().selectAppActionableDoses(date);
      },

      selectCalendarVisibleDoseDates: (anchorDate, lookbackDays = 60, lookaheadDays = 60) => {
        const state = get();
        const parsedAnchor = parseISO(anchorDate);
        const resolvedAnchor = Number.isNaN(parsedAnchor.getTime()) ? new Date() : parsedAnchor;
        const fromDate = format(addDays(resolvedAnchor, -lookbackDays), 'yyyy-MM-dd');
        const toDate = format(addDays(resolvedAnchor, lookaheadDays), 'yyyy-MM-dd');
        const todayDate = today();
        const activeById = new Map(state.activeProtocols.map(ap => [ap.id, ap]));
        const dates = new Set<string>();

        for (const dose of state.scheduledDoses) {
          if (dose.scheduledDate < fromDate || dose.scheduledDate > toDate) continue;

          if (dose.scheduledDate < todayDate) {
            dates.add(dose.scheduledDate);
            continue;
          }

          const active = activeById.get(dose.activeProtocolId);
          if (!active || active.status !== 'active') continue;
          if (active.endDate && dose.scheduledDate > active.endDate) continue;
          if (dose.status === 'skipped' || dose.status === 'snoozed') continue;

          dates.add(dose.scheduledDate);
        }

        return [...dates].sort();
      },

      selectHistoryDayRows: (date) => {
        const state = get();
        const todayDate = today();
        if (date >= todayDate) return [];

        const recordByDoseId = new Map<string, DoseRecord[]>();
        for (const record of state.doseRecords) {
          const list = recordByDoseId.get(record.scheduledDoseId) ?? [];
          list.push(record);
          recordByDoseId.set(record.scheduledDoseId, list);
        }

        return state.scheduledDoses
          .filter(dose => {
            if (dose.scheduledDate !== date) return false;

            const records = recordByDoseId.get(dose.id) ?? [];
            let latestAction: DoseRecord['action'] | null = null;
            let latestRecordedAt = '';
            for (const record of records) {
              if (record.recordedAt >= latestRecordedAt) {
                latestRecordedAt = record.recordedAt;
                latestAction = record.action;
              }
            }
            const isHandledStatus = dose.status === 'taken' || dose.status === 'skipped';
            const hasHandledRecord = records.some(
              record => record.action === 'taken' || record.action === 'skipped',
            );
            const wasMovedBySnooze = dose.status === 'snoozed' || latestAction === 'snoozed';

            if (wasMovedBySnooze) return false;

            // A snoozed origin dose is logically moved to a new slot and should not remain
            // visible on the original day; only handled history stays on the day surface.
            return isHandledStatus || hasHandledRecord;
          })
          .sort((a, b) => b.scheduledTime.localeCompare(a.scheduledTime));
      },

      takeDose: (doseId, note) => {
        const state = get();
        const dose = state.scheduledDoses.find(d => d.id === doseId);
        if (!dose) return;
        if (isFutureDoseByDate(dose, state.profile)) return;
        const existingRecord = state.doseRecords.find(
          r => r.scheduledDoseId === doseId && r.action === 'taken',
        );
        const record: DoseRecord = existingRecord ?? {
          id: generateId('dose-record'),
          userId: state.profile?.id ?? '',
          scheduledDoseId: doseId,
          action: 'taken',
          recordedAt: new Date().toISOString(),
          note,
        };
        const clientOperationId = `take:${record.id}`;
        const shouldAppendRecord = !existingRecord;
        const shouldUpdateStatus = dose.status !== 'taken';
        if (shouldAppendRecord || shouldUpdateStatus) {
          set(s => ({
            scheduledDoses: s.scheduledDoses.map(d =>
              d.id === doseId ? { ...d, status: 'taken' as DoseStatus } : d
            ),
            doseRecords: shouldAppendRecord ? [...s.doseRecords, record] : s.doseRecords,
          }));
        }
        if (state.profile?.id) {
          syncFireAndForget(
            syncTakeDoseCommand(state.profile.id, dose, record, clientOperationId),
            {
              kind: 'takeCommand',
              payload: { userId: state.profile.id, dose, record, clientOperationId },
            },
          );
        }
      },

      skipDose: (doseId, note) => {
        const state = get();
        const dose = state.scheduledDoses.find(d => d.id === doseId);
        if (!dose) return;
        if (isFutureDoseByDate(dose, state.profile)) return;
        const existingRecord = state.doseRecords.find(
          r => r.scheduledDoseId === doseId && r.action === 'skipped',
        );
        const record: DoseRecord = existingRecord ?? {
          id: generateId('dose-record'),
          userId: state.profile?.id ?? '',
          scheduledDoseId: doseId,
          action: 'skipped',
          recordedAt: new Date().toISOString(),
          note,
        };
        const clientOperationId = `skip:${record.id}`;
        const shouldAppendRecord = !existingRecord;
        const shouldUpdateStatus = dose.status !== 'skipped';
        if (shouldAppendRecord || shouldUpdateStatus) {
          set(s => ({
            scheduledDoses: s.scheduledDoses.map(d =>
              d.id === doseId ? { ...d, status: 'skipped' as DoseStatus } : d
            ),
            doseRecords: shouldAppendRecord ? [...s.doseRecords, record] : s.doseRecords,
          }));
        }
        if (state.profile?.id) {
          syncFireAndForget(
            syncSkipDoseCommand(state.profile.id, dose, record, clientOperationId),
            {
              kind: 'skipCommand',
              payload: { userId: state.profile.id, dose, record, clientOperationId },
            },
          );
        }
      },

      snoozeDose: (doseId, option) => {
        const state = get();
        const dose = state.scheduledDoses.find(d => d.id === doseId);
        if (!dose) return;
        if (isFutureDoseByDate(dose, state.profile)) return;
        const targetDate = typeof option === 'number'
          ? new Date(Date.now() + option * 60000)
          : new Date(option.until);
        if (Number.isNaN(targetDate.getTime())) return;
        const resolvedSlot = resolveSnoozeTargetSlot(state.scheduledDoses, dose, targetDate);
        const { snoozedUntil, scheduledDate, scheduledTime, reuseExistingId } = resolvedSlot;
        // If a pending dose already exists at the target slot, reuse its ID to avoid duplication.
        const replacementDoseId = reuseExistingId ?? buildSnoozeReplacementDoseId(dose.id, scheduledDate, scheduledTime);
        const replacementDose: ScheduledDose = {
          ...dose,
          id: replacementDoseId,
          scheduledDate,
          scheduledTime,
          status: 'pending',
          snoozedUntil,
        };
        const existingRecord = state.doseRecords.find(
          r => r.scheduledDoseId === doseId && r.action === 'snoozed',
        );
        const recordNote = `snooze-replacement|original=${doseId}|replacement=${replacementDoseId}|target=${scheduledDate}T${scheduledTime}`;
        const record: DoseRecord = existingRecord ?? {
          id: generateId('dose-record'),
          userId: state.profile?.id ?? '',
          scheduledDoseId: doseId,
          action: 'snoozed',
          recordedAt: new Date().toISOString(),
          note: recordNote,
        };
        const clientOperationId = `snooze:${record.id}`;
        const shouldAppendRecord = !existingRecord;
        const shouldUpdateRecordNote = Boolean(existingRecord && existingRecord.note !== recordNote);
        const originalNeedsUpdate = dose.status !== 'snoozed' || dose.snoozedUntil !== snoozedUntil;
        const existingReplacement = state.scheduledDoses.find(d => d.id === replacementDoseId);
        const replacementNeedsUpsert = !existingReplacement
          || existingReplacement.scheduledDate !== scheduledDate
          || existingReplacement.scheduledTime !== scheduledTime;
        if (shouldAppendRecord || shouldUpdateRecordNote || originalNeedsUpdate || replacementNeedsUpsert) {
          set(s => ({
            scheduledDoses: (() => {
              const updated = s.scheduledDoses.map(d =>
                d.id === doseId
                  ? {
                    ...d,
                    status: 'snoozed' as DoseStatus,
                    snoozedUntil,
                  }
                  : d
              );
              // Only add replacement if it's a new dose (not a reused existing one).
              if (!reuseExistingId) {
                const idx = updated.findIndex(d => d.id === replacementDoseId);
                if (idx >= 0) {
                  updated[idx] = { ...updated[idx], ...replacementDose };
                } else {
                  updated.push(replacementDose);
                }
              }
              return updated;
            })(),
            doseRecords: shouldAppendRecord
              ? [...s.doseRecords, record]
              : shouldUpdateRecordNote
                ? s.doseRecords.map(r => (r.id === record.id ? { ...r, note: recordNote } : r))
                : s.doseRecords,
          }));
        }
        if (state.profile?.id) {
          syncFireAndForget(
            syncSnoozeDoseCommand(
              state.profile.id,
              dose,
              reuseExistingId ? null : replacementDose,
              shouldAppendRecord ? record : (shouldUpdateRecordNote ? { ...record, note: recordNote } : record),
              clientOperationId,
            ),
            {
              kind: 'snoozeCommand',
              payload: {
                userId: state.profile.id,
                dose,
                replacementDose: reuseExistingId ? null : replacementDose,
                record: shouldAppendRecord ? record : (shouldUpdateRecordNote ? { ...record, note: recordNote } : record),
                clientOperationId,
              },
            },
          );
        }
      },

      removeDose: (doseId) => {
        const state = get();
        const profileId = state.profile?.id;
        set(s => ({
          scheduledDoses: s.scheduledDoses.filter(d => d.id !== doseId),
        }));
        if (profileId) {
          syncFireAndForget(
            syncRemoveDoseCommand(profileId, doseId),
            { kind: 'removeDose', payload: { userId: profileId, doseId } },
          );
        }
      },

      endProtocolFromToday: (activeProtocolId, doseId, fromDate) => {
        const state = get();
        // Use the provided fromDate (e.g. a past dose's scheduledDate) or fall back to today.
        const cutoffDate = fromDate ?? today();
        const profileId = state.profile?.id;

        // Remove the target dose and all doses from cutoffDate onwards for this protocol.
        set(s => ({
          scheduledDoses: s.scheduledDoses.filter(d =>
            !(d.activeProtocolId === activeProtocolId && d.scheduledDate >= cutoffDate)
          ),
          activeProtocols: s.activeProtocols.map(ap =>
            ap.id === activeProtocolId ? { ...ap, endDate: cutoffDate } : ap
          ),
        }));

        if (profileId) {
          syncFireAndForget(
            syncEndProtocolFromTodayCommand(profileId, activeProtocolId, cutoffDate),
            {
              kind: 'endProtocolFromToday',
              payload: { userId: profileId, activeProtocolId, today: cutoffDate },
            },
          );
        }
      },

      regenerateDoses: (activeProtocolId) => {
        const state = get();
        const active = state.activeProtocols.find(a => a.id === activeProtocolId);
        if (!active) return;
        const liveProtocol = state.protocols.find(p => p.id === active.protocolId) ?? active.protocol;
        const nowDate = today();
        const doseIdsWithRecords = new Set(
          state.doseRecords
            .filter(record => Boolean(record.scheduledDoseId))
            .map(record => record.scheduledDoseId),
        );
        const retainedFutureSlots = new Set<string>();

        // Remove only pending future rows; preserve handled/history-attached rows.
        set(s => ({
          scheduledDoses: s.scheduledDoses.filter(d => {
            if (d.activeProtocolId !== activeProtocolId) return true;
            if (d.scheduledDate < nowDate) return true;
            const hasDurableHistory = doseIdsWithRecords.has(d.id);
            const hasSnoozeLink = Boolean(d.snoozedUntil);
            const isPending = d.status === 'pending';
            const shouldDelete = isPending && !hasDurableHistory && !hasSnoozeLink;
            if (shouldDelete) return false;
            retainedFutureSlots.add(doseSlotKey(d.protocolItemId, d.scheduledDate, d.scheduledTime));
            return true;
          }),
        }));

        // Re-generate from today
        const fromDate = nowDate;
        const toDate = format(addDays(parseISO(fromDate), 89), 'yyyy-MM-dd');
        const candidateDoses: ScheduledDose[] = [];
        for (const item of liveProtocol.items) {
          const raw = expandItemToDoses(item, active, fromDate, toDate);
          candidateDoses.push(...raw.map(d => ({ ...d, protocolItem: item, activeProtocol: active })));
        }
        const newDoses = candidateDoses.filter(
          d => !retainedFutureSlots.has(doseSlotKey(d.protocolItemId, d.scheduledDate, d.scheduledTime)),
        );
        set(s => ({ scheduledDoses: [...s.scheduledDoses, ...newDoses] }));
        if (state.profile?.id) {
          syncFireAndForget(
            syncRegeneratedDoses(state.profile.id, active, fromDate, newDoses),
            {
              kind: 'regeneratedDoses',
              payload: { userId: state.profile.id, active, fromDate, newDoses },
            },
          );
        }
      },

      // ── Settings ──────────────────────────────────────────────────────

      updateNotificationSettings: (patch) => {
        set(s => ({ notificationSettings: { ...s.notificationSettings, ...patch } }));
      },

      // ── Derived ───────────────────────────────────────────────────────

      getAdherencePct: (date) => {
        const doses = get().selectProgressDayDoses(date);
        if (!doses.length) return 0;
        const taken = doses.filter(d => d.status === 'taken').length;
        return Math.round((taken / doses.length) * 100);
      },

      getStreak: () => {
        let streak = 0;
        let cursor = new Date();
        for (let i = 0; i < 365; i++) {
          const dateStr = format(cursor, 'yyyy-MM-dd');
          const pct = get().getAdherencePct(dateStr);
          if (pct === 100) streak++;
          else if (i > 0) break; // streak ends
          cursor = addDays(cursor, -1);
        }
        return streak;
      },
    }),
    {
      name: 'medremind-store',
      // Custom storage: on QuotaExceededError, evict the old (oversized) entry
      // and retry. This recovers devices whose localStorage was filled by the
      // previous partialize that included scheduledDoses + doseRecords.
      storage: {
        getItem: (key: string) => {
          try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; }
        },
        setItem: (key: string, value: unknown) => {
          try {
            localStorage.setItem(key, JSON.stringify(value));
          } catch (err) {
            if (err instanceof DOMException && err.name === 'QuotaExceededError') {
              // Evict the stale oversized entry and retry once.
              localStorage.removeItem(key);
              try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
            }
          }
        },
        removeItem: (key: string) => localStorage.removeItem(key),
      },
      // Don't persist seed protocols — merge on load
      partialize: (s) => ({
        profile: s.profile,
        notificationSettings: s.notificationSettings,
        activeProtocols: s.activeProtocols,
        // scheduledDoses and doseRecords are excluded — they can be large
        // (100s–1000s of rows) and overflow the 5 MB iOS localStorage quota.
        // They are loaded from Supabase on boot instead.
        // user custom protocols only
        protocols: s.protocols.filter(p => !p.isTemplate),
      }),
      // Merge with seed data on rehydration
      merge: (persisted: unknown, current) => {
        const p = persisted as Partial<AppState>;
        return {
          ...current,
          ...p,
          protocols: [...SEED_PROTOCOLS, ...(p.protocols ?? [])],
          drugs: SEED_DRUGS,
        };
      },
    }
  )
);
