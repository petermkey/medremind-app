// Pure date/time logic for the Pass A notification window.
// Extracted from the cron route so it can be unit-tested.
//
// scheduled_doses stores scheduled_date (YYYY-MM-DD) and scheduled_time
// (HH:MM:SS) in the user's local timezone. A cron tick fires for doses whose
// local time falls within ±windowMinutes of (now + leadTimeMin). Because the
// stored values are local calendar fields, the UTC window must be projected
// into the user's timezone — and that projection can straddle local midnight,
// landing on two different calendar dates. Each resulting segment is a single
// (date, [startTime, endTime]) range with second-inclusive bounds.

export type WindowSegment = {
  date: string;       // YYYY-MM-DD (local)
  startTime: string;  // HH:MM:SS (inclusive)
  endTime: string;    // HH:MM:SS (inclusive)
};

function localDate(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;
  return `${year}-${month}-${day}`;
}

function localHHMM(d: Date, timeZone: string): string {
  return d.toLocaleString('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Compute the local-date/time segments covered by the Pass A fire window.
 * Bounds are second-inclusive (HH:MM:00 .. HH:MM:59) so a dose scheduled at
 * any second within a boundary minute is matched — lexicographic comparison
 * of HH:MM:SS strings against bare HH:MM bounds otherwise drops :SS > :00.
 * Returns one segment normally, or two when the window straddles local midnight.
 */
export function computeWindowSegments(
  now: Date,
  leadTimeMin: number,
  timeZone: string,
  windowMinutes: number,
): WindowSegment[] {
  const targetUtc = new Date(now.getTime() + leadTimeMin * 60 * 1000);
  const windowStart = new Date(targetUtc.getTime() - windowMinutes * 60 * 1000);
  const windowEnd = new Date(targetUtc.getTime() + windowMinutes * 60 * 1000);

  const startDate = localDate(windowStart, timeZone);
  const endDate = localDate(windowEnd, timeZone);
  const startTime = `${localHHMM(windowStart, timeZone)}:00`;
  const endTime = `${localHHMM(windowEnd, timeZone)}:59`;

  if (startDate === endDate) {
    return [{ date: startDate, startTime, endTime }];
  }

  // Window straddles local midnight — split into two single-date segments.
  return [
    { date: startDate, startTime, endTime: '23:59:59' },
    { date: endDate, startTime: '00:00:00', endTime },
  ];
}

/**
 * Build a PostgREST `.or()` filter string matching any of the given segments.
 * Each segment becomes an AND group on (dateCol, timeCol).
 * Defaults to V1 column names; pass V2 names for planned_occurrences queries.
 */
export function segmentsToOrFilter(
  segments: WindowSegment[],
  dateCol = 'scheduled_date',
  timeCol = 'scheduled_time',
): string {
  return segments
    .map(
      (s) =>
        `and(${dateCol}.eq.${s.date},${timeCol}.gte.${s.startTime},${timeCol}.lte.${s.endTime})`,
    )
    .join(',');
}
