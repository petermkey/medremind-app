'use client';

import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { FoodAnalysisDraft, FoodDailyTotals, FoodEntry } from '@/types/food';
import { filterFoodEntriesForLocalDate, sumFoodNutrients } from '@/lib/food/nutrition';
import { pullFoodEntriesForRange, syncFoodEntrySave } from '@/lib/supabase/foodSync';
import {
  enqueueSyncOperation,
  markSyncFailure,
  markSyncSuccess,
  removeQueuedSyncOperation,
} from '@/lib/supabase/syncOutbox';

export interface FoodStoreState {
  entries: FoodEntry[];
  loading: boolean;
  error: string | null;
  loadEntriesForRange(userId: string, fromIso: string, toIso: string): Promise<void>;
  saveDraftAsEntry(params: {
    userId: string;
    timezone: string;
    draft: FoodAnalysisDraft;
    consumedAt?: string;
  }): FoodEntry;
  entriesForDate(date: string, timezone?: string): FoodEntry[];
  totalsForDate(date: string, timezone?: string): FoodDailyTotals;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

function sortNewestFirst(entries: FoodEntry[]): FoodEntry[] {
  return [...entries].sort((a, b) => {
    const consumedDiff = new Date(b.consumedAt).getTime() - new Date(a.consumedAt).getTime();
    return consumedDiff || b.id.localeCompare(a.id);
  });
}

function syncFoodFireAndForget(userId: string, entry: FoodEntry) {
  const queuedFallbackId = enqueueSyncOperation(
    { kind: 'foodEntrySave', payload: { userId, entry } },
    { pump: false },
  );

  void syncFoodEntrySave(userId, entry)
    .then(() => {
      if (queuedFallbackId) removeQueuedSyncOperation(queuedFallbackId);
      markSyncSuccess();
    })
    .catch((error: unknown) => {
      markSyncFailure(error);
    });
}

export const useFoodStore = create<FoodStoreState>((set, get) => ({
  entries: [],
  loading: false,
  error: null,

  async loadEntriesForRange(userId, fromIso, toIso) {
    set({ loading: true, error: null });
    try {
      const incoming = await pullFoodEntriesForRange(userId, fromIso, toIso);
      set(state => {
        const entriesById = new Map(state.entries.map(entry => [entry.id, entry]));
        for (const entry of incoming) {
          entriesById.set(entry.id, entry);
        }
        return {
          entries: sortNewestFirst(Array.from(entriesById.values())),
          loading: false,
        };
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  saveDraftAsEntry({ userId, timezone, draft, consumedAt }) {
    const now = new Date().toISOString();
    const entryId = uuid();
    const entry: FoodEntry = {
      id: entryId,
      userId,
      consumedAt: consumedAt ?? now,
      timezone,
      mealLabel: draft.mealLabel,
      title: draft.title,
      summary: draft.summary,
      source: 'photo_ai',
      estimationConfidence: clampConfidence(draft.estimationConfidence),
      analysisModel: draft.model,
      analysisSchemaVersion: draft.schemaVersion,
      nutrients: draft.nutrients,
      uncertainties: draft.uncertainties,
      components: draft.components.map((component, index) => ({
        id: uuid(),
        entryId,
        userId,
        name: component.name,
        category: component.category,
        estimatedQuantity: component.estimatedQuantity,
        estimatedUnit: component.estimatedUnit,
        gramsEstimate: component.gramsEstimate,
        confidence: clampConfidence(component.confidence),
        notes: component.notes,
        sortOrder: index,
      })),
      createdAt: now,
      updatedAt: now,
    };

    set(state => ({
      entries: [entry, ...state.entries.filter(existing => existing.id !== entry.id)],
    }));

    syncFoodFireAndForget(userId, entry);
    return entry;
  },

  entriesForDate(date, timezone) {
    return sortNewestFirst(filterFoodEntriesForLocalDate(get().entries, date, timezone));
  },

  totalsForDate(date, timezone) {
    return sumFoodNutrients(get().entriesForDate(date, timezone));
  },
}));
