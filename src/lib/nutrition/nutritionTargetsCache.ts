import type { NutritionTargetProfile, WaterEntry } from '../../types/nutritionTargets';

export type NutritionTargetsCacheStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const NUTRITION_TARGETS_CACHE_KEY = 'medremind-nutrition-targets-v1';

export type CachedNutritionTargetsForUser = {
  targetProfile: NutritionTargetProfile | null;
  waterEntries: WaterEntry[];
};

type NutritionTargetsCache = {
  byUserId: Record<string, CachedNutritionTargetsForUser>;
};

function browserStorage(): NutritionTargetsCacheStorage | undefined {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return undefined;
  return localStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function emptyCache(): NutritionTargetsCache {
  return { byUserId: {} };
}

function normalizeProfile(value: unknown, userId: string): NutritionTargetProfile | null {
  if (!isRecord(value) || value.userId !== userId || typeof value.id !== 'string') return null;
  return value as unknown as NutritionTargetProfile;
}

function normalizeWaterEntries(value: unknown, userId: string): WaterEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is WaterEntry => (
    isRecord(entry) &&
    entry.userId === userId &&
    typeof entry.id === 'string' &&
    typeof entry.consumedAt === 'string' &&
    Number.isFinite(entry.amountMl)
  ));
}

function normalizeUserCache(value: unknown, userId: string): CachedNutritionTargetsForUser {
  if (!isRecord(value)) return { targetProfile: null, waterEntries: [] };
  return {
    targetProfile: normalizeProfile(value.targetProfile, userId),
    waterEntries: normalizeWaterEntries(value.waterEntries, userId),
  };
}

function readCache(storage: NutritionTargetsCacheStorage | undefined): NutritionTargetsCache {
  if (!storage) return emptyCache();
  try {
    const parsed = JSON.parse(storage.getItem(NUTRITION_TARGETS_CACHE_KEY) ?? 'null');
    if (!isRecord(parsed) || !isRecord(parsed.byUserId)) return emptyCache();

    const byUserId: NutritionTargetsCache['byUserId'] = {};
    for (const [userId, value] of Object.entries(parsed.byUserId)) {
      if (!userId) continue;
      byUserId[userId] = normalizeUserCache(value, userId);
    }
    return { byUserId };
  } catch {
    return emptyCache();
  }
}

function writeCache(cache: NutritionTargetsCache, storage: NutritionTargetsCacheStorage | undefined) {
  if (!storage) return;
  storage.setItem(NUTRITION_TARGETS_CACHE_KEY, JSON.stringify(cache));
}

export function readCachedNutritionTargetsForUser(
  userId: string,
  storage: NutritionTargetsCacheStorage | undefined = browserStorage(),
): CachedNutritionTargetsForUser {
  return readCache(storage).byUserId[userId] ?? { targetProfile: null, waterEntries: [] };
}

export function writeCachedNutritionTargetsForUser(
  userId: string,
  patch: Partial<CachedNutritionTargetsForUser>,
  storage: NutritionTargetsCacheStorage | undefined = browserStorage(),
): CachedNutritionTargetsForUser {
  const cache = readCache(storage);
  const previous = cache.byUserId[userId] ?? { targetProfile: null, waterEntries: [] };
  const next: CachedNutritionTargetsForUser = {
    targetProfile: patch.targetProfile !== undefined ? patch.targetProfile : previous.targetProfile,
    waterEntries: patch.waterEntries ?? previous.waterEntries,
  };

  cache.byUserId[userId] = normalizeUserCache(next, userId);
  writeCache(cache, storage);
  return cache.byUserId[userId];
}

export function clearCachedNutritionTargets(
  storage: NutritionTargetsCacheStorage | undefined = browserStorage(),
) {
  if (storage) storage.removeItem(NUTRITION_TARGETS_CACHE_KEY);
}
