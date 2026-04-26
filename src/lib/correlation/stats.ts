import type { CorrelationResult } from './types';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function pearsonCorrelation(xs: Array<number | null | undefined>, ys: Array<number | null | undefined>): number | null {
  const pairs: Array<[number, number]> = [];
  const length = Math.min(xs.length, ys.length);

  for (let index = 0; index < length; index += 1) {
    const x = xs[index];
    const y = ys[index];
    if (isFiniteNumber(x) && isFiniteNumber(y)) {
      pairs.push([x, y]);
    }
  }

  if (pairs.length < 4) return null;

  const meanX = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
  const meanY = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
  let numerator = 0;
  let varianceX = 0;
  let varianceY = 0;

  for (const [x, y] of pairs) {
    const dx = x - meanX;
    const dy = y - meanY;
    numerator += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }

  const denominator = Math.sqrt(varianceX * varianceY);
  if (denominator === 0) return null;

  const r = numerator / denominator;
  return Math.abs(r - 1) < 1e-12 ? 1 : Math.abs(r + 1) < 1e-12 ? -1 : r;
}

export function countPairedValues(xs: Array<number | null | undefined>, ys: Array<number | null | undefined>): number {
  const length = Math.min(xs.length, ys.length);
  let count = 0;
  for (let index = 0; index < length; index += 1) {
    const x = xs[index];
    const y = ys[index];
    if (isFiniteNumber(x) && isFiniteNumber(y)) count += 1;
  }
  return count;
}

export function rankByAbsoluteCorrelation<T extends CorrelationResult>(results: T[]): T[] {
  return [...results].sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
}
