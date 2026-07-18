import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateStack,
  matchFactsToItems,
  nutrientTokensForItem,
  type StackItemInput,
  type SupplementFactsInput,
} from '../../src/lib/stackGuard/engine';
import { STACK_GUARD_RULES } from '../../src/lib/stackGuard/rules';

function item(partial: Partial<StackItemInput> & { protocolItemId: string; name: string }): StackItemInput {
  return { times: ['08:00'], withFood: 'any', doseAmount: null, doseUnit: null, ...partial };
}

const IRON = item({ protocolItemId: 'i1', name: 'Iron bisglycinate 25mg', times: ['08:00'], withFood: 'no', doseAmount: 25, doseUnit: 'mg' });
const CALCIUM_SAME = item({ protocolItemId: 'c1', name: 'Calcium citrate', times: ['08:30'], doseAmount: 600, doseUnit: 'mg' });
const CALCIUM_EVENING = item({ protocolItemId: 'c2', name: 'Calcium citrate', times: ['21:00'], doseAmount: 400, doseUnit: 'mg' });

test('iron + calcium in the same ±60min slot → caution finding', () => {
  const report = evaluateStack([IRON, CALCIUM_SAME], [], STACK_GUARD_RULES);
  const finding = report.findings.find(f => f.ruleId === 'iron_calcium_same_slot');
  assert.ok(finding, 'expected iron_calcium_same_slot');
  assert.equal(finding.severity, 'caution');
  assert.deepEqual(finding.itemsInvolved.map(i => i.protocolItemId).sort(), ['c1', 'i1']);
});

test('iron + calcium in different slots → same-slot rule does NOT fire', () => {
  const report = evaluateStack([{ ...IRON, times: ['06:30'], withFood: 'any' }, CALCIUM_EVENING], [], STACK_GUARD_RULES);
  assert.equal(report.findings.some(f => f.ruleId === 'iron_calcium_same_slot'), false);
});

test('slot boundary: exactly 60 minutes apart still counts as the same slot', () => {
  const report = evaluateStack(
    [{ ...IRON, times: ['07:00'], withFood: 'any' }, { ...CALCIUM_EVENING, times: ['08:00'] }],
    [], STACK_GUARD_RULES,
  );
  assert.equal(report.findings.some(f => f.ruleId === 'iron_calcium_same_slot'), true);
});

test('any-time pair (levothyroxine + iron) fires even in different slots', () => {
  const levo = item({ protocolItemId: 'l1', name: 'Левотироксин 50мкг', times: ['06:30'] });
  const report = evaluateStack([levo, { ...IRON, times: ['20:00'], withFood: 'any' }], [], STACK_GUARD_RULES);
  assert.equal(report.findings.some(f => f.ruleId === 'levothyroxine_mineral_spacing'), true);
});

test('empty-stomach item at a typical meal slot → caution; outside slots → nothing', () => {
  const inSlot = evaluateStack([IRON], [], STACK_GUARD_RULES);
  assert.equal(inSlot.findings.some(f => f.ruleId === 'empty_stomach_in_meal_slot'), true);
  const outSlot = evaluateStack([{ ...IRON, times: ['06:00'] }], [], STACK_GUARD_RULES);
  assert.equal(outSlot.findings.some(f => f.ruleId === 'empty_stomach_in_meal_slot'), false);
});

test('meal-slot boundary 09:30 is inclusive', () => {
  const report = evaluateStack([{ ...IRON, times: ['09:30'] }], [], STACK_GUARD_RULES);
  assert.equal(report.findings.some(f => f.ruleId === 'empty_stomach_in_meal_slot'), true);
});

test('single-dose limit: calcium 600mg fires, 400mg does not', () => {
  const over = evaluateStack([CALCIUM_SAME], [], STACK_GUARD_RULES);
  assert.equal(over.findings.some(f => f.ruleId === 'calcium_single_dose_limit'), true);
  const under = evaluateStack([CALCIUM_EVENING], [], STACK_GUARD_RULES);
  assert.equal(under.findings.some(f => f.ruleId === 'calcium_single_dose_limit'), false);
});

test('facts-based duplication: two items sharing magnesiumMg → duplicate_nutrient:magnesium', () => {
  const a = item({ protocolItemId: 'a1', name: 'ZMA Complex', times: ['22:00'] });
  const b = item({ protocolItemId: 'b1', name: 'Sleep Formula', times: ['22:00'] });
  const facts: SupplementFactsInput[] = [
    { normalizedName: 'zma complex', doseAmount: 3, doseUnit: 'capsule', nutrients: { magnesiumMg: 450, zincMg: 30 }, validationStatus: 'accepted' },
    { normalizedName: 'sleep formula', doseAmount: 1, doseUnit: 'capsule', nutrients: { magnesiumMg: 200, melatoninMg: 1 }, validationStatus: 'accepted' },
  ];
  const report = evaluateStack([a, b], facts, STACK_GUARD_RULES);
  const dup = report.findings.find(f => f.ruleId === 'duplicate_nutrient:magnesium');
  assert.ok(dup);
  assert.equal(dup.severity, 'info');
  assert.equal(report.factsMatchedCount, 2);
  assert.equal(report.pendingFactsUsed, false);
});

test('degradation: with NO facts, name-based duplication still works', () => {
  const a = item({ protocolItemId: 'a1', name: 'Magnesium glycinate 200mg', times: ['22:00'] });
  const b = item({ protocolItemId: 'b1', name: 'Магний цитрат', times: ['09:00'] });
  const report = evaluateStack([a, b], [], STACK_GUARD_RULES);
  assert.ok(report.findings.find(f => f.ruleId === 'duplicate_nutrient:magnesium'));
  assert.equal(report.factsMatchedCount, 0);
});

test('pending facts are used but flagged', () => {
  const a = item({ protocolItemId: 'a1', name: 'Complex One', times: ['09:00'] });
  const b = item({ protocolItemId: 'b1', name: 'Complex Two', times: ['09:00'] });
  const facts: SupplementFactsInput[] = [
    { normalizedName: 'complex one', doseAmount: 1, doseUnit: 'tablet', nutrients: { ironMg: 10 }, validationStatus: 'pending' },
    { normalizedName: 'complex two', doseAmount: 1, doseUnit: 'tablet', nutrients: { ironMg: 14 }, validationStatus: 'pending' },
  ];
  const report = evaluateStack([a, b], facts, STACK_GUARD_RULES);
  assert.ok(report.findings.find(f => f.ruleId === 'duplicate_nutrient:iron'));
  assert.equal(report.pendingFactsUsed, true);
});

test('deterministic ordering: caution findings come before info', () => {
  const report = evaluateStack([IRON, CALCIUM_SAME], [], STACK_GUARD_RULES);
  const severities = report.findings.map(f => f.severity);
  const firstInfo = severities.indexOf('info');
  const lastCaution = severities.lastIndexOf('caution');
  assert.ok(firstInfo === -1 || lastCaution < firstInfo);
});

test('empty stack → empty report', () => {
  const report = evaluateStack([], [], STACK_GUARD_RULES);
  assert.deepEqual(report.findings, []);
  assert.equal(report.itemCount, 0);
});

test('matchFactsToItems matches by normalized-name containment either way', () => {
  const facts: SupplementFactsInput[] = [
    { normalizedName: 'iron bisglycinate', doseAmount: 25, doseUnit: 'mg', nutrients: { ironMg: 25 }, validationStatus: 'accepted' },
  ];
  const map = matchFactsToItems([IRON], facts);
  assert.equal(map.get('i1')?.normalizedName, 'iron bisglycinate');
});

test('nutrientTokensForItem maps facts keys (epaMg → omega3) and name aliases', () => {
  const fishOil = item({ protocolItemId: 'f1', name: 'Fish Oil Ultra', times: ['13:00'] });
  const fact: SupplementFactsInput = { normalizedName: 'fish oil ultra', doseAmount: 2, doseUnit: 'softgel', nutrients: { epaMg: 360, dhaMg: 240 }, validationStatus: 'accepted' };
  const tokens = nutrientTokensForItem(fishOil, fact);
  assert.ok(tokens.includes('omega3'));
});
