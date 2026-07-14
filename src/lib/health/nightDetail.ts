// Pure math over the main Oura sleep document's intra-night arrays.
// Leaf module (zero imports) so the --experimental-strip-types test runner
// can load it directly.

const PHASE_RE = /^[1-4]+$/;
const EPOCH_MINUTES = 0.5;
const MIN_HRV_SAMPLES_PER_HALF = 3;

export function parseSleepPhaseFeatures(phase30: unknown): {
  deepSleepFirstThirdMinutes: number | null;
  minutesToFirstDeepSleep: number | null;
} {
  if (typeof phase30 !== 'string' || phase30.length === 0 || !PHASE_RE.test(phase30)) {
    return { deepSleepFirstThirdMinutes: null, minutesToFirstDeepSleep: null };
  }

  const firstThirdLength = Math.floor(phase30.length / 3);
  let deepInFirstThird = 0;
  for (let i = 0; i < firstThirdLength; i += 1) {
    if (phase30[i] === '1') deepInFirstThird += 1;
  }

  const firstDeepIndex = phase30.indexOf('1');

  return {
    deepSleepFirstThirdMinutes: Math.round(deepInFirstThird * EPOCH_MINUTES),
    minutesToFirstDeepSleep: firstDeepIndex === -1 ? null : Math.round(firstDeepIndex * EPOCH_MINUTES),
  };
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function hrvRecoveryDelta(sample: unknown): number | null {
  if (!sample || typeof sample !== 'object') return null;
  const items = (sample as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;

  const half = Math.floor(items.length / 2);
  const numeric = (values: unknown[]) =>
    values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const firstHalf = numeric(items.slice(0, half));
  const secondHalf = numeric(items.slice(half));

  if (firstHalf.length < MIN_HRV_SAMPLES_PER_HALF || secondHalf.length < MIN_HRV_SAMPLES_PER_HALF) {
    return null;
  }

  return Math.round((mean(secondHalf) - mean(firstHalf)) * 10) / 10;
}
