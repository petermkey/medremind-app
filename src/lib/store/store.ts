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

// ─── Helpers ───────────────────────────────────────────────────────────

const today = () => format(new Date(), 'yyyy-MM-dd');
const nowTime = () => format(new Date(), 'HH:mm');

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
          id: uuid(),
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
  const end = to;
  if (activeProtocol.endDate) {
    const protocolEnd = parseISO(activeProtocol.endDate);
    if (isBefore(protocolEnd, end)) cursor = new Date(Math.min(cursor.getTime(), protocolEnd.getTime()));
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
          id: uuid(),
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
  addProtocolItem: (protocolId: string, item: Omit<ProtocolItem, 'id' | 'protocolId'>) => void;
  removeProtocolItem: (protocolId: string, itemId: string) => void;

  // Actions — Schedule
  getDaySchedule: (date: string) => ScheduledDose[];
  takeDose: (doseId: string, note?: string) => void;
  skipDose: (doseId: string, note?: string) => void;
  snoozeDose: (doseId: string, minutes: number) => void;
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

      signUp: (email, password, name) => {
        _passwords[email] = password;
        const profile: UserProfile = {
          id: uuid(),
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

      signOut: () => set({ profile: null }),

      updateProfile: (patch) => {
        const p = get().profile;
        if (!p) return;
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

        const active: ActiveProtocol = {
          id: uuid(),
          userId: state.profile.id,
          protocolId,
          protocol,
          status: 'active',
          startDate,
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
        return active;
      },

      pauseProtocol: (activeId) => {
        set(s => ({
          activeProtocols: s.activeProtocols.map(ap =>
            ap.id === activeId ? { ...ap, status: 'paused' as ProtocolStatus, pausedAt: new Date().toISOString() } : ap
          ),
        }));
      },

      resumeProtocol: (activeId) => {
        set(s => ({
          activeProtocols: s.activeProtocols.map(ap =>
            ap.id === activeId ? { ...ap, status: 'active' as ProtocolStatus, pausedAt: undefined } : ap
          ),
        }));
      },

      completeProtocol: (activeId) => {
        set(s => ({
          activeProtocols: s.activeProtocols.map(ap =>
            ap.id === activeId ? { ...ap, status: 'completed' as ProtocolStatus, completedAt: new Date().toISOString() } : ap
          ),
        }));
      },

      createCustomProtocol: (p) => {
        const protocol: Protocol = {
          ...p,
          id: uuid(),
          ownerId: get().profile?.id,
          isTemplate: false,
          createdAt: new Date().toISOString(),
        };
        set(s => ({ protocols: [...s.protocols, protocol] }));
        return protocol;
      },

      updateProtocol: (id, patch) => {
        set(s => ({
          protocols: s.protocols.map(p => p.id === id ? { ...p, ...patch } : p),
        }));
      },

      addProtocolItem: (protocolId, item) => {
        const newItem: ProtocolItem = { ...item, id: uuid(), protocolId };
        set(s => ({
          protocols: s.protocols.map(p =>
            p.id === protocolId ? { ...p, items: [...p.items, newItem] } : p
          ),
        }));
      },

      removeProtocolItem: (protocolId, itemId) => {
        set(s => ({
          protocols: s.protocols.map(p =>
            p.id === protocolId ? { ...p, items: p.items.filter(i => i.id !== itemId) } : p
          ),
        }));
      },

      // ── Schedule ──────────────────────────────────────────────────────

      getDaySchedule: (date) => {
        const doses = get().scheduledDoses.filter(d => d.scheduledDate === date);
        return doses.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
      },

      takeDose: (doseId, note) => {
        const state = get();
        const record: DoseRecord = {
          id: uuid(),
          userId: state.profile?.id ?? '',
          scheduledDoseId: doseId,
          action: 'taken',
          recordedAt: new Date().toISOString(),
          note,
        };
        set(s => ({
          scheduledDoses: s.scheduledDoses.map(d =>
            d.id === doseId ? { ...d, status: 'taken' as DoseStatus } : d
          ),
          doseRecords: [...s.doseRecords, record],
        }));
      },

      skipDose: (doseId, note) => {
        const state = get();
        const record: DoseRecord = {
          id: uuid(),
          userId: state.profile?.id ?? '',
          scheduledDoseId: doseId,
          action: 'skipped',
          recordedAt: new Date().toISOString(),
          note,
        };
        set(s => ({
          scheduledDoses: s.scheduledDoses.map(d =>
            d.id === doseId ? { ...d, status: 'skipped' as DoseStatus } : d
          ),
          doseRecords: [...s.doseRecords, record],
        }));
      },

      snoozeDose: (doseId, minutes) => {
        const snoozedUntil = new Date(Date.now() + minutes * 60000).toISOString();
        set(s => ({
          scheduledDoses: s.scheduledDoses.map(d =>
            d.id === doseId ? { ...d, status: 'snoozed' as DoseStatus, snoozedUntil } : d
          ),
          doseRecords: [...s.doseRecords, {
            id: uuid(),
            userId: s.profile?.id ?? '',
            scheduledDoseId: doseId,
            action: 'snoozed',
            recordedAt: new Date().toISOString(),
          }],
        }));
      },

      regenerateDoses: (activeProtocolId) => {
        const state = get();
        const active = state.activeProtocols.find(a => a.id === activeProtocolId);
        if (!active) return;

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
        for (const item of active.protocol.items) {
          const raw = expandItemToDoses(item, active, fromDate, toDate);
          newDoses.push(...raw.map(d => ({ ...d, protocolItem: item, activeProtocol: active })));
        }
        set(s => ({ scheduledDoses: [...s.scheduledDoses, ...newDoses] }));
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
