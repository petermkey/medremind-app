import type {
  CorrelationDirection,
  CorrelationInsightCard,
  CorrelationStrength,
  DailyLifestyleSnapshot,
  RecommendationKind,
  SanitizedCorrelationEvidence,
} from './types';

const WINDOW_DAYS = [30, 60, 90] as const;
const MIN_PAIRED_DAYS = 14;
const DEFAULT_CARD_LIMIT = 6;

const FEATURES = [
  { key: 'caloriesKcal', label: 'calories' },
  { key: 'proteinG', label: 'protein' },
  { key: 'fiberG', label: 'fiber' },
  { key: 'waterMl', label: 'hydration' },
  { key: 'adherencePct', label: 'adherence' },
  { key: 'lateMedicationCount', label: 'late medication pattern' },
  { key: 'missedMedicationCount', label: 'missed medication pattern' },
  { key: 'medicationClassExposureScore', label: 'medication exposure pattern' },
] as const;

const OUTCOMES = [
  { key: 'sleepScore', label: 'sleep score' },
  { key: 'readinessScore', label: 'readiness score' },
  { key: 'activityScore', label: 'activity score' },
  { key: 'stressHighSeconds', label: 'high-stress time' },
] as const;

type NumericSnapshotKey = Exclude<keyof DailyLifestyleSnapshot, 'userId' | 'localDate' | 'sourcePayload'>;

export type GenerateCorrelationInsightCardsInput = {
  userId: string;
  snapshots: DailyLifestyleSnapshot[];
  now?: Date;
  limit?: number;
};

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function assertSafeCorrelationInsightCardText(title: string, body: string): void {
  const directMedicationChange =
    /\b(stop|stopping|pause|pausing|skip|skipping|cancel|cancelling|discontinue|discontinuing|move|reschedule|delay|reduce|increase|double|halve)\b/i;

  if (directMedicationChange.test(title) || directMedicationChange.test(body)) {
    throw new Error('Direct medication-change language is not allowed');
  }
}

function countPairedValues(xs: Array<number | null>, ys: Array<number | null>): number {
  const length = Math.min(xs.length, ys.length);
  let count = 0;
  for (let index = 0; index < length; index += 1) {
    if (xs[index] !== null && ys[index] !== null) count += 1;
  }
  return count;
}

function pearsonCorrelation(xs: Array<number | null>, ys: Array<number | null>): number | null {
  const pairs: Array<[number, number]> = [];
  const length = Math.min(xs.length, ys.length);

  for (let index = 0; index < length; index += 1) {
    const x = xs[index];
    const y = ys[index];
    if (x !== null && y !== null) pairs.push([x, y]);
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
  return denominator === 0 ? null : numerator / denominator;
}

function rankByAbsoluteCorrelation<T extends { r: number }>(results: T[]): T[] {
  return [...results].sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
}

function value(snapshot: DailyLifestyleSnapshot, key: NumericSnapshotKey): number | null {
  const raw = snapshot[key];
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  return toNumber(raw);
}

function average(values: Array<number | null>): number | null {
  const finite = values.filter((item): item is number => item !== null);
  if (finite.length === 0) return null;
  return finite.reduce((sum, item) => sum + item, 0) / finite.length;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function strengthFor(r: number): CorrelationStrength {
  const absolute = Math.abs(r);
  if (absolute >= 0.65) return 'strong';
  if (absolute >= 0.35) return 'moderate';
  return 'weak';
}

function recommendationKindFor(feature: string, strength: CorrelationStrength): RecommendationKind {
  if (strength === 'weak') return 'tracking_prompt';
  if (feature.toLowerCase().includes('medication')) return 'clinician_review';
  return 'lifestyle_adjustment';
}

function titleFor(featureLabel: string, outcomeLabel: string, strength: CorrelationStrength): string {
  if (strength === 'weak') return `Track ${featureLabel} with ${outcomeLabel}`;
  return `${featureLabel} is associated with ${outcomeLabel}`;
}

function bodyFor(featureLabel: string, outcomeLabel: string, direction: CorrelationDirection, kind: RecommendationKind): string {
  if (kind === 'clinician_review') {
    return `This medication-related pattern moved ${direction === 'positive' ? 'with' : 'against'} ${outcomeLabel}. Discuss the pattern with your clinician before making any medication changes.`;
  }

  if (kind === 'tracking_prompt') {
    return `The signal is early. Keep tracking ${featureLabel} and ${outcomeLabel} so MedRemind can compare more paired days.`;
  }

  return `On days with ${direction === 'positive' ? 'higher' : 'lower'} ${featureLabel}, ${outcomeLabel} tended to be ${direction === 'positive' ? 'higher' : 'lower'}. Consider this a lifestyle pattern to review, not medical advice.`;
}

function evidenceFor(
  snapshots: DailyLifestyleSnapshot[],
  feature: typeof FEATURES[number],
  outcome: typeof OUTCOMES[number],
  pairedDays: number,
): SanitizedCorrelationEvidence {
  const featureValues = snapshots.map(snapshot => value(snapshot, feature.key));
  const outcomeValues = snapshots.map(snapshot => value(snapshot, outcome.key));

  return {
    dateRange: {
      start: snapshots[0]?.localDate ?? '',
      end: snapshots[snapshots.length - 1]?.localDate ?? '',
    },
    pairedDays,
    featureSummary: {
      label: feature.label,
      average: average(featureValues),
    },
    outcomeSummary: {
      label: outcome.label,
      average: average(outcomeValues),
    },
  };
}

export function generateCorrelationInsightCards(input: GenerateCorrelationInsightCardsInput): CorrelationInsightCard[] {
  const generatedAt = (input.now ?? new Date()).toISOString();
  const today = new Date(`${generatedAt.slice(0, 10)}T00:00:00.000Z`);
  const sortedSnapshots = [...input.snapshots].sort((a, b) => a.localDate.localeCompare(b.localDate));
  const cards: CorrelationInsightCard[] = [];

  for (const windowDays of WINDOW_DAYS) {
    const start = dateOnly(addDays(today, -(windowDays - 1)));
    const windowSnapshots = sortedSnapshots.filter(snapshot => snapshot.localDate >= start && snapshot.localDate <= dateOnly(today));
    const results = [];

    for (const feature of FEATURES) {
      for (const outcome of OUTCOMES) {
        const xs = windowSnapshots.map(snapshot => value(snapshot, feature.key));
        const ys = windowSnapshots.map(snapshot => value(snapshot, outcome.key));
        const n = countPairedValues(xs, ys);
        if (n < MIN_PAIRED_DAYS) continue;

        const r = pearsonCorrelation(xs, ys);
        if (r === null) continue;
        results.push({ feature, outcome, r, n });
      }
    }

    for (const result of rankByAbsoluteCorrelation(results.map(item => ({
      feature: item.feature.key,
      outcome: item.outcome.key,
      r: item.r,
      n: item.n,
      source: item,
    })))) {
      const source = result.source;
      const strength = strengthFor(result.r);
      const direction: CorrelationDirection = result.r >= 0 ? 'positive' : 'negative';
      const recommendationKind = recommendationKindFor(source.feature.label, strength);
      const title = titleFor(source.feature.label, source.outcome.label, strength);
      const body = bodyFor(source.feature.label, source.outcome.label, direction, recommendationKind);
      assertSafeCorrelationInsightCardText(title, body);

      cards.push({
        userId: input.userId,
        windowDays,
        feature: source.feature.key,
        outcome: source.outcome.key,
        r: result.r,
        n: result.n,
        strength,
        direction,
        recommendationKind,
        title,
        body,
        evidence: evidenceFor(windowSnapshots, source.feature, source.outcome, result.n),
        generatedAt,
      });

      if (cards.length >= (input.limit ?? DEFAULT_CARD_LIMIT)) return cards;
    }
  }

  return cards;
}
