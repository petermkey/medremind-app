// Morning-briefing logic: personal 30-day baseline math + the rule-based copy
// builder. Pure leaf module (zero imports) so the --experimental-strip-types
// test runner loads it directly, and so the same code runs server-side and
// client-side for copy parity. Deliberately no LLM in W3-B.

export const MIN_BASELINE_SAMPLES = 7;

function finiteOnly(values: Array<number | null | undefined>): number[] {
  return values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
}

export function baselineAverage(values: Array<number | null | undefined>): number | null {
  const numeric = finiteOnly(values);
  if (numeric.length < MIN_BASELINE_SAMPLES) return null;
  const sum = numeric.reduce((total, value) => total + value, 0);
  return Math.round((sum / numeric.length) * 10) / 10;
}

export function pctDelta(
  current: number | null | undefined,
  baseline: number | null | undefined,
): number | null {
  if (typeof current !== 'number' || !Number.isFinite(current)) return null;
  if (typeof baseline !== 'number' || !Number.isFinite(baseline) || baseline === 0) return null;
  return Math.round(((current - baseline) / baseline) * 100);
}

export type BriefingSnapshot = {
  readinessScore: number | null;
  sleepScore: number | null;
  sleepAvgHrv: number | null;
  temperatureDeviation: number | null;
};

export type BriefingBaseline = {
  readinessAvg30: number | null;
  hrvAvg30: number | null;
};

export type BriefingSeverity = 'good' | 'info' | 'caution' | 'warning';

export type Briefing = {
  title: string;
  body: string;
  severity: BriefingSeverity;
};

const TEMPERATURE_WARNING_DEVIATION = 0.5;
const HRV_CAUTION_DROP_PCT = -15;
const READINESS_GOOD = 85;
const READINESS_LOW = 60;

const TITLES: Record<BriefingSeverity, string> = {
  good: 'Morning briefing: strong readiness',
  info: 'Morning briefing',
  caution: 'Morning briefing: recovery day',
  warning: 'Morning briefing: take it easy',
};

export function doseLabel(count: number): string {
  return count === 1 ? 'dose' : 'doses';
}

function doseLine(doseCount: number): string {
  if (doseCount <= 0) return 'No doses are scheduled for today.';
  return `Scheduled today: ${doseCount} ${doseLabel(doseCount)}.`;
}

export function buildBriefing(
  snapshot: BriefingSnapshot | null,
  baseline: BriefingBaseline,
  doseCount: number,
): Briefing {
  const hasScores =
    snapshot !== null && (snapshot.readinessScore !== null || snapshot.sleepScore !== null);

  if (!hasScores) {
    return {
      title: TITLES.info,
      body: `No Oura data is available for last night yet. ${doseLine(doseCount)}`,
      severity: 'info',
    };
  }

  const lines: string[] = [];
  const scoreParts: string[] = [];
  if (snapshot.readinessScore !== null) scoreParts.push(`Readiness ${snapshot.readinessScore}`);
  if (snapshot.sleepScore !== null) scoreParts.push(`sleep ${snapshot.sleepScore}`);
  if (scoreParts.length > 0) lines.push(`${scoreParts.join(' · ')}.`);

  const hrvDelta = pctDelta(snapshot.sleepAvgHrv, baseline.hrvAvg30);
  if (snapshot.sleepAvgHrv !== null && hrvDelta !== null) {
    const sign = hrvDelta > 0 ? '+' : '';
    lines.push(`HRV ${snapshot.sleepAvgHrv} ms — ${sign}${hrvDelta}% vs your 30-day baseline.`);
  }

  const temperatureHigh =
    snapshot.temperatureDeviation !== null &&
    snapshot.temperatureDeviation >= TEMPERATURE_WARNING_DEVIATION;
  if (temperatureHigh && snapshot.temperatureDeviation !== null) {
    lines.push(
      `Body temperature is ${snapshot.temperatureDeviation.toFixed(1)} °C above usual — pay attention to how you feel.`,
    );
  }

  lines.push(doseLine(doseCount));

  let severity: BriefingSeverity = 'info';
  if (temperatureHigh) {
    severity = 'warning';
  } else if (
    (snapshot.readinessScore !== null && snapshot.readinessScore < READINESS_LOW) ||
    (hrvDelta !== null && hrvDelta <= HRV_CAUTION_DROP_PCT)
  ) {
    severity = 'caution';
  } else if (snapshot.readinessScore !== null && snapshot.readinessScore >= READINESS_GOOD) {
    severity = 'good';
  }

  return { title: TITLES[severity], body: lines.join(' '), severity };
}
