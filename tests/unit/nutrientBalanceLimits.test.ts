import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  findNutrientDef,
  NUTRIENT_DEFS,
  NUTRIENT_LIMITS_VERSION,
} from '../../src/lib/nutrientBalance/limits';

test('table has 30 cited, well-formed entries with unique keys', () => {
  assert.equal(NUTRIENT_DEFS.length, 30);
  assert.match(NUTRIENT_LIMITS_VERSION, /^nb-limits-\d{4}-\d{2}-\d{2}/);
  const keys = new Set<string>();
  for (const def of NUTRIENT_DEFS) {
    assert.ok(def.key.length > 0);
    assert.ok(!keys.has(def.key), `duplicate key ${def.key}`);
    keys.add(def.key);
    assert.ok(def.source.length > 10, `${def.key} must carry a citation`);
    assert.ok(['g', 'mg', 'mcg'].includes(def.unit));
    if (def.ul !== null) assert.ok(def.ul > 0);
    if (def.rda !== null) assert.ok(def.rda > 0);
    if (def.rda !== null && def.ul !== null && def.ulScope === 'total') {
      assert.ok(def.ul > def.rda, `${def.key}: total-scope UL must exceed RDA`);
    }
  }
});

test('known reference values are present (spot checks against NIH ODS)', () => {
  const magnesium = NUTRIENT_DEFS.find(def => def.key === 'magnesiumMg');
  assert.equal(magnesium?.rda, 420);
  assert.equal(magnesium?.ul, 350);
  assert.equal(magnesium?.ulScope, 'supplemental');

  const vitaminD = NUTRIENT_DEFS.find(def => def.key === 'vitaminDMcg');
  assert.equal(vitaminD?.rda, 15);
  assert.equal(vitaminD?.ul, 100);

  const zinc = NUTRIENT_DEFS.find(def => def.key === 'zincMg');
  assert.equal(zinc?.ul, 40);
  assert.equal(zinc?.ulScope, 'total');
});

test('findNutrientDef matches keys and aliases case/separator-insensitively', () => {
  assert.equal(findNutrientDef('magnesiumMg')?.key, 'magnesiumMg');
  assert.equal(findNutrientDef('magnesium_mg')?.key, 'magnesiumMg');
  assert.equal(findNutrientDef('Magnesium')?.key, 'magnesiumMg');
  assert.equal(findNutrientDef('vitamin_d')?.key, 'vitaminDMcg');
  assert.equal(findNutrientDef('cholecalciferol')?.key, 'vitaminDMcg');
  assert.equal(findNutrientDef('epaDhaMg')?.key, 'omega3EpaDhaMg');
  assert.equal(findNutrientDef('unobtainium'), null);
});
