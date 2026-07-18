// Pure deterministic Nutrient Balance math (B1). No I/O, no clock, relative
// imports only (standalone test:unit harness). The LLM never runs here -
// facts arrive pre-extracted; ULs come exclusively from the curated
// limits.ts table, which is what makes the excess bucket trustworthy.
import {
  findNutrientDef,
  NUTRIENT_DEFS,
  NUTRIENT_LIMITS_VERSION,
  type NutrientDef,
} from './limits';

export type StackItemInput = {
  displayName: string;
  /** Canonical nutrient keys -> amount PER SINGLE DOSE. */
  nutrients: Record<string, number>;
  dosesPerDay: number;
  validationStatus: string;
};

export type NutrientContributor = {
  displayName: string;
  amountPerDay: number;
  validationStatus: string;
};

export type NutrientFinding = {
  nutrientKey: string;
  label: string;
  unit: string;
  foodAvgPerDay: number;
  stackPerDay: number;
  totalPerDay: number;
  target: number | null;
  ul: number | null;
  ulScope: 'total' | 'supplemental';
  pctOfTarget: number | null;
  contributors: NutrientContributor[];
  unverified: boolean;
};

export type NutrientBalanceReport = {
  version: string;
  buckets: {
    deficits: NutrientFinding[];
    covered: NutrientFinding[];
    excess: NutrientFinding[];
  };
};

const DEFICIT_RATIO = 0.7;
const FOOD_COVERED_RATIO = 0.75;
const EXCESS_UL_RATIO = 0.8;

const TYPED_FOOD_COLUMNS: Array<[column: string, key: string]> = [
  ['protein_g', 'proteinG'],
  ['fiber_g', 'fiberG'],
];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function dosesPerDay(frequencyType: string, times: string[] | null): number {
  switch (frequencyType) {
    case 'daily':
      return Math.max(Array.isArray(times) ? times.length : 0, 1);
    case 'twice_daily':
      return 2;
    case 'three_times_daily':
      return 3;
    case 'weekly':
      return 1 / 7;
    default:
      // every_n_hours / every_n_days / custom: interval is not stored on
      // medication_map_items - assume once daily (conservative).
      return 1;
  }
}

export function aggregateFoodDailyAverages(
  rows: Array<Record<string, unknown>>,
  loggedDays: number,
): Record<string, number> {
  const divisor = Math.max(loggedDays, 1);
  const sums = new Map<string, number>();

  for (const row of rows) {
    for (const [column, key] of TYPED_FOOD_COLUMNS) {
      const value = toFiniteNumber(row[column]);
      if (value !== null && value > 0) sums.set(key, (sums.get(key) ?? 0) + value);
    }
    const extended = row.extended_nutrients;
    if (extended && typeof extended === 'object' && !Array.isArray(extended)) {
      for (const [rawKey, rawValue] of Object.entries(extended as Record<string, unknown>)) {
        const def = findNutrientDef(rawKey);
        const value = toFiniteNumber(rawValue);
        if (def && value !== null && value > 0) {
          sums.set(def.key, (sums.get(def.key) ?? 0) + value);
        }
      }
    }
  }

  const averages: Record<string, number> = {};
  for (const [key, total] of sums) averages[key] = round2(total / divisor);
  return averages;
}

type Contribution = { contributors: NutrientContributor[]; total: number; unverified: boolean };

function stackContributionsByNutrient(stack: StackItemInput[]): Map<string, Contribution> {
  const byNutrient = new Map<string, Contribution>();
  for (const item of stack) {
    if (item.validationStatus === 'rejected') continue;
    for (const [rawKey, perDose] of Object.entries(item.nutrients)) {
      const def = findNutrientDef(rawKey);
      const value = toFiniteNumber(perDose);
      if (!def || value === null || value <= 0) continue;
      const amountPerDay = round2(value * item.dosesPerDay);
      const existing = byNutrient.get(def.key) ?? { contributors: [], total: 0, unverified: false };
      existing.contributors.push({
        displayName: item.displayName,
        amountPerDay,
        validationStatus: item.validationStatus,
      });
      existing.total = round2(existing.total + amountPerDay);
      existing.unverified = existing.unverified || item.validationStatus !== 'verified';
      byNutrient.set(def.key, existing);
    }
  }
  return byNutrient;
}

export function buildNutrientBalanceReport(input: {
  foodDailyAvg: Record<string, number>;
  stack: StackItemInput[];
  targets: { proteinG?: number | null; fiberG?: number | null };
}): NutrientBalanceReport {
  const stackByNutrient = stackContributionsByNutrient(input.stack);
  const deficits: NutrientFinding[] = [];
  const covered: NutrientFinding[] = [];
  const excess: NutrientFinding[] = [];

  for (const def of NUTRIENT_DEFS) {
    const foodAvgPerDay = round2(input.foodDailyAvg[def.key] ?? 0);
    const contribution = stackByNutrient.get(def.key);
    const stackPerDay = contribution?.total ?? 0;
    if (foodAvgPerDay === 0 && stackPerDay === 0) continue;

    const totalPerDay = round2(foodAvgPerDay + stackPerDay);
    const target = resolveTarget(def, input.targets);
    const finding: NutrientFinding = {
      nutrientKey: def.key,
      label: def.label,
      unit: def.unit,
      foodAvgPerDay,
      stackPerDay,
      totalPerDay,
      target,
      ul: def.ul,
      ulScope: def.ulScope,
      pctOfTarget: target !== null && target > 0 ? Math.round((totalPerDay / target) * 100) : null,
      contributors: contribution?.contributors ?? [],
      unverified: contribution?.unverified ?? false,
    };

    if (def.ul !== null) {
      const basis = def.ulScope === 'supplemental' ? stackPerDay : totalPerDay;
      if (basis >= EXCESS_UL_RATIO * def.ul) {
        excess.push(finding);
        continue;
      }
    }
    if (target !== null) {
      if (totalPerDay < DEFICIT_RATIO * target) {
        deficits.push(finding);
      } else if (
        totalPerDay >= target &&
        stackPerDay > 0 &&
        foodAvgPerDay >= FOOD_COVERED_RATIO * target
      ) {
        covered.push(finding);
      }
    }
  }

  deficits.sort((a, b) => (a.pctOfTarget ?? 0) - (b.pctOfTarget ?? 0));
  excess.sort((a, b) => excessSeverity(b) - excessSeverity(a));
  covered.sort((a, b) => b.stackPerDay - a.stackPerDay);

  return { version: NUTRIENT_LIMITS_VERSION, buckets: { deficits, covered, excess } };
}

function resolveTarget(
  def: NutrientDef,
  targets: { proteinG?: number | null; fiberG?: number | null },
): number | null {
  if (def.key === 'proteinG' && typeof targets.proteinG === 'number') return targets.proteinG;
  if (def.key === 'fiberG' && typeof targets.fiberG === 'number') return targets.fiberG;
  return def.rda;
}

function excessSeverity(finding: NutrientFinding): number {
  if (finding.ul === null || finding.ul === 0) return 0;
  const basis = finding.ulScope === 'supplemental' ? finding.stackPerDay : finding.totalPerDay;
  return basis / finding.ul;
}
