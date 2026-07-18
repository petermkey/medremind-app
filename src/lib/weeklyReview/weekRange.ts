// src/lib/weeklyReview/weekRange.ts
// The most recent fully completed Mon–Sun week in the user's timezone.
// Pure leaf module (zero imports) — strip-types test-runner constraint.

function localDateFor(now: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const map = new Map(parts.map((part) => [part.type, part.value]));
    const date = `${map.get('year')}-${map.get('month')}-${map.get('day')}`;
    if (date.length === 10) return date;
  } catch {
    // invalid timezone string — fall through to UTC
  }
  return now.toISOString().slice(0, 10);
}

function addDaysIso(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function completedWeekRange(
  now: Date,
  timeZone: string,
): { weekStart: string; weekEnd: string } {
  const today = localDateFor(now, timeZone);
  const dayOfWeek = new Date(`${today}T00:00:00.000Z`).getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const currentMonday = addDaysIso(today, -daysSinceMonday);
  const weekStart = addDaysIso(currentMonday, -7);
  return { weekStart, weekEnd: addDaysIso(weekStart, 6) };
}
