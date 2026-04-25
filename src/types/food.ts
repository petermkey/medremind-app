export type FoodMealLabel = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'unknown';

export type FoodEntrySource = 'photo_ai';

export interface FoodNutrients {
  caloriesKcal?: number;
  proteinG?: number;
  totalFatG?: number;
  saturatedFatG?: number;
  transFatG?: number;
  carbsG?: number;
  fiberG?: number;
  sugarsG?: number;
  addedSugarsG?: number;
  sodiumMg?: number;
  cholesterolMg?: number;
  extended?: Record<string, number>;
}

export interface FoodEntryComponent {
  id: string;
  entryId: string;
  userId: string;
  name: string;
  category?: string;
  estimatedQuantity?: number;
  estimatedUnit?: string;
  gramsEstimate?: number;
  confidence: number;
  notes?: string;
  sortOrder: number;
}

export interface FoodEntry {
  id: string;
  userId: string;
  consumedAt: string;
  timezone: string;
  mealLabel: FoodMealLabel;
  title: string;
  summary: string;
  source: FoodEntrySource;
  estimationConfidence: number;
  analysisModel?: string;
  analysisSchemaVersion: string;
  nutrients: FoodNutrients;
  uncertainties: string[];
  components: FoodEntryComponent[];
  createdAt: string;
  updatedAt: string;
}

export interface FoodAnalysisComponentDraft {
  name: string;
  category?: string;
  estimatedQuantity?: number;
  estimatedUnit?: string;
  gramsEstimate?: number;
  confidence: number;
  notes?: string;
}

export interface FoodAnalysisDraft {
  title: string;
  summary: string;
  mealLabel: FoodMealLabel;
  components: FoodAnalysisComponentDraft[];
  nutrients: FoodNutrients;
  uncertainties: string[];
  estimationConfidence: number;
  model: string;
  schemaVersion: 'food-analysis-v1';
}

export interface FoodDailyTotals extends FoodNutrients {
  entryCount: number;
}
