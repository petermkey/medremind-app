export type NutritionTargetSex = 'male' | 'female' | 'other_or_prefer_not_to_say';

export type NutritionActivityLevel = 'sedentary' | 'light' | 'moderate' | 'high' | 'athlete';

export type NutritionBodyFatRange = '<10%' | '10-15%' | '15-20%' | '20-25%' | '25%+' | 'unknown';

export type NutritionGoalMode = 'bulk' | 'lean-dry' | 'stabilization' | 'recomposition';

export interface NutritionTargetInput {
  ageYears: number;
  sex: NutritionTargetSex;
  weightKg: number;
  heightCm: number;
  activityLevel: NutritionActivityLevel;
  bodyFatRange: NutritionBodyFatRange;
  goalMode: NutritionGoalMode;
}

export interface NutritionTargetWarnings {
  calorieConstrainedCarbs: boolean;
}

export interface GeneratedNutritionTargets {
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberG: number;
  waterMl: number;
  algorithmVersion: string;
  leanMassKg?: number;
  warnings: NutritionTargetWarnings;
}

export interface NutritionTargetProfile {
  id: string;
  userId: string;
  ageYears: number;
  sex: NutritionTargetSex;
  weightKg: number;
  heightCm: number;
  activityLevel: NutritionActivityLevel;
  bodyFatRange: NutritionBodyFatRange;
  goalMode: NutritionGoalMode;
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberG: number;
  waterMl: number;
  algorithmVersion: string;
  createdAt: string;
  updatedAt: string;
}

export type WaterEntrySource = 'manual';

export interface WaterEntry {
  id: string;
  userId: string;
  consumedAt: string;
  timezone: string;
  amountMl: number;
  source: WaterEntrySource;
  createdAt: string;
}
