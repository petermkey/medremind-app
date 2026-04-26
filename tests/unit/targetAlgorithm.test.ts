import assert from 'node:assert/strict';
import {
  calculateNutritionTargets,
  validateNutritionTargetProfileTargets,
  validateNutritionTargetInput,
} from '../../src/lib/food/targetAlgorithm';
import {
  addPendingDeletedFoodEntryId,
  clearPendingDeletedFoodEntryIds,
  readPendingDeletedFoodEntryIds,
  removePendingDeletedFoodEntryId,
} from '../../src/lib/food/pendingFoodDeletes';
import {
  consumedAtForSelectedDateInTimezone,
  localDateForIsoInTimezone,
} from '../../src/lib/nutrition/waterEntryTime';
import {
  clearCachedNutritionTargets,
  readCachedNutritionTargetsForUser,
  writeCachedNutritionTargetsForUser,
} from '../../src/lib/nutrition/nutritionTargetsCache';
import {
  hasStaleFoodEntrySaveOperationInQueue,
  removeStaleFoodEntrySaveOperationsFromQueue,
  removeSyncOperationFromQueueById,
} from '../../src/lib/supabase/syncOutboxQueue';
import type { NutritionTargetInput } from '../../src/types/nutritionTargets';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const baseInput: NutritionTargetInput = {
  ageYears: 34,
  sex: 'male',
  weightKg: 82,
  heightCm: 180,
  activityLevel: 'moderate',
  bodyFatRange: '15-20%',
  goalMode: 'stabilization',
};

function withGoal(goalMode: NutritionTargetInput['goalMode']): NutritionTargetInput {
  return { ...baseInput, goalMode };
}

function assertRounded(value: number, increment: number, label: string) {
  assert.equal(value % increment, 0, `${label} should be rounded to ${increment}`);
}

{
  const result = calculateNutritionTargets(baseInput);

  assert.deepEqual(result, {
    caloriesKcal: 2750,
    proteinG: 125,
    fatG: 85,
    carbsG: 370,
    fiberG: 39,
    waterMl: 3250,
    algorithmVersion: 'nutrition-targets-v1',
    leanMassKg: 67.64999999999999,
    warnings: {
      calorieConstrainedCarbs: false,
    },
  });
  assert.ok(result.caloriesKcal > 0);
  assert.ok(result.proteinG > 0);
  assert.ok(result.fatG > 0);
  assert.ok(result.carbsG > 0);
  assert.ok(result.fiberG > 0);
  assert.ok(result.waterMl > 0);
  assertRounded(result.caloriesKcal, 25, 'calories');
  assertRounded(result.proteinG, 5, 'protein');
  assertRounded(result.fatG, 5, 'fat');
  assertRounded(result.carbsG, 5, 'carbs');
  assertRounded(result.waterMl, 250, 'water');
  assert.equal(result.warnings.calorieConstrainedCarbs, false);
}

{
  const bulk = calculateNutritionTargets(withGoal('bulk'));
  const leanDry = calculateNutritionTargets(withGoal('lean-dry'));
  const stabilization = calculateNutritionTargets(withGoal('stabilization'));
  const recomposition = calculateNutritionTargets(withGoal('recomposition'));

  assert.ok(bulk.caloriesKcal > stabilization.caloriesKcal);
  assert.ok(stabilization.caloriesKcal > recomposition.caloriesKcal);
  assert.ok(recomposition.caloriesKcal > leanDry.caloriesKcal);
}

{
  const result = calculateNutritionTargets({ ...baseInput, bodyFatRange: 'unknown' });

  assert.ok(result.proteinG > 0);
  assert.equal(result.leanMassKg, undefined);
}

{
  const unknown = calculateNutritionTargets({
    ...baseInput,
    weightKg: 100,
    bodyFatRange: 'unknown',
    goalMode: 'recomposition',
  });
  const higherBodyFat = calculateNutritionTargets({
    ...baseInput,
    weightKg: 100,
    bodyFatRange: '25%+',
    goalMode: 'recomposition',
  });

  assert.ok(higherBodyFat.proteinG >= 140);
  assert.ok(higherBodyFat.proteinG < unknown.proteinG);
  assert.ok(higherBodyFat.proteinG <= 200);
}

{
  const constrained = calculateNutritionTargets({
    ageYears: 45,
    sex: 'female',
    weightKg: 50,
    heightCm: 120,
    activityLevel: 'sedentary',
    bodyFatRange: 'unknown',
    goalMode: 'lean-dry',
  });

  assert.equal(constrained.carbsG, 75);
  assert.equal(constrained.warnings.calorieConstrainedCarbs, true);
}

{
  const light = calculateNutritionTargets({ ...baseInput, weightKg: 70, activityLevel: 'light' });
  const athlete = calculateNutritionTargets({ ...baseInput, weightKg: 90, activityLevel: 'athlete' });

  assert.ok(athlete.waterMl > light.waterMl);
  assertRounded(light.waterMl, 250, 'light water');
  assertRounded(athlete.waterMl, 250, 'athlete water');
}

{
  const errors = validateNutritionTargetInput({
    ...baseInput,
    ageYears: 12,
    weightKg: 29,
    heightCm: 119,
  });

  assert.deepEqual(errors, [
    'ageYears must be an integer between 13 and 100.',
    'weightKg must be between 30 and 250.',
    'heightCm must be between 120 and 230.',
  ]);
  assert.throws(() => calculateNutritionTargets({ ...baseInput, ageYears: 101 }), /ageYears/);
}

{
  const invalid = {
    ...baseInput,
    ageYears: 34.5,
    sex: 'invalid',
    activityLevel: 'invalid',
    bodyFatRange: 'invalid',
    goalMode: 'invalid',
  } as unknown as NutritionTargetInput;

  assert.deepEqual(validateNutritionTargetInput(invalid), [
    'ageYears must be an integer between 13 and 100.',
    'sex must be one of: male, female, other_or_prefer_not_to_say.',
    'activityLevel must be one of: sedentary, light, moderate, high, athlete.',
    'bodyFatRange must be one of: <10%, 10-15%, 15-20%, 20-25%, 25%+, unknown.',
    'goalMode must be one of: bulk, lean-dry, stabilization, recomposition.',
  ]);
  assert.throws(() => calculateNutritionTargets(invalid), /sex must be one of/);
}

{
  assert.deepEqual(validateNutritionTargetProfileTargets({
    caloriesKcal: 2200,
    proteinG: 160,
    fatG: 70,
    carbsG: 240,
    fiberG: 35,
    waterMl: 3000,
  }), []);

  assert.deepEqual(validateNutritionTargetProfileTargets({
    caloriesKcal: 0,
    proteinG: 160.5,
    fatG: -1,
    carbsG: Number.NaN,
    fiberG: 0,
    waterMl: 499,
  }), [
    'caloriesKcal must be a positive integer.',
    'proteinG must be a positive integer.',
    'fatG must be a positive integer.',
    'carbsG must be a positive integer.',
    'fiberG must be a positive integer.',
    'waterMl must be an integer between 500 and 8000.',
  ]);
}

{
  const now = new Date('2026-01-15T01:30:45.123Z');
  const consumedAt = consumedAtForSelectedDateInTimezone('2026-02-20', 'America/Los_Angeles', now);

  assert.equal(consumedAt, '2026-02-21T01:30:45.123Z');
  assert.equal(localDateForIsoInTimezone(consumedAt, 'America/Los_Angeles'), '2026-02-20');
  assert.equal(localDateForIsoInTimezone(consumedAt, 'UTC'), '2026-02-21');
}

{
  const now = new Date('2026-07-10T23:05:06.007Z');
  const consumedAt = consumedAtForSelectedDateInTimezone('2026-12-03', 'Asia/Tokyo', now);

  assert.equal(consumedAt, '2026-12-02T23:05:06.007Z');
  assert.equal(localDateForIsoInTimezone(consumedAt, 'Asia/Tokyo'), '2026-12-03');
}

{
  const storage = new MemoryStorage();

  assert.deepEqual(readPendingDeletedFoodEntryIds(storage), []);
  assert.deepEqual(addPendingDeletedFoodEntryId('entry-1', storage), ['entry-1']);
  assert.deepEqual(addPendingDeletedFoodEntryId('entry-1', storage), ['entry-1']);
  assert.deepEqual(addPendingDeletedFoodEntryId('entry-2', storage), ['entry-1', 'entry-2']);
  assert.deepEqual(removePendingDeletedFoodEntryId('entry-1', storage), ['entry-2']);
  assert.deepEqual(readPendingDeletedFoodEntryIds(storage), ['entry-2']);
  clearPendingDeletedFoodEntryIds(storage);
  assert.deepEqual(readPendingDeletedFoodEntryIds(storage), []);
}

{
  const storage = new MemoryStorage();
  const profile = {
    id: 'profile-1',
    userId: 'user-1',
    ageYears: 34,
    sex: 'male',
    weightKg: 82,
    heightCm: 180,
    activityLevel: 'moderate',
    bodyFatRange: '15-20%',
    goalMode: 'stabilization',
    caloriesKcal: 2400,
    proteinG: 150,
    fatG: 80,
    carbsG: 250,
    fiberG: 35,
    waterMl: 2700,
    algorithmVersion: 'nutrition-targets-v1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as const;
  const waterEntry = {
    id: 'water-1',
    userId: 'user-1',
    consumedAt: '2026-01-01T12:00:00.000Z',
    timezone: 'UTC',
    amountMl: 250,
    source: 'manual',
    createdAt: '2026-01-01T12:00:00.000Z',
  } as const;

  writeCachedNutritionTargetsForUser('user-1', { targetProfile: profile, waterEntries: [waterEntry] }, storage);
  assert.deepEqual(readCachedNutritionTargetsForUser('user-1', storage), {
    targetProfile: profile,
    waterEntries: [waterEntry],
  });
  assert.deepEqual(readCachedNutritionTargetsForUser('user-2', storage), {
    targetProfile: null,
    waterEntries: [],
  });
  clearCachedNutritionTargets(storage);
  assert.deepEqual(readCachedNutritionTargetsForUser('user-1', storage), {
    targetProfile: null,
    waterEntries: [],
  });
}

{
  const queue = [
    { id: 'save-1', kind: 'foodEntrySave', payload: { userId: 'user-1', entry: { id: 'entry-1' } } },
    { id: 'save-2', kind: 'foodEntrySave', payload: { userId: 'user-2', entry: { id: 'entry-1' } } },
    { id: 'save-3', kind: 'foodEntrySave', payload: { userId: 'user-1', entry: { id: 'entry-2' } } },
    { id: 'delete-1', kind: 'foodEntryDelete', payload: { userId: 'user-1', entryId: 'entry-1' } },
  ];

  assert.deepEqual(
    removeStaleFoodEntrySaveOperationsFromQueue(queue, 'user-1', 'entry-1').map(item => item.id),
    ['save-2', 'save-3', 'delete-1'],
  );
  assert.equal(hasStaleFoodEntrySaveOperationInQueue(queue, 'user-1', 'entry-1'), true);
  assert.equal(hasStaleFoodEntrySaveOperationInQueue(queue, 'user-1', 'entry-3'), false);
  assert.deepEqual(removeSyncOperationFromQueueById(queue, 'save-2').map(item => item.id), [
    'save-1',
    'save-3',
    'delete-1',
  ]);
}
