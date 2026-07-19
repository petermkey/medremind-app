// W4-A Smart Food-Timed Reminders — pure math. Clock-free, zero imports
// (daySchedule.ts precedent), registered in test:unit. Consumed by BOTH the
// notify cron (server) and the Schedule page hint (client) so push and UI
// agree by construction. Adjusts the PUSH MOMENT only — planned_occurrences
// and store schedules are never modified.

export const SMART_SHIFT_CAP_MINUTES = 90;
export const MIN_FOOD_DAYS = 7;
export const FASTING_LEAD_MINUTES = 30;
export const MEAL_ALIGN_THRESHOLD_MINUTES = 60;

export type EatingPattern = {
  daysWithData: number;
  medianFirstMealMinutes: number | null; // minutes since local midnight
  medianLastMealMinutes: number | null;
};

export type DayMealTimes = { firstMeal: string | null; lastMeal: string | null };

export function minutesFromHHMM(time: unknown): number | null {
  if (typeof time !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function hhmmFromMinutes(minutes: number): string {
  const clamped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// days = per-day computeEatingWindow outputs (src/lib/nutrition/eatingWindow.ts, W1-B).
export function deriveEatingPattern(days: DayMealTimes[]): EatingPattern {
  const firsts: number[] = [];
  const lasts: number[] = [];
  for (const day of days) {
    const first = minutesFromHHMM(day.firstMeal);
    const last = minutesFromHHMM(day.lastMeal);
    if (first === null || last === null) continue;
    firsts.push(first);
    lasts.push(last);
  }
  return {
    daysWithData: firsts.length,
    medianFirstMealMinutes: median(firsts),
    medianLastMealMinutes: median(lasts),
  };
}

// Setting gate. settingValue comes straight from the DB row — anything that is
// not literally `true` (including undefined when migration 030 is not applied
// yet) leaves the feature inert.
export function resolveSmartTimingActive(settingValue: unknown, pattern: EatingPattern | null): boolean {
  return settingValue === true && pattern !== null && pattern.daysWithData >= MIN_FOOD_DAYS;
}

// Quiet window shape = external_health_connections.sleep_window.optimal_bedtime
// (seconds relative to local midnight, negative = evening before) — the same
// contract quietHours.ts validates. Re-validated locally to stay a leaf module.
export type QuietWindowOffsets = { start_offset: number; end_offset: number };

export function sanitizeQuietWindow(value: unknown): QuietWindowOffsets | null {
  if (!value || typeof value !== 'object') return null;
  const { start_offset, end_offset } = value as { start_offset?: unknown; end_offset?: unknown };
  if (typeof start_offset !== 'number' || typeof end_offset !== 'number') return null;
  if (!Number.isFinite(start_offset) || !Number.isFinite(end_offset)) return null;
  const length = end_offset - start_offset;
  if (length <= 0 || length > 12 * 3600) return null;
  return { start_offset, end_offset };
}

export function minutesInQuietWindow(minutes: number, window: QuietWindowOffsets | null): boolean {
  if (!window) return false;
  const t = minutes * 60;
  const day = 86400;
  return (
    (t >= window.start_offset && t <= window.end_offset) ||
    (t - day >= window.start_offset && t - day <= window.end_offset)
  );
}

export type AdjustReminderInput = {
  occurrenceMinutes: number;        // scheduled HH:MM as minutes since midnight
  withFood: unknown;                // protocol_items.with_food ('yes'|'no'|'any'|null)
  pattern: EatingPattern;
  isSnoozeReplacement: boolean;     // snoozed times are the user's explicit choice
  quietWindow: unknown;             // raw optimal_bedtime value (or null)
  capMinutes?: number;
  minDaysOfData?: number;
  fastingLeadMinutes?: number;
  mealAlignThresholdMinutes?: number;
};

// Returns the adjusted reminder time (minutes since local midnight, same day)
// or null = keep the scheduled time. Never crosses the quiet window, never
// shifts more than the cap, inert on thin data.
export function computeAdjustedReminderTime(input: AdjustReminderInput): number | null {
  const cap = input.capMinutes ?? SMART_SHIFT_CAP_MINUTES;
  const minDays = input.minDaysOfData ?? MIN_FOOD_DAYS;
  const lead = input.fastingLeadMinutes ?? FASTING_LEAD_MINUTES;
  const threshold = input.mealAlignThresholdMinutes ?? MEAL_ALIGN_THRESHOLD_MINUTES;

  if (input.isSnoozeReplacement) return null;
  if (input.pattern.daysWithData < minDays) return null;
  const first = input.pattern.medianFirstMealMinutes;
  const last = input.pattern.medianLastMealMinutes;
  if (first === null || last === null || last <= first) return null;

  const t = input.occurrenceMinutes;
  if (!Number.isFinite(t) || t < 0 || t > 1439) return null;

  let target: number;
  if (input.withFood === 'no') {
    // Empty stomach: act only when the scheduled time sits inside the typical
    // eating window; aim ≥30 min before the median first meal.
    if (t < first || t > last) return null;
    target = first - lead;
  } else if (input.withFood === 'yes') {
    const nearestMeal = Math.abs(t - first) <= Math.abs(t - last) ? first : last;
    if (Math.abs(t - nearestMeal) <= threshold) return null;
    target = nearestMeal;
  } else {
    return null;
  }

  const delta = Math.max(-cap, Math.min(cap, target - t));
  const adjusted = t + delta;
  if (adjusted === t || adjusted < 0 || adjusted > 1439) return null;
  if (input.withFood === 'no' && adjusted >= first && adjusted <= last) return null; // cap could not escape the window
  if (minutesInQuietWindow(adjusted, sanitizeQuietWindow(input.quietWindow))) return null;
  return adjusted;
}

// Minute-granular re-check of a candidate's EFFECTIVE time against the true
// ±1 min fire window (computeWindowSegments output shape) — mirrors the SQL
// filter semantics of cron/notify Pass A.
export type FireSegment = { date: string; startTime: string; endTime: string };

export function firesInSegments(occurrenceDate: string, effectiveMinutes: number, segments: FireSegment[]): boolean {
  return segments.some((segment) => {
    if (segment.date !== occurrenceDate) return false;
    const start = minutesFromHHMM(segment.startTime);
    const end = minutesFromHHMM(segment.endTime);
    if (start === null || end === null) return false;
    return effectiveMinutes >= start && effectiveMinutes <= end;
  });
}
