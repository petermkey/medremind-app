// Decides whether "now" is inside the user's Oura optimal-bedtime window.
// Offsets are seconds relative to a local midnight; negative = the evening
// before. Pure leaf module (zero imports) for the strip-types test runner.

export type SleepWindow = { start_offset: number; end_offset: number };

const MAX_WINDOW_SECONDS = 12 * 3600;

function asWindow(value: unknown): SleepWindow | null {
  if (!value || typeof value !== 'object') return null;
  const { start_offset, end_offset } = value as { start_offset?: unknown; end_offset?: unknown };
  if (typeof start_offset !== 'number' || typeof end_offset !== 'number') return null;
  if (!Number.isFinite(start_offset) || !Number.isFinite(end_offset)) return null;
  const length = end_offset - start_offset;
  if (length <= 0 || length > MAX_WINDOW_SECONDS) return null;
  return { start_offset, end_offset };
}

function secondsSinceLocalMidnight(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  return get('hour') * 3600 + get('minute') * 60 + get('second');
}

export function isInQuietHours(now: Date, timeZone: string, window: unknown): boolean {
  try {
    const parsed = asWindow(window);
    if (!parsed) return false;
    const t = secondsSinceLocalMidnight(now, timeZone);
    const day = 86400;
    return (
      (t >= parsed.start_offset && t <= parsed.end_offset) ||
      (t - day >= parsed.start_offset && t - day <= parsed.end_offset)
    );
  } catch {
    return false;
  }
}
