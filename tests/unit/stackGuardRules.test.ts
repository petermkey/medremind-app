import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NUTRIENT_ALIASES,
  NUTRIENT_LABELS,
  STACK_GUARD_RULES,
  STACK_GUARD_RULESET_VERSION,
} from '../../src/lib/stackGuard/rules';

test('ruleset version is a positive integer', () => {
  assert.equal(STACK_GUARD_RULESET_VERSION, 1);
});

test('there are 13 curated rules with unique ids', () => {
  assert.equal(STACK_GUARD_RULES.length, 13);
  const ids = new Set(STACK_GUARD_RULES.map(r => r.id));
  assert.equal(ids.size, 13);
});

test('every rule carries a real citation and non-empty English copy', () => {
  for (const rule of STACK_GUARD_RULES) {
    assert.ok(/https?:\/\/|\d{4};/.test(rule.source), `rule ${rule.id} needs a URL or journal citation`);
    assert.ok(
      rule.title.length > 0 && rule.explanation.length > 10 && rule.suggestion.length > 10,
      `rule ${rule.id} copy incomplete`,
    );
    assert.ok(rule.severity === 'info' || rule.severity === 'caution');
  }
});

test('pair rules have non-overlapping non-empty alias groups', () => {
  for (const rule of STACK_GUARD_RULES) {
    if (rule.kind !== 'pair') continue;
    assert.ok(rule.groupA.length > 0 && rule.groupB.length > 0, rule.id);
    for (const alias of rule.groupA) assert.ok(!rule.groupB.includes(alias), `${rule.id}: alias '${alias}' in both groups`);
  }
});

test('every duplication token has an English label', () => {
  for (const token of Object.keys(NUTRIENT_ALIASES)) {
    assert.ok(NUTRIENT_LABELS[token], `token ${token} lacks label`);
  }
});
