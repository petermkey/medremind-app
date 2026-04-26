'use client';

import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { FoodAnalysisDraft, FoodDailyTotals, FoodEntry } from '@/types/food';
import { filterFoodEntriesForLocalDate, sumFoodNutrients } from '@/lib/food/nutrition';
import {
  addPendingDeletedFoodEntryId,
  removePendingDeletedFoodEntryId,
  readPendingDeletedFoodEntryIds,
  subscribePendingDeletedFoodEntryIds,
} from '@/lib/food/pendingFoodDeletes';
import {
  decrementInflightFoodEntrySave,
  incrementInflightFoodEntrySave,
} from '@/lib/food/inflightFoodSaves';
import { pullFoodEntriesForRange, syncFoodEntryDelete, syncFoodEntrySave } from '@/lib/supabase/foodSync';
import {
  enqueueSyncOperation,
  markSyncFailure,
  markSyncSuccess,
  pumpOutbox,
  removeQueuedFoodEntrySaveOperations,
  removeQueuedSyncOperation,
} from '@/lib/supabase/syncOutbox';

const NUTRIENT_KEYS = [
  'caloriesKcal',
  'proteinG',
  'totalFatG',
  'saturatedFatG',
  'transFatG',
  'carbsG',
  'fiberG',
  'sugarsG',
  'addedSugarsG',
  'sodiumMg',
  'cholesterolMg',
] as const satisfies readonly (keyof Omit<FoodEntry['nutrients'], 'extended'>)[];

export interface FoodStoreState {
  entries: FoodEntry[];
  pendingDeletedEntryIds: string[];
  currentUserId: string | null;
  loading: boolean;
  error: string | null;
  loadEntriesForRange(userId: string, fromIso: string, toIso: string): Promise<void>;
  saveDraftAsEntry(params: {
    userId: string;
    timezone: string;
    draft: FoodAnalysisDraft;
    consumedAt?: string;
  }): FoodEntry;
  deleteFoodEntry(entryId: string, userId?: string): void;
  entriesForDate(date: string, timezone?: string): FoodEntry[];
  totalsForDate(date: string, timezone?: string): FoodDailyTotals;
  resetFoodEntries(): void;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

function copyOptionalNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function copyOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function copyNutrients(nutrients: FoodEntry['nutrients']): FoodEntry['nutrients'] {
  const copy: FoodEntry['nutrients'] = {};

  for (const key of NUTRIENT_KEYS) {
    const value = copyOptionalNumber(nutrients[key]);
    if (value !== undefined) copy[key] = value;
  }

  if (nutrients.extended) {
    const extended: Record<string, number> = {};
    for (const [key, value] of Object.entries(nutrients.extended)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        extended[key] = value;
      }
    }
    if (Object.keys(extended).length > 0) copy.extended = extended;
  }

  return copy;
}

function copyUncertainties(uncertainties: string[]): string[] {
  return uncertainties
    .map(value => value.trim())
    .filter(value => value.length > 0);
}

function sortNewestFirst(entries: FoodEntry[]): FoodEntry[] {
  return [...entries].sort((a, b) => {
    const consumedDiff = new Date(b.consumedAt).getTime() - new Date(a.consumedAt).getTime();
    return consumedDiff || b.id.localeCompare(a.id);
  });
}

function syncFoodFireAndForget(userId: string, entry: FoodEntry, isLocallyDeleted: () => boolean) {
  incrementInflightFoodEntrySave(entry.id);
  const queuedFallbackId = enqueueSyncOperation(
    { kind: 'foodEntrySave', payload: { userId, entry } },
    { pump: false },
  );

  void syncFoodEntrySave(userId, entry)
    .then(() => {
      if (queuedFallbackId) removeQueuedSyncOperation(queuedFallbackId);
      if (isLocallyDeleted()) {
        addPendingDeletedFoodEntryId(entry.id);
        removeQueuedFoodEntrySaveOperations(userId, entry.id);
        syncFoodDeleteFireAndForget(userId, entry.id);
        return;
      }
      markSyncSuccess();
    })
    .catch((error: unknown) => {
      markSyncFailure(error);
      void pumpOutbox({ force: true });
    })
    .finally(() => {
      decrementInflightFoodEntrySave(entry.id);
    });
}

function syncFoodDeleteFireAndForget(userId: string, entryId: string) {
  const queuedFallbackId = enqueueSyncOperation(
    { kind: 'foodEntryDelete', payload: { userId, entryId } },
    { pump: false },
  );

  void syncFoodEntryDelete(userId, entryId)
    .then(() => {
      removePendingDeletedFoodEntryId(entryId);
      markSyncSuccess();
      void pumpOutbox({ force: true });
    })
    .catch((error: unknown) => {
      markSyncFailure(error);
      void pumpOutbox({ force: true });
    });
}

export const useFoodStore = create<FoodStoreState>((set, get) => ({
  entries: [],
  pendingDeletedEntryIds: readPendingDeletedFoodEntryIds(),
  currentUserId: null,
  loading: false,
  error: null,

  async loadEntriesForRange(userId, fromIso, toIso) {
    const pendingDeletedEntryIds = readPendingDeletedFoodEntryIds();
    set(state => ({
      currentUserId: userId,
      entries: state.entries.filter(entry => entry.userId === userId),
      pendingDeletedEntryIds,
      loading: true,
      error: null,
    }));
    try {
      const incoming = await pullFoodEntriesForRange(userId, fromIso, toIso);
      set(state => {
        if (state.currentUserId !== userId) {
          return {};
        }
        const pendingDeleted = new Set(state.pendingDeletedEntryIds);

        const entriesById = new Map(
          state.entries
            .filter(entry => entry.userId === userId && !pendingDeleted.has(entry.id))
            .map(entry => [entry.id, entry]),
        );
        for (const entry of incoming) {
          if (pendingDeleted.has(entry.id)) continue;
          entriesById.set(entry.id, entry);
        }
        return {
          entries: sortNewestFirst(Array.from(entriesById.values())),
          loading: false,
        };
      });
    } catch (error) {
      set(state => (
        state.currentUserId === userId
          ? {
              loading: false,
              error: error instanceof Error ? error.message : String(error),
            }
          : {}
      ));
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
      nutrients: copyNutrients(draft.nutrients),
      uncertainties: copyUncertainties(draft.uncertainties),
      components: draft.components.map((component, index) => ({
        id: uuid(),
        entryId,
        userId,
        name: String(component.name).trim(),
        category: copyOptionalString(component.category),
        estimatedQuantity: copyOptionalNumber(component.estimatedQuantity),
        estimatedUnit: copyOptionalString(component.estimatedUnit),
        gramsEstimate: copyOptionalNumber(component.gramsEstimate),
        confidence: clampConfidence(component.confidence),
        notes: copyOptionalString(component.notes),
        sortOrder: index,
      })),
      createdAt: now,
      updatedAt: now,
    };

    set(state => ({
      currentUserId: userId,
      entries: [
        entry,
        ...state.entries.filter(existing => existing.userId === userId && existing.id !== entry.id),
      ],
    }));

    syncFoodFireAndForget(userId, entry, () => {
      if (readPendingDeletedFoodEntryIds().includes(entry.id)) return true;
      const state = get();
      return state.currentUserId === userId && !state.entries.some(existing => existing.userId === userId && existing.id === entry.id);
    });
    return entry;
  },

  deleteFoodEntry(entryId, userId) {
    const resolvedUserId = userId ?? get().currentUserId;
    if (!resolvedUserId) {
      set({ error: 'Food entry delete failed: no current user.' });
      return;
    }

    set(state => {
      const pendingDeletedEntryIds = addPendingDeletedFoodEntryId(entryId);
      return {
        currentUserId: resolvedUserId,
        pendingDeletedEntryIds,
        entries: state.entries.filter(entry => entry.id !== entryId),
        error: null,
      };
    });

    removeQueuedFoodEntrySaveOperations(resolvedUserId, entryId);
    syncFoodDeleteFireAndForget(resolvedUserId, entryId);
  },

  entriesForDate(date, timezone) {
    const { currentUserId, entries, pendingDeletedEntryIds } = get();
    const pendingDeleted = new Set(pendingDeletedEntryIds);
    const scopedEntries = currentUserId
      ? entries.filter(entry => entry.userId === currentUserId && !pendingDeleted.has(entry.id))
      : entries.filter(entry => !pendingDeleted.has(entry.id));
    return sortNewestFirst(filterFoodEntriesForLocalDate(scopedEntries, date, timezone));
  },

  totalsForDate(date, timezone) {
    return sumFoodNutrients(get().entriesForDate(date, timezone));
  },

  resetFoodEntries() {
    set({
      entries: [],
      pendingDeletedEntryIds: [],
      currentUserId: null,
      loading: false,
      error: null,
    });
  },
}));

if (typeof window !== 'undefined') {
  subscribePendingDeletedFoodEntryIds(pendingDeletedEntryIds => {
    useFoodStore.setState({ pendingDeletedEntryIds });
  });
}
