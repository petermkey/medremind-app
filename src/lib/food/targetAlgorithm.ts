import type {
  GeneratedNutritionTargets,
  NutritionActivityLevel,
  NutritionBodyFatRange,
  NutritionGoalMode,
  NutritionTargetInput,
} from '../../types/nutritionTargets';

export const NUTRITION_TARGET_ALGORITHM_VERSION = 'nutrition-targets-v1';

const ACTIVITY_MULTIPLIERS: Record<NutritionActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
  athlete: 1.9,
};

const CALORIE_MODIFIERS: Record<NutritionGoalMode, number> = {
  bulk: 1.08,
  'lean-dry': 0.82,
  stabilization: 1,
  recomposition: 0.95,
};

const BODY_FAT_MIDPOINTS: Record<NutritionBodyFatRange, number | undefined> = {
  '<10%': 0.09,
  '10-15%': 0.125,
  '15-20%': 0.175,
  '20-25%': 0.225,
  '25%+': 0.275,
  unknown: undefined,
};

const PROTEIN_FACTORS: Record<NutritionGoalMode, number> = {
  bulk: 1.8,
  'lean-dry': 2.2,
  stabilization: 1.6,
  recomposition: 2,
};

const FAT_PERCENTAGES: Record<NutritionGoalMode, number> = {
  bulk: 0.25,
  'lean-dry': 0.22,
  stabilization: 0.28,
  recomposition: 0.25,
};

const WATER_ACTIVITY_ADJUSTMENTS: Record<NutritionActivityLevel, number> = {
  sedentary: 0,
  light: 250,
  moderate: 500,
  high: 750,
  athlete: 1000,
};

const SEX_VALUES = ['male', 'female', 'other_or_prefer_not_to_say'] as const;
const ACTIVITY_LEVEL_VALUES = ['sedentary', 'light', 'moderate', 'high', 'athlete'] as const;
const BODY_FAT_RANGE_VALUES = ['<10%', '10-15%', '15-20%', '20-25%', '25%+', 'unknown'] as const;
const GOAL_MODE_VALUES = ['bulk', 'lean-dry', 'stabilization', 'recomposition'] as const;

function roundTo(value: number, increment: number): number {
  return Math.round(value / increment) * increment;
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

export function validateNutritionTargetInput(input: NutritionTargetInput): string[] {
  const errors: string[] = [];

  if (
    !Number.isFinite(input.ageYears) ||
    !Number.isInteger(input.ageYears) ||
    input.ageYears < 13 ||
    input.ageYears > 100
  ) {
    errors.push('ageYears must be an integer between 13 and 100.');
  }

  if (!Number.isFinite(input.weightKg) || input.weightKg < 30 || input.weightKg > 250) {
    errors.push('weightKg must be between 30 and 250.');
  }

  if (!Number.isFinite(input.heightCm) || input.heightCm < 120 || input.heightCm > 230) {
    errors.push('heightCm must be between 120 and 230.');
  }

  if (!isOneOf(input.sex, SEX_VALUES)) {
    errors.push(`sex must be one of: ${SEX_VALUES.join(', ')}.`);
  }

  if (!isOneOf(input.activityLevel, ACTIVITY_LEVEL_VALUES)) {
    errors.push(`activityLevel must be one of: ${ACTIVITY_LEVEL_VALUES.join(', ')}.`);
  }

  if (!isOneOf(input.bodyFatRange, BODY_FAT_RANGE_VALUES)) {
    errors.push(`bodyFatRange must be one of: ${BODY_FAT_RANGE_VALUES.join(', ')}.`);
  }

  if (!isOneOf(input.goalMode, GOAL_MODE_VALUES)) {
    errors.push(`goalMode must be one of: ${GOAL_MODE_VALUES.join(', ')}.`);
  }

  return errors;
}

export function validatePositiveIntegerTarget(value: number, label: string): string | undefined {
  if (!Number.isInteger(value) || value <= 0) {
    return `${label} must be a positive integer.`;
  }

  return undefined;
}

export function validateWaterTargetMl(value: number): string | undefined {
  if (!Number.isInteger(value) || value < 500 || value > 8000) {
    return 'waterMl must be an integer between 500 and 8000.';
  }

  return undefined;
}

export function validateNutritionTargetProfileTargets(targets: {
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberG: number;
  waterMl: number;
}): string[] {
  const errors = [
    validatePositiveIntegerTarget(targets.caloriesKcal, 'caloriesKcal'),
    validatePositiveIntegerTarget(targets.proteinG, 'proteinG'),
    validatePositiveIntegerTarget(targets.fatG, 'fatG'),
    validatePositiveIntegerTarget(targets.carbsG, 'carbsG'),
    validatePositiveIntegerTarget(targets.fiberG, 'fiberG'),
    validateWaterTargetMl(targets.waterMl),
  ];

  return errors.filter((error): error is string => Boolean(error));
}

function calculateRmr(input: NutritionTargetInput): number {
  const male = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.ageYears + 5;
  const female = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.ageYears - 161;

  if (input.sex === 'male') return male;
  if (input.sex === 'female') return female;
  return (male + female) / 2;
}

export function calculateNutritionTargets(input: NutritionTargetInput): GeneratedNutritionTargets {
  const errors = validateNutritionTargetInput(input);
  if (errors.length > 0) {
    throw new Error(errors.join(' '));
  }

  const rmr = calculateRmr(input);
  const tdee = rmr * ACTIVITY_MULTIPLIERS[input.activityLevel];
  const caloriesKcal = roundTo(tdee * CALORIE_MODIFIERS[input.goalMode], 25);
  const bodyFatMidpoint = BODY_FAT_MIDPOINTS[input.bodyFatRange];
  const leanMassKg =
    bodyFatMidpoint === undefined ? undefined : input.weightKg * (1 - bodyFatMidpoint);
  const proteinEstimate =
    leanMassKg === undefined
      ? input.weightKg * PROTEIN_FACTORS[input.goalMode]
      : Math.max(leanMassKg * PROTEIN_FACTORS[input.goalMode] * 1.15, input.weightKg * 1.4);
  const proteinG = roundTo(proteinEstimate, 5);
  const fatCalories = caloriesKcal * FAT_PERCENTAGES[input.goalMode];
  const fatG = roundTo(Math.max(fatCalories / 9, input.weightKg * 0.6), 5);
  const rawCarbsG = (caloriesKcal - proteinG * 4 - fatG * 9) / 4;
  const carbFloorG = input.weightKg * (input.goalMode === 'lean-dry' ? 1.5 : 2);
  const calorieConstrainedCarbs = rawCarbsG < carbFloorG;
  const carbsG = roundTo(Math.max(rawCarbsG, carbFloorG), 5);
  const fiberG = Math.round(Math.max(25, (caloriesKcal / 1000) * 14));
  const waterMl = roundTo(input.weightKg * 35 + WATER_ACTIVITY_ADJUSTMENTS[input.activityLevel], 250);

  return {
    caloriesKcal,
    proteinG,
    fatG,
    carbsG,
    fiberG,
    waterMl,
    algorithmVersion: NUTRITION_TARGET_ALGORITHM_VERSION,
    leanMassKg,
    warnings: {
      calorieConstrainedCarbs,
    },
  };
}
