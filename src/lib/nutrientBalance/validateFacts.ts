// Deterministic plausibility validator for LLM-extracted supplement nutrient
// facts (WS3). Runs BEFORE a fact is trusted by Nutrient Balance / Stack
// Guard - it never calls an LLM itself, so its output is reproducible and
// safe to gate `validation_status` on.
// Zero imports beyond limits.ts (leaf module for the standalone test:unit
// harness).

import { NUTRIENT_DEFS, type NutrientDef } from './limits';

export type NutrientFactInput = {
  nutrients: Record<string, number>;
  normalizedName: string;
  doseAmount: number;
  doseUnit: string;
};

export type NutrientFactValidation = {
  status: 'verified' | 'rejected';
  reasons: string[];
};

// Hard implausibility ceiling, expressed as a multiplier of the curated
// tolerable upper limit (UL) from limits.ts. The multiplier is scoped by
// `NutrientDef.ulScope`:
// - 'total' (IMPLAUSIBILITY_MULTIPLIER_TOTAL = 10): the curated UL already
//   applies to total intake (food + supplements). Legitimate megadose
//   supplement products rarely exceed ~2-5x the NIH ODS / EFSA UL for a
//   nutrient, so 10x stays well clear of real-world dosing.
// - 'supplemental' (IMPLAUSIBILITY_MULTIPLIER_SUPPLEMENTAL = 100): the
//   curated UL applies only to the supplemental-intake portion (e.g.
//   niacin, vitamin E, folate, magnesium, omega-3 EPA/DHA per NIH ODS), so
//   it is deliberately set far below typical single-product content.
//   Mainstream OTC doses of these nutrients can legitimately sit well
//   above a 10x ceiling (e.g. niacin 500mg vs ul=35mg), so a flat 10x
//   wrongly rejects real products. 100x still reliably catches the actual
//   failure modes this validator targets: unit confusion (mg vs mcg, g vs
//   mg -> ~1000x errors) and decimal-shift misreads of a label (10x-100x
//   errors), since those errors typically overshoot even a 100x ceiling.
const IMPLAUSIBILITY_MULTIPLIER_TOTAL = 10;
const IMPLAUSIBILITY_MULTIPLIER_SUPPLEMENTAL = 100;

function normalizeKey(rawKey: string): string {
  return rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildLimitsIndex(limits: NutrientDef[]): Map<string, NutrientDef> {
  const index = new Map<string, NutrientDef>();
  for (const def of limits) {
    index.set(normalizeKey(def.key), def);
    for (const alias of def.aliases) index.set(normalizeKey(alias), def);
  }
  return index;
}

/**
 * Deterministically checks an extracted supplement nutrient fact for
 * plausibility against the curated reference-intake table. Never trusts the
 * LLM's own confidence score - only numeric sanity against `limits`.
 *
 * @param fact - the extracted fact (nutrients keyed by limits.ts NutrientDef
 *   key or alias, plus the supplement's normalized name/dose for reasons).
 * @param limits - curated nutrient definitions to validate against; defaults
 *   to the in-repo curated table (`NUTRIENT_DEFS` from limits.ts).
 */
export function validateNutrientFact(
  fact: NutrientFactInput,
  limits: NutrientDef[] = NUTRIENT_DEFS,
): NutrientFactValidation {
  const entries = Object.entries(fact.nutrients);
  if (entries.length === 0) {
    return { status: 'rejected', reasons: ['no extractable nutrients'] };
  }

  const index = buildLimitsIndex(limits);
  const reasons: string[] = [];

  for (const [key, value] of entries) {
    if (!Number.isFinite(value) || value < 0) {
      reasons.push(`${key}: value must be a non-negative finite number, got ${value}`);
      continue;
    }

    const def = index.get(normalizeKey(key));
    if (!def || def.ul === null) continue; // no curated ceiling to check against

    const multiplier =
      def.ulScope === 'supplemental'
        ? IMPLAUSIBILITY_MULTIPLIER_SUPPLEMENTAL
        : IMPLAUSIBILITY_MULTIPLIER_TOTAL;
    const ceiling = def.ul * multiplier;
    if (value > ceiling) {
      reasons.push(
        `${key}: ${value}${def.unit} exceeds implausibility ceiling of ${ceiling}${def.unit} ` +
          `(${multiplier}x curated UL ${def.ul}${def.unit})`,
      );
    }
  }

  return reasons.length > 0 ? { status: 'rejected', reasons } : { status: 'verified', reasons: [] };
}
