export type HeartratePoint = { ts: string; bpm: number };
export type PulseMarkerKind = 'caffeine' | 'alcohol' | 'sauna' | 'other';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TZ_OFFSET_MINUTES = 14 * 60;

export const MAX_PULSE_POINTS = 288;

export function dayRangeUtc(
  localDate: unknown,
  tzOffsetMinutes: unknown,
): { startIso: string; endIso: string } | null {
  if (typeof localDate !== 'string' || !DATE_RE.test(localDate)) return null;
  if (typeof tzOffsetMinutes !== 'number' || !Number.isFinite(tzOffsetMinutes)) return null;
  if (Math.abs(tzOffsetMinutes) > MAX_TZ_OFFSET_MINUTES) return null;

  const baseMs = Date.parse(`${localDate}T00:00:00.000Z`);
  if (!Number.isFinite(baseMs)) return null;

  const startMs = baseMs + tzOffsetMinutes * 60_000;
  return {
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(startMs + DAY_MS).toISOString(),
  };
}

export function downsampleHeartrate(
  samples: unknown,
  maxPoints: number = MAX_PULSE_POINTS,
): HeartratePoint[] {
  if (!Array.isArray(samples) || maxPoints < 1) return [];

  const valid: Array<{ ms: number; bpm: number }> = [];
  for (const item of samples) {
    if (!item || typeof item !== 'object') continue;
    const { ts, bpm } = item as { ts?: unknown; bpm?: unknown };
    if (typeof ts !== 'string') continue;
    const ms = Date.parse(ts);
    if (!Number.isFinite(ms)) continue;
    if (typeof bpm !== 'number' || !Number.isFinite(bpm)) continue;
    valid.push({ ms, bpm });
  }
  valid.sort((a, b) => a.ms - b.ms);

  if (valid.length <= maxPoints) {
    return valid.map((sample) => ({
      ts: new Date(sample.ms).toISOString(),
      bpm: Math.round(sample.bpm),
    }));
  }

  const startMs = valid[0].ms;
  const spanMs = valid[valid.length - 1].ms - startMs;
  const bucketMs = Math.ceil((spanMs + 1) / maxPoints);
  const buckets = new Map<number, { sum: number; count: number; firstMs: number }>();

  for (const sample of valid) {
    const index = Math.min(maxPoints - 1, Math.floor((sample.ms - startMs) / bucketMs));
    const bucket = buckets.get(index);
    if (bucket) {
      bucket.sum += sample.bpm;
      bucket.count += 1;
    } else {
      buckets.set(index, { sum: sample.bpm, count: 1, firstMs: sample.ms });
    }
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([, bucket]) => ({
      ts: new Date(bucket.firstMs).toISOString(),
      bpm: Math.round(bucket.sum / bucket.count),
    }));
}

export function classifyTagType(tagType: unknown): PulseMarkerKind {
  if (typeof tagType !== 'string') return 'other';
  const lower = tagType.toLowerCase();
  if (lower.includes('caffeine') || lower.includes('coffee')) return 'caffeine';
  if (lower.includes('alcohol')) return 'alcohol';
  if (lower.includes('sauna')) return 'sauna';
  return 'other';
}
