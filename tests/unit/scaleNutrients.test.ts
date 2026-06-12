import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scaleNutrients } from '../../src/lib/food/scaleNutrients';

test('scales every present nutrient and extended keys', () => {
  const scaled = scaleNutrients(
    { caloriesKcal: 220, proteinG: 6.5, extended: { caffeineMg: 80 } },
    1.5,
  );
  assert.deepEqual(scaled, { caloriesKcal: 330, proteinG: 9.75, extended: { caffeineMg: 120 } });
});

test('leaves absent keys absent and returns input on invalid factor', () => {
  const input = { caloriesKcal: 100 };
  assert.deepEqual(scaleNutrients(input, 0.5), { caloriesKcal: 50 });
  assert.equal(scaleNutrients(input, 0), input);
  assert.equal(scaleNutrients(input, Number.NaN), input);
});
