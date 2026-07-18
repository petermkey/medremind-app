export type NutrientGaps = {
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberG: number;
  waterMl: number;
};

export const GAP_THRESHOLDS = {
  caloriesKcal: 300,
  proteinG: 20,
  fiberG: 8,
  waterMl: 500,
} as const;

export const SUGGEST_FROM_HOUR = 15;

type GapTotals = {
  caloriesKcal?: number;
  proteinG?: number;
  totalFatG?: number;
  carbsG?: number;
  fiberG?: number;
};

type GapTargets = {
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberG: number;
  waterMl: number;
};

function gap(target: number, consumed: number | undefined): number {
  const value = target - (typeof consumed === 'number' && Number.isFinite(consumed) ? consumed : 0);
  return Math.max(0, Math.round(value));
}

export function computeNutrientGaps(
  totals: GapTotals,
  waterTotalMl: number,
  targets: GapTargets,
): NutrientGaps {
  return {
    caloriesKcal: gap(targets.caloriesKcal, totals.caloriesKcal),
    proteinG: gap(targets.proteinG, totals.proteinG),
    fatG: gap(targets.fatG, totals.totalFatG),
    carbsG: gap(targets.carbsG, totals.carbsG),
    fiberG: gap(targets.fiberG, totals.fiberG),
    waterMl: gap(targets.waterMl, waterTotalMl),
  };
}

export function hasMeaningfulGaps(gaps: NutrientGaps): boolean {
  return (
    gaps.caloriesKcal >= GAP_THRESHOLDS.caloriesKcal ||
    gaps.proteinG >= GAP_THRESHOLDS.proteinG ||
    gaps.fiberG >= GAP_THRESHOLDS.fiberG ||
    gaps.waterMl >= GAP_THRESHOLDS.waterMl
  );
}

export function gapsBucket(gaps: NutrientGaps): string {
  const quantize = (value: number, step: number) => Math.floor(value / step) * step;
  return [
    quantize(gaps.caloriesKcal, 200),
    quantize(gaps.proteinG, 15),
    quantize(gaps.fatG, 15),
    quantize(gaps.carbsG, 100),
    quantize(gaps.fiberG, 8),
    quantize(gaps.waterMl, 300),
  ].join(':');
}

function formatParts(iso: string, timezone: string): Map<string, string> | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    return new Map(parts.map(part => [part.type, part.value]));
  } catch {
    return null;
  }
}

export function localDateForTimestamp(iso: string, timezone: string): string | null {
  const map = formatParts(iso, timezone);
  if (!map) return null;
  const year = map.get('year');
  const month = map.get('month');
  const day = map.get('day');
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function localHourForTimestamp(iso: string, timezone: string): number | null {
  const map = formatParts(iso, timezone);
  if (!map) return null;
  const hour = Number(map.get('hour'));
  return Number.isFinite(hour) ? hour : null;
}
