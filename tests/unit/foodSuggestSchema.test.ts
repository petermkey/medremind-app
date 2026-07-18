import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateFoodSuggestions } from '../../src/lib/food/suggest/suggestSchema';

const validSuggestion = {
  title: 'Творог с ягодами',
  description: '200 г творога 5% с горстью черники.',
  rationale: 'Закрывает ~30 г белка при умеренных калориях.',
  approxNutrients: {
    caloriesKcal: 280,
    proteinG: 34,
    totalFatG: 10,
    carbsG: 14,
    fiberG: 2,
  },
};

test('accepts a valid payload and cleans strings/numbers', () => {
  const suggestions = validateFoodSuggestions({
    suggestions: [
      {
        ...validSuggestion,
        title: '  Творог с ягодами  ',
        approxNutrients: { ...validSuggestion.approxNutrients, proteinG: '34' },
      },
    ],
  });
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].title, 'Творог с ягодами');
  assert.equal(suggestions[0].approxNutrients.proteinG, 34);
});

test('drops items without title/description and keeps valid ones', () => {
  const suggestions = validateFoodSuggestions({
    suggestions: [validSuggestion, { title: '', description: 'x', rationale: '', approxNutrients: {} }],
  });
  assert.equal(suggestions.length, 1);
});

test('caps the list at 3 suggestions', () => {
  const suggestions = validateFoodSuggestions({
    suggestions: [validSuggestion, validSuggestion, validSuggestion, validSuggestion],
  });
  assert.equal(suggestions.length, 3);
});

test('negative and non-finite nutrient values are dropped', () => {
  const [suggestion] = validateFoodSuggestions({
    suggestions: [{
      ...validSuggestion,
      approxNutrients: { caloriesKcal: -5, proteinG: Number.NaN, fiberG: 4 },
    }],
  });
  assert.equal(suggestion.approxNutrients.caloriesKcal, undefined);
  assert.equal(suggestion.approxNutrients.proteinG, undefined);
  assert.equal(suggestion.approxNutrients.fiberG, 4);
});

test('throws when there are no valid suggestions', () => {
  assert.throws(() => validateFoodSuggestions({ suggestions: [] }));
  assert.throws(() => validateFoodSuggestions(null));
  assert.throws(() => validateFoodSuggestions({ suggestions: 'nope' }));
});
