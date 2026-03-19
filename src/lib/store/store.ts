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
  syncActivation,
  syncActiveStatus,
  syncDoseAction,
  syncProtocolDelete,
  syncProtocolItemDelete,
  syncProtocolUpsert,
  syncRegeneratedDoses,
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

const today = () => format(new Date(), 'yyyy-MM-dd');
const nowTime = () => format(new Date(), 'HH:mm');

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

function normalizeDurationDays(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const days = Math.trunc(value);
  return days > 0 ? days : undefined;
}

function computeInclusiveEndDate(startDate: string, durationDays: number | undefined): string | undefined {
  if (!durationDays) return undefined;
  return format(addDays(parseISO(startDate), durationDays - 1), 'yyyy-MM-dd');
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
  getVisibleDoseDates: () => string[];
  takeDose: (doseId: string, note?: string) => void;
  skipDose: (doseId: string, note?: string) => void;
  snoozeDose: (doseId: string, option: number | { until: string }) => void;
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
        set(s => ({
          activeProtocols: s.activeProtocols.map(ap =>
            ap.id === activeId ? { ...ap, status: 'paused' as ProtocolStatus, pausedAt } : ap
          ),
        }));
        if (profileId) {
          syncFireAndForget(
            syncActiveStatus(profileId, activeId, { status: 'paused', pausedAt }),
            { kind: 'activeStatus', payload: { userId: profileId, activeId, patch: { status: 'paused', pausedAt } } },
          );
        }
      },

      resumeProtocol: (activeId) => {
        const profileId = get().profile?.id;
        set(s => ({
          activeProtocols: s.activeProtocols.map(ap =>
            ap.id === activeId ? { ...ap, status: 'active' as ProtocolStatus, pausedAt: undefined } : ap
          ),
        }));
        if (profileId) {
          syncFireAndForget(
            syncActiveStatus(profileId, activeId, { status: 'active' }),
            { kind: 'activeStatus', payload: { userId: profileId, activeId, patch: { status: 'active' } } },
          );
        }
      },

      completeProtocol: (activeId) => {
        const completedAt = new Date().toISOString();
        const profileId = get().profile?.id;
        set(s => ({
          activeProtocols: s.activeProtocols.map(ap =>
            ap.id === activeId ? { ...ap, status: 'completed' as ProtocolStatus, completedAt } : ap
          ),
        }));
        if (profileId) {
          syncFireAndForget(
            syncActiveStatus(profileId, activeId, { status: 'completed', completedAt }),
            { kind: 'activeStatus', payload: { userId: profileId, activeId, patch: { status: 'completed', completedAt } } },
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
              syncProtocolUpsert(profileId, archivedProtocol),
              { kind: 'protocolUpsert', payload: { userId: profileId, protocol: archivedProtocol } },
            );
            for (const active of relatedActive) {
              syncFireAndForget(
                syncActiveStatus(profileId, active.id, { status: 'abandoned' }),
                {
                  kind: 'activeStatus',
                  payload: {
                    userId: profileId,
                    activeId: active.id,
                    patch: { status: 'abandoned' },
                  },
                },
              );
            }
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

      getVisibleDoseDates: () => {
        const todayDate = today();
        const activeIds = new Set(
          get().activeProtocols
            .filter(ap => ap.status === 'active')
            .map(ap => ap.id),
        );
        const dates = new Set<string>();
        get().scheduledDoses.forEach(d => {
          if (d.scheduledDate < todayDate || activeIds.has(d.activeProtocolId)) {
            dates.add(d.scheduledDate);
          }
        });
        return [...dates];
      },

      takeDose: (doseId, note) => {
        const state = get();
        const dose = state.scheduledDoses.find(d => d.id === doseId);
        if (!dose) return;
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
            syncDoseAction(state.profile.id, dose, { status: 'taken' }, record),
            { kind: 'doseAction', payload: { userId: state.profile.id, dose, patch: { status: 'taken' }, record } },
          );
        }
      },

      skipDose: (doseId, note) => {
        const state = get();
        const dose = state.scheduledDoses.find(d => d.id === doseId);
        if (!dose) return;
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
            syncDoseAction(state.profile.id, dose, { status: 'skipped' }, record),
            { kind: 'doseAction', payload: { userId: state.profile.id, dose, patch: { status: 'skipped' }, record } },
          );
        }
      },

      snoozeDose: (doseId, option) => {
        const state = get();
        const dose = state.scheduledDoses.find(d => d.id === doseId);
        if (!dose) return;
        const targetDate = typeof option === 'number'
          ? new Date(Date.now() + option * 60000)
          : new Date(option.until);
        if (Number.isNaN(targetDate.getTime())) return;
        const snoozedUntil = targetDate.toISOString();
        const scheduledDate = format(targetDate, 'yyyy-MM-dd');
        const scheduledTime = format(targetDate, 'HH:mm');
        const existingRecord = state.doseRecords.find(
          r => r.scheduledDoseId === doseId && r.action === 'snoozed',
        );
        const sameSnoozeTarget = (
          dose.status === 'snoozed'
          && dose.snoozedUntil === snoozedUntil
          && dose.scheduledDate === scheduledDate
          && dose.scheduledTime === scheduledTime
        );
        const record: DoseRecord = existingRecord ?? {
          id: generateId('dose-record'),
          userId: state.profile?.id ?? '',
          scheduledDoseId: doseId,
          action: 'snoozed',
          recordedAt: new Date().toISOString(),
        };
        const shouldAppendRecord = !existingRecord;
        const shouldUpdateStatus = !sameSnoozeTarget;
        if (shouldAppendRecord || shouldUpdateStatus) {
          set(s => ({
            scheduledDoses: s.scheduledDoses.map(d =>
              d.id === doseId
                ? {
                  ...d,
                  status: 'snoozed' as DoseStatus,
                  snoozedUntil,
                  scheduledDate,
                  scheduledTime,
                }
                : d
            ),
            doseRecords: shouldAppendRecord ? [...s.doseRecords, record] : s.doseRecords,
          }));
        }
        if (state.profile?.id) {
          syncFireAndForget(
            syncDoseAction(
              state.profile.id,
              dose,
              { status: 'snoozed', snoozedUntil, scheduledDate, scheduledTime },
              record,
            ),
            {
              kind: 'doseAction',
              payload: {
                userId: state.profile.id,
                dose,
                patch: { status: 'snoozed', snoozedUntil, scheduledDate, scheduledTime },
                record,
              },
            },
          );
        }
      },

      regenerateDoses: (activeProtocolId) => {
        const state = get();
        const active = state.activeProtocols.find(a => a.id === activeProtocolId);
        if (!active) return;
        const liveProtocol = state.protocols.find(p => p.id === active.protocolId) ?? active.protocol;

        // Remove existing future doses for this protocol
        const nowDate = today();
        set(s => ({
          scheduledDoses: s.scheduledDoses.filter(d =>
            d.activeProtocolId !== activeProtocolId || d.scheduledDate < nowDate
          ),
        }));

        // Re-generate from today
        const fromDate = nowDate;
        const toDate = format(addDays(parseISO(fromDate), 89), 'yyyy-MM-dd');
        const newDoses: ScheduledDose[] = [];
        for (const item of liveProtocol.items) {
          const raw = expandItemToDoses(item, active, fromDate, toDate);
          newDoses.push(...raw.map(d => ({ ...d, protocolItem: item, activeProtocol: active })));
        }
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
        const doses = get().scheduledDoses.filter(d => d.scheduledDate === date);
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
      // Don't persist seed protocols — merge on load
      partialize: (s) => ({
        profile: s.profile,
        notificationSettings: s.notificationSettings,
        activeProtocols: s.activeProtocols,
        scheduledDoses: s.scheduledDoses,
        doseRecords: s.doseRecords,
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
