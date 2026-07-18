// W3-A Stack Guard — pure, deterministic evaluation of the active stack
// against the curated rule set. Clock-free, zero I/O, relative imports only
// (test:unit harness constraint — daySchedule.ts precedent). Findings are
// SUGGESTIONS: nothing in this module (or its consumers) mutates schedules.
import {
  NUTRIENT_ALIASES,
  NUTRIENT_LABELS,
  STACK_GUARD_RULESET_VERSION,
  type PairRule,
  type SingleDoseLimitRule,
  type StackGuardRule,
  type StackGuardSeverity,
} from './rules';

export type StackItemInput = {
  protocolItemId: string;
  name: string;
  times: string[];
  withFood: 'yes' | 'no' | 'any' | string | null;
  doseAmount: number | null;
  doseUnit: string | null;
};

export type SupplementFactsInput = {
  normalizedName: string;
  doseAmount: number;
  doseUnit: string;
  nutrients: Record<string, unknown>;
  validationStatus: string;
};

export type StackGuardFinding = {
  ruleId: string;
  severity: StackGuardSeverity;
  itemsInvolved: { protocolItemId: string; name: string }[];
  title: string;
  explanation: string;
  suggestion: string;
  source: string;
};

export type StackGuardReport = {
  findings: StackGuardFinding[];
  itemCount: number;
  factsMatchedCount: number;
  pendingFactsUsed: boolean;
  rulesetVersion: number;
};

const SAME_SLOT_TOLERANCE_MINUTES = 60;
const CONFIRMED_FACT_STATUSES = new Set(['accepted', 'verified']);

export const TYPICAL_MEAL_SLOTS: ReadonlyArray<{ startMinutes: number; endMinutes: number }> = [
  { startMinutes: 7 * 60 + 30, endMinutes: 9 * 60 + 30 },
  { startMinutes: 12 * 60 + 30, endMinutes: 14 * 60 + 30 },
  { startMinutes: 18 * 60 + 30, endMinutes: 20 * 60 + 30 },
];

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-zа-яё0-9]+/giu, ' ').trim();
}

function matchesAliases(name: string, aliases: string[]): boolean {
  const normalized = normalizeName(name);
  return aliases.some((alias) => normalized.includes(normalizeName(alias)));
}

function timeToMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function shareSlot(a: StackItemInput, b: StackItemInput): boolean {
  for (const ta of a.times) {
    const ma = timeToMinutes(ta);
    if (ma === null) continue;
    for (const tb of b.times) {
      const mb = timeToMinutes(tb);
      if (mb === null) continue;
      if (Math.abs(ma - mb) <= SAME_SLOT_TOLERANCE_MINUTES) return true;
    }
  }
  return false;
}

function inMealSlot(minutes: number): boolean {
  return TYPICAL_MEAL_SLOTS.some((slot) => minutes >= slot.startMinutes && minutes <= slot.endMinutes);
}

function anyTimeInMealSlot(item: StackItemInput): boolean {
  return item.times.some((time) => {
    const minutes = timeToMinutes(time);
    return minutes !== null && inMealSlot(minutes);
  });
}

function nutrientTokenFromKey(key: string): string | null {
  const base = key.toLowerCase().replace(/(mcg|mg|iu|g)$/u, '');
  if (base.length === 0) return null;
  for (const [token, aliases] of Object.entries(NUTRIENT_ALIASES)) {
    if (token === base) return token;
    if (aliases.some((alias) => base === normalizeName(alias) || (alias.length > 2 && base.includes(normalizeName(alias))))) {
      return token;
    }
  }
  return base;
}

export function matchFactsToItems(
  items: StackItemInput[],
  facts: SupplementFactsInput[],
): Map<string, SupplementFactsInput | null> {
  const map = new Map<string, SupplementFactsInput | null>();
  for (const item of items) {
    const itemName = normalizeName(item.name);
    const fact = facts.find((candidate) => {
      const factName = normalizeName(candidate.normalizedName);
      return factName.length > 0 && (itemName.includes(factName) || factName.includes(itemName));
    });
    map.set(item.protocolItemId, fact ?? null);
  }
  return map;
}

export function nutrientTokensForItem(item: StackItemInput, fact: SupplementFactsInput | null): string[] {
  const tokens = new Set<string>();
  if (fact) {
    for (const [key, value] of Object.entries(fact.nutrients)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        const token = nutrientTokenFromKey(key);
        if (token) tokens.add(token);
      }
    }
  }
  const normalized = normalizeName(item.name);
  for (const [token, aliases] of Object.entries(NUTRIENT_ALIASES)) {
    if (aliases.some((alias) => normalized.includes(normalizeName(alias)))) tokens.add(token);
  }
  return [...tokens].sort();
}

function amountForToken(item: StackItemInput, fact: SupplementFactsInput | null, rule: SingleDoseLimitRule): number | null {
  if (fact) {
    for (const [key, value] of Object.entries(fact.nutrients)) {
      if (
        typeof value === 'number' && Number.isFinite(value) && value > 0 &&
        key.toLowerCase().endsWith(rule.unit) && nutrientTokenFromKey(key) === rule.nutrientToken
      ) {
        return value;
      }
    }
  }
  if (item.doseAmount !== null && (item.doseUnit ?? '').toLowerCase() === rule.unit) return item.doseAmount;
  return null;
}

function toFinding(rule: StackGuardRule, items: StackItemInput[]): StackGuardFinding {
  const sorted = [...items].sort((a, b) => a.protocolItemId.localeCompare(b.protocolItemId));
  return {
    ruleId: rule.id,
    severity: rule.severity,
    itemsInvolved: sorted.map((item) => ({ protocolItemId: item.protocolItemId, name: item.name })),
    title: rule.title,
    explanation: rule.explanation,
    suggestion: rule.suggestion,
    source: rule.source,
  };
}

function evaluatePairRule(rule: PairRule, items: StackItemInput[]): StackGuardFinding | null {
  const itemsA = items.filter((item) => matchesAliases(item.name, rule.groupA));
  const itemsB = items.filter((item) => matchesAliases(item.name, rule.groupB));
  const involved = new Map<string, StackItemInput>();
  for (const a of itemsA) {
    for (const b of itemsB) {
      if (a.protocolItemId === b.protocolItemId) continue;
      if (rule.sameSlotOnly && !shareSlot(a, b)) continue;
      involved.set(a.protocolItemId, a);
      involved.set(b.protocolItemId, b);
    }
  }
  return involved.size >= 2 ? toFinding(rule, [...involved.values()]) : null;
}

export function evaluateStack(
  items: StackItemInput[],
  facts: SupplementFactsInput[],
  rules: readonly StackGuardRule[],
): StackGuardReport {
  const factsByItem = matchFactsToItems(items, facts);
  const findings: StackGuardFinding[] = [];

  for (const rule of rules) {
    if (rule.kind === 'pair') {
      const finding = evaluatePairRule(rule, items);
      if (finding) findings.push(finding);
    } else if (rule.kind === 'empty_stomach_meal_slot') {
      const hits = items.filter((item) => item.withFood === 'no' && anyTimeInMealSlot(item));
      if (hits.length > 0) findings.push(toFinding(rule, hits));
    } else if (rule.kind === 'alias_meal_slot') {
      const hits = items.filter((item) => matchesAliases(item.name, rule.aliases) && anyTimeInMealSlot(item));
      if (hits.length > 0) findings.push(toFinding(rule, hits));
    } else {
      const hits = items.filter((item) => {
        if (!matchesAliases(item.name, rule.aliases)) return false;
        const amount = amountForToken(item, factsByItem.get(item.protocolItemId) ?? null, rule);
        return amount !== null && amount > rule.maxAmount;
      });
      if (hits.length > 0) findings.push(toFinding(rule, hits));
    }
  }

  const itemsByToken = new Map<string, StackItemInput[]>();
  for (const item of items) {
    for (const token of nutrientTokensForItem(item, factsByItem.get(item.protocolItemId) ?? null)) {
      itemsByToken.set(token, [...(itemsByToken.get(token) ?? []), item]);
    }
  }
  for (const [token, dupItems] of [...itemsByToken.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (dupItems.length < 2) continue;
    const label = NUTRIENT_LABELS[token] ?? token;
    findings.push({
      ruleId: `duplicate_nutrient:${token}`,
      severity: 'info',
      itemsInvolved: dupItems
        .map((item) => ({ protocolItemId: item.protocolItemId, name: item.name }))
        .sort((a, b) => a.protocolItemId.localeCompare(b.protocolItemId)),
      title: `Duplicate nutrient: ${label}`,
      explanation: `${label} appears in multiple stack items, so the total daily amount may be higher than intended.`,
      suggestion: 'Review ingredient lists and total daily dose; if needed, ask a clinician whether the duplicate is appropriate.',
      source: 'NIH Office of Dietary Supplements — fact sheets: https://ods.od.nih.gov/factsheets/',
    });
  }

  const matchedFacts = [...factsByItem.values()].filter((fact): fact is SupplementFactsInput => fact !== null);
  findings.sort((a, b) =>
    a.severity === b.severity ? a.ruleId.localeCompare(b.ruleId) : a.severity === 'caution' ? -1 : 1,
  );

  return {
    findings,
    itemCount: items.length,
    factsMatchedCount: matchedFacts.length,
    pendingFactsUsed: matchedFacts.some((fact) => !CONFIRMED_FACT_STATUSES.has(fact.validationStatus)),
    rulesetVersion: STACK_GUARD_RULESET_VERSION,
  };
}
