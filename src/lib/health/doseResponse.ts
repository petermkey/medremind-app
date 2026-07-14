// Pure math pairing medication "taken" events with the 5-min HR timeseries.
// Leaf module (zero imports) for the strip-types test runner.

export type HrSample = { ts: string; bpm: number; source: string };

const QUIET_SOURCES = new Set(['awake', 'rest']);
const DAYTIME_START_HOUR = 8;
const DAYTIME_END_HOUR = 22;
const MIN_DAYTIME_SAMPLES = 12;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function postDoseHrDelta(
  samples: HrSample[],
  doseTimesIso: string[],
  opts: { preMin?: number; postMin?: number; minSamplesPerSide?: number } = {},
): number | null {
  const preMs = (opts.preMin ?? 60) * 60_000;
  const postMs = (opts.postMin ?? 120) * 60_000;
  const minSide = opts.minSamplesPerSide ?? 3;

  const quiet = samples
    .filter((sample) => QUIET_SOURCES.has(sample.source))
    .map((sample) => ({ t: Date.parse(sample.ts), bpm: sample.bpm }))
    .filter((sample) => Number.isFinite(sample.t));

  const deltas: number[] = [];
  for (const doseIso of doseTimesIso) {
    const doseT = Date.parse(doseIso);
    if (!Number.isFinite(doseT)) continue;
    const pre = quiet.filter((sample) => sample.t >= doseT - preMs && sample.t < doseT).map((sample) => sample.bpm);
    const post = quiet.filter((sample) => sample.t >= doseT && sample.t <= doseT + postMs).map((sample) => sample.bpm);
    if (pre.length < minSide || post.length < minSide) continue;
    deltas.push(median(post) - median(pre));
  }

  if (deltas.length === 0) return null;
  const meanDelta = deltas.reduce((total, delta) => total + delta, 0) / deltas.length;
  return Math.round(meanDelta * 10) / 10;
}

function localHour(iso: string, timeZone: string): number | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false }).format(date);
  const parsed = Number(hour);
  return Number.isFinite(parsed) ? parsed : null;
}

function localDateOf(iso: string, timeZone: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function daytimeAvgHr(samples: HrSample[], localDate: string, timeZone: string): number | null {
  const qualifying = samples.filter((sample) => {
    if (!QUIET_SOURCES.has(sample.source)) return false;
    if (localDateOf(sample.ts, timeZone) !== localDate) return false;
    const hour = localHour(sample.ts, timeZone);
    return hour !== null && hour >= DAYTIME_START_HOUR && hour < DAYTIME_END_HOUR;
  });
  if (qualifying.length < MIN_DAYTIME_SAMPLES) return null;
  const total = qualifying.reduce((acc, sample) => acc + sample.bpm, 0);
  return Math.round((total / qualifying.length) * 10) / 10;
}

export type DoseResponseRow = {
  local_date: string;
  post_dose_hr_delta_bpm: number | null;
  daytime_avg_hr: number | null;
};

function addDays(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Day-keyed rollup for the correlation featureBuilder. Buckets by UTC date
// prefix; post-dose windows crossing midnight are attributed to the dose date.
export function dailyDoseResponseRows(
  samples: HrSample[],
  takenTimesIso: string[],
  startDate: string,
  endDate: string,
  timeZone: string,
): DoseResponseRow[] {
  const samplesByDate = new Map<string, HrSample[]>();
  for (const sample of samples) {
    const date = sample.ts.slice(0, 10);
    const bucket = samplesByDate.get(date) ?? [];
    bucket.push(sample);
    samplesByDate.set(date, bucket);
  }
  const dosesByDate = new Map<string, string[]>();
  for (const iso of takenTimesIso) {
    const date = iso.slice(0, 10);
    const bucket = dosesByDate.get(date) ?? [];
    bucket.push(iso);
    dosesByDate.set(date, bucket);
  }

  const rows: DoseResponseRow[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    const daySamples = samplesByDate.get(date) ?? [];
    rows.push({
      local_date: date,
      post_dose_hr_delta_bpm: postDoseHrDelta(daySamples, dosesByDate.get(date) ?? []),
      daytime_avg_hr: daytimeAvgHr(daySamples, date, timeZone),
    });
  }
  return rows;
}
