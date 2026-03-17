// ─── Core domain types ────────────────────────────────────────────────

export type DoseForm =
  | 'tablet' | 'capsule' | 'injection' | 'cream' | 'drops'
  | 'powder' | 'liquid' | 'patch' | 'inhaler' | 'other';

export type RouteOfAdmin =
  | 'oral' | 'subcutaneous' | 'intramuscular' | 'topical'
  | 'sublingual' | 'inhalation' | 'iv' | 'nasal' | 'other';

export type FrequencyType =
  | 'daily' | 'twice_daily' | 'three_times_daily'
  | 'every_n_hours' | 'every_n_days' | 'weekly' | 'custom';

export type ItemType = 'medication' | 'analysis' | 'therapy';

export type DoseStatus = 'pending' | 'taken' | 'skipped' | 'snoozed' | 'overdue';

export type ProtocolStatus = 'active' | 'paused' | 'completed' | 'abandoned';

export type ProtocolCategory =
  | 'general' | 'cardiovascular' | 'metabolic' | 'hormonal'
  | 'neurological' | 'immune' | 'custom';

// ─── Drug catalogue ────────────────────────────────────────────────────

export interface Drug {
  id: string;
  name: string;
  genericName?: string;
  category?: string;
  commonDoses?: { amount: number; unit: string }[];
  routes?: RouteOfAdmin[];
  notes?: string;
  isCustom: boolean;
  createdBy?: string;
}

// ─── Protocol ──────────────────────────────────────────────────────────

export interface ProtocolItem {
  id: string;
  protocolId: string;
  itemType: ItemType;
  name: string;
  drugId?: string;
  doseAmount?: number;
  doseUnit?: string;         // mg, mcg, IU, ml, units
  doseForm?: DoseForm;
  route?: RouteOfAdmin;
  frequencyType: FrequencyType;
  frequencyValue?: number;   // N for every_n_hours / every_n_days
  times: string[];           // ['08:00', '21:00']
  withFood?: 'yes' | 'no' | 'any';
  instructions?: string;
  startDay: number;          // day within protocol
  endDay?: number;
  sortOrder: number;
  color?: string;            // display color key
  icon?: string;             // emoji
}

export interface Protocol {
  id: string;
  ownerId?: string;          // null = global template
  name: string;
  description?: string;
  category: ProtocolCategory;
  durationDays?: number;     // null = ongoing
  isTemplate: boolean;
  isArchived: boolean;
  items: ProtocolItem[];
  createdAt: string;
}

// ─── Active protocol (user instance) ───────────────────────────────────

export interface ActiveProtocol {
  id: string;
  userId: string;
  protocolId: string;
  protocol: Protocol;
  status: ProtocolStatus;
  startDate: string;         // ISO date string YYYY-MM-DD
  endDate?: string;
  pausedAt?: string;
  completedAt?: string;
  notes?: string;
  createdAt: string;
}

// ─── Scheduled dose ────────────────────────────────────────────────────

export interface ScheduledDose {
  id: string;
  userId: string;
  activeProtocolId: string;
  protocolItemId: string;
  protocolItem: ProtocolItem;
  activeProtocol: ActiveProtocol;
  scheduledDate: string;     // YYYY-MM-DD
  scheduledTime: string;     // HH:MM
  status: DoseStatus;
  snoozedUntil?: string;
}

// ─── Dose record (immutable log) ───────────────────────────────────────

export interface DoseRecord {
  id: string;
  userId: string;
  scheduledDoseId: string;
  action: 'taken' | 'skipped' | 'snoozed';
  recordedAt: string;
  note?: string;
}

// ─── User / profile ────────────────────────────────────────────────────

export type AgeRange = '18-30' | '31-50' | '51-70' | '70+';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  timezone: string;
  ageRange?: AgeRange;
  onboarded: boolean;
  createdAt: string;
}

export interface NotificationSettings {
  pushEnabled: boolean;
  emailEnabled: boolean;
  leadTimeMin: number;       // notify N min before dose
  digestTime: string;        // HH:MM
}

// ─── App state helpers ──────────────────────────────────────────────────

export interface DaySchedule {
  date: string;
  doses: ScheduledDose[];
  adherencePct: number;
}

export interface AdherenceStats {
  totalDoses: number;
  takenDoses: number;
  skippedDoses: number;
  adherencePct: number;
  currentStreak: number;
  bestStreak: number;
}
