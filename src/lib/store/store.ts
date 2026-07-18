'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { format, addDays, parseISO } from 'date-fns';
import type {
  UserProfile, ActiveProtocol, Protocol, ProtocolItem,
  ScheduledDose, DoseRecord, DoseStatus, NotificationSettings,
  ProtocolStatus, PlannedOccurrence, ExecutionEvent,
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
  today,
  isFutureDoseByDate,
  isOverdue,
  getDayScheduleFromState,
  buildExecutionEvent,
  projectToOccurrence,
  generateId,
  buildSnoozeReplacementDoseId,
  resolveSnoozeTargetSlot,
  normalizeDurationDays,
  computeInclusiveEndDate,
  doseSlotKey,
  buildLifecycleCommandOperationId,
  expandItemToDoses,
} from './storeHelpers';
import { syncFireAndForget, waitForRealtimeSyncIdle } from './syncState';
import { computeStreak } from './streak';
import type { StreakDay } from './streak';

export { waitForRealtimeSyncIdle };

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
  // F4: canonical local action history — populated by take/skip/snooze write path.
  // doseRecords remains for backward compat with legacy data; new actions write to both.
  executionEvents: ExecutionEvent[];
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
  selectCalendarVisibleDoseDates: (anchorDate: string, lookbackDays?: number, lookaheadDays?: number) => string[];

  // F3 — occurrence-based selectors (PlannedOccurrence extends ScheduledDose;
  // all existing consumers continue to work without changes).
  // These replace selectAppActionableDoses + selectHistoryDayRows as the canonical read path.
  selectActionableOccurrences: (date: string) => PlannedOccurrence[];
  selectHistoryOccurrences: (date: string) => PlannedOccurrence[];

  takeDose: (doseId: string, note?: string) => void;
  skipDose: (doseId: string, note?: string) => void;
  snoozeDose: (doseId: string, option: number | { until: string }) => void;
  removeDose: (doseId: string) => void;
  endProtocolFromToday: (activeProtocolId: string, fromDate?: string) => void;
  // excludeSlotKeys: removal tombstones (cancelled cloud occurrences) whose
  // slots must not be recreated — see cloudStore pull.
  regenerateDoses: (activeProtocolId: string, excludeSlotKeys?: ReadonlySet<string>) => void;

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
        morningBriefingEnabled: false,
        smartFoodTiming: false,
      },
      protocols: SEED_PROTOCOLS,
      activeProtocols: [],
      scheduledDoses: [],
      doseRecords: [],
      executionEvents: [],
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
          morningBriefingEnabled: false,
          smartFoodTiming: false,
        },
        protocols: SEED_PROTOCOLS,
        activeProtocols: [],
        scheduledDoses: [],
        doseRecords: [],
        executionEvents: [],
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
          morningBriefingEnabled: false,
          smartFoodTiming: false,
        },
        protocols: SEED_PROTOCOLS,
        activeProtocols: [],
        scheduledDoses: [],
        doseRecords: [],
        executionEvents: [],
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

        set(s => ({ scheduledDoses: [...s.scheduledDoses, ...newDoses] }));
        syncFireAndForget(
          syncActivation(state.profile.id, active, newDoses),
          { kind: 'activation', payload: { userId: state.profile.id, active, doses: newDoses } },
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

      selectAppNextDose: (date) => {
        const actionable = get().selectActionableOccurrences(date);
        return actionable
          .filter(d => d.status === 'pending' || (d.status as string) === 'upcoming')
          .sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime))[0];
      },

      selectAppSummaryMetrics: (date) => {
        // Use getDayScheduleFromState directly — needs both taken + pending for accurate adherence %.
        // Exclude superseded (snoozed origins) and snoozed to avoid double-counting.
        const doses = getDayScheduleFromState(get().scheduledDoses, get().activeProtocols, date)
          .filter(d => !d.successorDoseId && d.status !== 'snoozed');
        const taken = doses.filter(d => d.status === 'taken').length;
        const total = doses.length;
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
        return getDayScheduleFromState(get().scheduledDoses, get().activeProtocols, date)
          .filter(d => d.status !== 'snoozed');
      },

      selectProgressSummaryForDates: (dates) => {
        const profile = get().profile;
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
          // legacy DB rows may have status='overdue'; new rows stay 'pending' — derive both
          overdue += doses.filter(d => d.status === 'overdue' || isOverdue(d, profile)).length;
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

      // ── F3 occurrence-based selectors ─────────────────────────────────
      //
      // selectActionableOccurrences replaces selectAppActionableDoses as the
      // canonical read path for today/future schedule UI. Filtering is driven
      // by occurrenceStatus (structural) rather than mixed DoseStatus inference.
      //
      // selectHistoryOccurrences replaces selectHistoryDayRows for past-day
      // history surfaces, using the same occurrence projection.

      selectActionableOccurrences: (date) => {
        const doses = getDayScheduleFromState(get().scheduledDoses, get().activeProtocols, date);
        return doses
          .filter(d => {
            const o = projectToOccurrence(d);
            // Superseded slots (snoozed origins) are not shown in today's view.
            if (o.occurrenceStatus === 'superseded') return false;
            // Skipped doses are not actionable and not shown.
            if (d.status === 'skipped') return false;
            // Taken doses remain visible (shown with taken state in the card).
            return true;
          })
          .map(projectToOccurrence);
      },

      selectHistoryOccurrences: (date) => {
        const state = get();
        const todayDate = today();
        if (date >= todayDate) return [];

        // F4: build lookup sets from both legacy doseRecords and new executionEvents.
        // executionEvents is the canonical source for new actions; doseRecords covers legacy data.
        const handledByRecord = new Set<string>();
        for (const record of state.doseRecords) {
          if (record.action === 'taken' || record.action === 'skipped') {
            handledByRecord.add(record.scheduledDoseId);
          }
        }
        const handledByEvent = new Set<string>();
        for (const event of state.executionEvents) {
          if (event.eventType === 'taken' || event.eventType === 'skipped') {
            handledByEvent.add(event.legacyScheduledDoseId);
          }
        }

        return state.scheduledDoses
          .filter(dose => {
            if (dose.scheduledDate !== date) return false;
            const o = projectToOccurrence(dose);
            // Superseded occurrences (snoozed origins) never appear on their original day.
            if (o.occurrenceStatus === 'superseded') return false;
            const isHandledStatus = dose.status === 'taken' || dose.status === 'skipped';
            return isHandledStatus || handledByRecord.has(dose.id) || handledByEvent.has(dose.id);
          })
          .map(projectToOccurrence)
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
        const executionEvent = buildExecutionEvent(dose, record, 'taken', clientOperationId);
        if (shouldAppendRecord || shouldUpdateStatus) {
          set(s => ({
            scheduledDoses: s.scheduledDoses.map(d =>
              d.id === doseId ? { ...d, status: 'taken' as DoseStatus } : d
            ),
            doseRecords: shouldAppendRecord ? [...s.doseRecords, record] : s.doseRecords,
            executionEvents: shouldAppendRecord
              ? [...s.executionEvents, executionEvent]
              : s.executionEvents,
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
        const executionEvent = buildExecutionEvent(dose, record, 'skipped', clientOperationId);
        if (shouldAppendRecord || shouldUpdateStatus) {
          set(s => ({
            scheduledDoses: s.scheduledDoses.map(d =>
              d.id === doseId ? { ...d, status: 'skipped' as DoseStatus } : d
            ),
            doseRecords: shouldAppendRecord ? [...s.doseRecords, record] : s.doseRecords,
            executionEvents: shouldAppendRecord
              ? [...s.executionEvents, executionEvent]
              : s.executionEvents,
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
          predecessorDoseId: dose.id,
          successorDoseId: undefined,
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
              const updated = s.scheduledDoses.map(d => {
                if (d.id === doseId) {
                  return {
                    ...d,
                    status: 'snoozed' as DoseStatus,
                    snoozedUntil,
                    successorDoseId: replacementDoseId,
                  };
                }
                // When reusing an existing dose as replacement, stamp its predecessor.
                if (reuseExistingId && d.id === reuseExistingId) {
                  return { ...d, predecessorDoseId: doseId };
                }
                return d;
              });
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
            executionEvents: shouldAppendRecord
              ? [...s.executionEvents, buildExecutionEvent(replacementDose, record, 'snoozed', clientOperationId)]
              : s.executionEvents,
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
        const dose = state.scheduledDoses.find(d => d.id === doseId);
        set(s => ({
          scheduledDoses: s.scheduledDoses.filter(d => d.id !== doseId),
        }));
        if (profileId && dose) {
          syncFireAndForget(
            syncRemoveDoseCommand(profileId, dose),
            { kind: 'removeDose', payload: { userId: profileId, doseId, dose } },
          );
        }
      },

      endProtocolFromToday: (activeProtocolId, fromDate) => {
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

      regenerateDoses: (activeProtocolId, excludeSlotKeys) => {
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
          d => !retainedFutureSlots.has(doseSlotKey(d.protocolItemId, d.scheduledDate, d.scheduledTime))
            && !excludeSlotKeys?.has(doseSlotKey(d.protocolItemId, d.scheduledDate, d.scheduledTime)),
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
        const days: StreakDay[] = [];
        let cursor = new Date();
        for (let i = 0; i < 365; i++) {
          const doses = get().selectProgressDayDoses(format(cursor, 'yyyy-MM-dd'));
          days.push({
            scheduled: doses.length,
            taken: doses.filter(d => d.status === 'taken').length,
          });
          cursor = addDays(cursor, -1);
        }
        return computeStreak(days);
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
        // Keep cloud-owned, high-churn slices out of hydration even if an older
        // app version left them in localStorage.
        return {
          ...current,
          profile: p.profile ?? current.profile,
          notificationSettings: {
            ...current.notificationSettings,
            ...(p.notificationSettings ?? {}),
          },
          activeProtocols: p.activeProtocols ?? current.activeProtocols,
          protocols: [...SEED_PROTOCOLS, ...(p.protocols ?? [])],
          drugs: SEED_DRUGS,
        };
      },
    }
  )
);
