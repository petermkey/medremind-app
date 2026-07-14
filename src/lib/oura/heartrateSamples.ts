// Validation and batching for /v2/usercollection/heartrate rows.
// Leaf module (zero imports) so the strip-types test runner can load it directly.

export type OuraHeartrateSampleRow = { ts: string; bpm: number; source: string };

const SOURCES = new Set(['awake', 'workout', 'rest', 'sleep', 'live', 'session']);

export function parseHeartrateRows(data: unknown): OuraHeartrateSampleRow[] {
  if (!Array.isArray(data)) return [];
  const rows: OuraHeartrateSampleRow[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const { timestamp, bpm, source } = item as { timestamp?: unknown; bpm?: unknown; source?: unknown };
    if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) continue;
    if (typeof bpm !== 'number' || !Number.isInteger(bpm) || bpm < 20 || bpm > 250) continue;
    if (typeof source !== 'string' || !SOURCES.has(source)) continue;
    rows.push({ ts: timestamp, bpm, source });
  }
  return rows;
}

export function chunkRows<TRow>(rows: TRow[], size: number): TRow[][] {
  const chunks: TRow[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}
