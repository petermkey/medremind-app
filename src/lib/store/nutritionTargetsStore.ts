'use client';

import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { NutritionTargetProfile, WaterEntry } from '@/types/nutritionTargets';
import {
  validateNutritionTargetInput,
  validateNutritionTargetProfileTargets,
} from '@/lib/food/targetAlgorithm';
import {
  consumedAtForSelectedDateInTimezone,
  localDateForIsoInTimezone,
} from '@/lib/nutrition/waterEntryTime';
import {
  clearCachedNutritionTargets,
  readCachedNutritionTargetsForUser,
  writeCachedNutritionTargetsForUser,
} from '@/lib/nutrition/nutritionTargetsCache';
import {
  loadNutritionTargetProfile,
  pullWaterEntriesForRange,
  syncNutritionTargetProfileSave,
  syncWaterEntrySave,
} from '@/lib/supabase/nutritionTargetsSync';
import {
  enqueueSyncOperation,
  hasQueuedNutritionTargetProfileSaveOperation,
  markSyncFailure,
  markSyncSuccess,
  pumpOutbox,
  removeQueuedSyncOperation,
} from '@/lib/supabase/syncOutbox';

export interface NutritionTargetsStoreState {
  targetProfile: NutritionTargetProfile | null;
  waterEntries: WaterEntry[];
  currentUserId: string | null;
  loadingProfile: boolean;
  loadingWater: boolean;
  error: string | null;
  loadNutritionTargets(userId: string): Promise<void>;
  saveNutritionTargetProfile(profile: NutritionTargetProfile): Promise<void>;
  loadWaterEntriesForRange(userId: string, fromIso: string, toIso: string): Promise<void>;
  quickAddWater(params: {
    userId: string;
    timezone: string;
    selectedDate: string;
    amountMl: number;
  }): WaterEntry;
  waterTotalForDate(date: string, timezone?: string): number;
  resetNutritionTargets(): void;
}

function sortWaterNewestFirst(entries: WaterEntry[]): WaterEntry[] {
  return [...entries].sort((a, b) => {
    const consumedDiff = new Date(b.consumedAt).getTime() - new Date(a.consumedAt).getTime();
    return consumedDiff || b.id.localeCompare(a.id);
  });
}

function validateWaterAmountMl(amountMl: number) {
  if (!Number.isInteger(amountMl) || amountMl < 50 || amountMl > 3000) {
    throw new Error('amountMl must be an integer between 50 and 3000.');
  }
}

function validateProfile(profile: NutritionTargetProfile) {
  const errors = [
    ...validateNutritionTargetInput({
      ageYears: profile.ageYears,
      sex: profile.sex,
      weightKg: profile.weightKg,
      heightCm: profile.heightCm,
      activityLevel: profile.activityLevel,
      bodyFatRange: profile.bodyFatRange,
      goalMode: profile.goalMode,
    }),
    ...validateNutritionTargetProfileTargets(profile),
  ];

  if (errors.length > 0) throw new Error(errors.join(' '));
}

function mergeWaterEntriesForUser(userId: string, ...entryGroups: WaterEntry[][]): WaterEntry[] {
  const entriesById = new Map<string, WaterEntry>();
  for (const entries of entryGroups) {
    for (const entry of entries) {
      if (entry.userId === userId) entriesById.set(entry.id, entry);
    }
  }
  return sortWaterNewestFirst(Array.from(entriesById.values()));
}

function syncTargetProfileFireAndForget(userId: string, profile: NutritionTargetProfile, queuedFallbackId: string | null) {
  void syncNutritionTargetProfileSave(userId, profile)
    .then(() => {
      if (queuedFallbackId) removeQueuedSyncOperation(queuedFallbackId);
      markSyncSuccess();
    })
    .catch((error: unknown) => {
      markSyncFailure(error);
      void pumpOutbox({ force: true });
    });
}

function syncWaterEntryFireAndForget(userId: string, entry: WaterEntry, queuedFallbackId: string | null) {
  void syncWaterEntrySave(userId, entry)
    .then(() => {
      if (queuedFallbackId) removeQueuedSyncOperation(queuedFallbackId);
      markSyncSuccess();
    })
    .catch((error: unknown) => {
      markSyncFailure(error);
      void pumpOutbox({ force: true });
    });
}

export const useNutritionTargetsStore = create<NutritionTargetsStoreState>((set, get) => ({
  targetProfile: null,
  waterEntries: [],
  currentUserId: null,
  loadingProfile: false,
  loadingWater: false,
  error: null,

  async loadNutritionTargets(userId) {
    const cached = readCachedNutritionTargetsForUser(userId);
    set(state => ({
      currentUserId: userId,
      targetProfile: cached.targetProfile ?? (state.targetProfile?.userId === userId ? state.targetProfile : null),
      waterEntries: mergeWaterEntriesForUser(userId, cached.waterEntries, state.waterEntries),
      loadingProfile: true,
      error: null,
    }));
    try {
      const profile = await loadNutritionTargetProfile(userId);
      if (get().currentUserId !== userId) return;
      const cachedAfterLoad = readCachedNutritionTargetsForUser(userId);
      const nextProfile = profile ?? (
        hasQueuedNutritionTargetProfileSaveOperation(userId) ? cachedAfterLoad.targetProfile : null
      );
      writeCachedNutritionTargetsForUser(userId, { targetProfile: nextProfile });
      set({ targetProfile: nextProfile, loadingProfile: false });
    } catch (error) {
      set(state => (
        state.currentUserId === userId
          ? {
              loadingProfile: false,
              error: error instanceof Error ? error.message : String(error),
            }
          : {}
      ));
    }
  },

  async saveNutritionTargetProfile(profile) {
    validateProfile(profile);
    const now = new Date().toISOString();
    const nextProfile = {
      ...profile,
      createdAt: profile.createdAt || now,
      updatedAt: now,
    };
    const queuedFallbackId = enqueueSyncOperation(
      { kind: 'nutritionTargetProfileSave', payload: { userId: nextProfile.userId, profile: nextProfile } },
      { pump: false },
    );
    writeCachedNutritionTargetsForUser(nextProfile.userId, { targetProfile: nextProfile });

    set({
      currentUserId: nextProfile.userId,
      targetProfile: nextProfile,
      error: null,
    });

    syncTargetProfileFireAndForget(nextProfile.userId, nextProfile, queuedFallbackId);
  },

  async loadWaterEntriesForRange(userId, fromIso, toIso) {
    const cached = readCachedNutritionTargetsForUser(userId);
    set(state => ({
      currentUserId: userId,
      waterEntries: mergeWaterEntriesForUser(userId, cached.waterEntries, state.waterEntries),
      loadingWater: true,
      error: null,
    }));
    try {
      const incoming = await pullWaterEntriesForRange(userId, fromIso, toIso);
      set(state => {
        if (state.currentUserId !== userId) return {};

        const waterEntries = mergeWaterEntriesForUser(userId, state.waterEntries, incoming);
        writeCachedNutritionTargetsForUser(userId, { waterEntries });

        return {
          waterEntries,
          loadingWater: false,
        };
      });
    } catch (error) {
      set(state => (
        state.currentUserId === userId
          ? {
              loadingWater: false,
              error: error instanceof Error ? error.message : String(error),
            }
          : {}
      ));
    }
  },

  quickAddWater({ userId, timezone, selectedDate, amountMl }) {
    validateWaterAmountMl(amountMl);
    const now = new Date().toISOString();
    const entry: WaterEntry = {
      id: uuid(),
      userId,
      consumedAt: consumedAtForSelectedDateInTimezone(selectedDate, timezone),
      timezone,
      amountMl,
      source: 'manual',
      createdAt: now,
    };
    const queuedFallbackId = enqueueSyncOperation(
      { kind: 'waterEntrySave', payload: { userId, entry } },
      { pump: false },
    );
    const cached = readCachedNutritionTargetsForUser(userId);
    const waterEntries = mergeWaterEntriesForUser(userId, [entry], cached.waterEntries, get().waterEntries);
    writeCachedNutritionTargetsForUser(userId, { waterEntries });

    set(state => ({
      currentUserId: userId,
      waterEntries: mergeWaterEntriesForUser(userId, waterEntries, state.waterEntries),
      error: null,
    }));

    syncWaterEntryFireAndForget(userId, entry, queuedFallbackId);
    return entry;
  },

  waterTotalForDate(date, timezone) {
    const { currentUserId, waterEntries } = get();
    return waterEntries
      .filter(entry => (!currentUserId || entry.userId === currentUserId) && localDateForIsoInTimezone(entry.consumedAt, timezone) === date)
      .reduce((total, entry) => total + entry.amountMl, 0);
  },

  resetNutritionTargets() {
    clearCachedNutritionTargets();
    set({
      targetProfile: null,
      waterEntries: [],
      currentUserId: null,
      loadingProfile: false,
      loadingWater: false,
      error: null,
    });
  },
}));
