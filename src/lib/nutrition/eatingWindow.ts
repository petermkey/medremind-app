export type EatingWindowEntry = {
  consumedAt: string;
  timezone?: string;
};

export type EatingWindowResult = {
  firstMeal: string | null;
  lastMeal: string | null;
  firstMealHour: number | null;
  lastMealHour: number | null;
  windowHours: number | null;
  lateFlag: boolean;
  mealCount: number;
};

export const LATE_MEAL_HOUR = 21;
export const STREAK_MAX_WINDOW_HOURS = 10;

const DEFAULT_STREAK_MAX_DAYS = 14;

type LocalParts = { localDate: string; hour: number; minute: number };

function safeTimezone(candidate: string | undefined, fallback: string): string {
  const value = candidate?.trim();
  if (!value) return fallback;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value });
    return value;
  } catch {
    return fallback;
  }
}

function localParts(iso: string, timezone: string): LocalParts | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const map = new Map(parts.map(part => [part.type, part.value]));
    const year = map.get('year');
    const month = map.get('month');
    const day = map.get('day');
    const hour = Number(map.get('hour'));
    const minute = Number(map.get('minute'));

    if (!year || !month || !day || !Number.isFinite(hour) || !Number.isFinite(minute)) {
      return null;
    }

    return { localDate: `${year}-${month}-${day}`, hour, minute };
  } catch {
    return null;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function totalMinutes(parts: LocalParts): number {
  return parts.hour * 60 + parts.minute;
}

export function computeEatingWindow(
  entries: EatingWindowEntry[],
  date: string,
  timezone: string,
): EatingWindowResult {
  const fallbackTimezone = safeTimezone(timezone, 'UTC');
  const dayParts: LocalParts[] = [];

  for (const entry of entries) {
    const parts = localParts(entry.consumedAt, safeTimezone(entry.timezone, fallbackTimezone));
    if (parts?.localDate === date) dayParts.push(parts);
  }

  if (dayParts.length === 0) {
    return {
      firstMeal: null,
      lastMeal: null,
      firstMealHour: null,
      lastMealHour: null,
      windowHours: null,
      lateFlag: false,
      mealCount: 0,
    };
  }

  let first = dayParts[0];
  let last = dayParts[0];
  for (const parts of dayParts) {
    if (totalMinutes(parts) < totalMinutes(first)) first = parts;
    if (totalMinutes(parts) > totalMinutes(last)) last = parts;
  }

  const firstMealHour = round2(first.hour + first.minute / 60);
  const lastMealHour = round2(last.hour + last.minute / 60);

  return {
    firstMeal: `${pad2(first.hour)}:${pad2(first.minute)}`,
    lastMeal: `${pad2(last.hour)}:${pad2(last.minute)}`,
    firstMealHour,
    lastMealHour,
    windowHours: round2((totalMinutes(last) - totalMinutes(first)) / 60),
    lateFlag: totalMinutes(last) >= LATE_MEAL_HOUR * 60,
    mealCount: dayParts.length,
  };
}

function addDaysToDateString(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function computeEatingWindowStreak(
  entries: EatingWindowEntry[],
  endDate: string,
  timezone: string,
  maxDays: number = DEFAULT_STREAK_MAX_DAYS,
): number {
  let streak = 0;
  for (let offset = 0; offset < maxDays; offset += 1) {
    const date = addDaysToDateString(endDate, -offset);
    const window = computeEatingWindow(entries, date, timezone);
    if (window.mealCount === 0 || window.windowHours === null) break;
    if (window.windowHours > STREAK_MAX_WINDOW_HOURS) break;
    streak += 1;
  }
  return streak;
}

export function formatWindowDuration(windowHours: number): string {
  const total = Math.round(windowHours * 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h${pad2(minutes)}m`;
}
