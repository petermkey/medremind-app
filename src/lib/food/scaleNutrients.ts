import type { FoodNutrients } from '../../types/food';

const NUTRIENT_KEYS = [
  'caloriesKcal', 'proteinG', 'totalFatG', 'saturatedFatG', 'transFatG',
  'carbsG', 'fiberG', 'sugarsG', 'addedSugarsG', 'sodiumMg', 'cholesterolMg',
] as const satisfies readonly (keyof Omit<FoodNutrients, 'extended'>)[];

export function scaleNutrients(nutrients: FoodNutrients, factor: number): FoodNutrients {
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return nutrients;
  const scaled: FoodNutrients = {};
  for (const key of NUTRIENT_KEYS) {
    const value = nutrients[key];
    if (typeof value === 'number') scaled[key] = Math.round(value * factor * 100) / 100;
  }
  if (nutrients.extended) {
    const extended: Record<string, number> = {};
    for (const [key, value] of Object.entries(nutrients.extended)) {
      if (typeof value === 'number') {
        extended[key] = Math.round(value * factor * 100) / 100;
      }
    }
    scaled.extended = extended;
  }
  return scaled;
}
