export function localDateForIsoInTimezone(value: string, timezone?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  if (timezone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const map = new Map(parts.map(part => [part.type, part.value]));
    return `${map.get('year')}-${map.get('month')}-${map.get('day')}`;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function timezoneParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const map = new Map(parts.map(part => [part.type, part.value]));

  return {
    year: Number(map.get('year')),
    month: Number(map.get('month')),
    day: Number(map.get('day')),
    hour: Number(map.get('hour')),
    minute: Number(map.get('minute')),
    second: Number(map.get('second')),
  };
}

function timezoneOffsetMs(timezone: string, date: Date): number {
  const parts = timezoneParts(date, timezone);
  const utcFromParts = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0,
  );
  return utcFromParts - (date.getTime() - date.getMilliseconds());
}

function zonedLocalTimeToInstant(params: {
  selectedDate: string;
  timezone: string;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}): Date {
  const [year, month, day] = params.selectedDate.split('-').map(Number);
  const utcGuess = Date.UTC(
    year,
    month - 1,
    day,
    params.hour,
    params.minute,
    params.second,
    params.millisecond,
  );
  const firstGuess = new Date(utcGuess - timezoneOffsetMs(params.timezone, new Date(utcGuess)));
  const secondGuess = new Date(utcGuess - timezoneOffsetMs(params.timezone, firstGuess));
  return secondGuess;
}

export function consumedAtForSelectedDateInTimezone(
  selectedDate: string,
  timezone: string,
  now = new Date(),
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
    throw new Error('selectedDate must be an ISO date string.');
  }

  const currentTime = timezoneParts(now, timezone);
  return zonedLocalTimeToInstant({
    selectedDate,
    timezone,
    hour: currentTime.hour,
    minute: currentTime.minute,
    second: currentTime.second,
    millisecond: now.getMilliseconds(),
  }).toISOString();
}
