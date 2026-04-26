export type PendingFoodDeleteStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const PENDING_DELETED_FOOD_ENTRY_IDS_KEY = 'medremind-pending-deleted-food-entry-ids-v1';

const listeners = new Set<(ids: string[]) => void>();

function browserStorage(): PendingFoodDeleteStorage | undefined {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return undefined;
  return localStorage;
}

function unique(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(id => id.length > 0)));
}

function emit(ids: string[]) {
  for (const listener of listeners) listener([...ids]);
}

export function readPendingDeletedFoodEntryIds(
  storage: PendingFoodDeleteStorage | undefined = browserStorage(),
): string[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(PENDING_DELETED_FOOD_ENTRY_IDS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return unique(parsed.filter((value): value is string => typeof value === 'string'));
  } catch {
    return [];
  }
}

export function writePendingDeletedFoodEntryIds(
  ids: string[],
  storage: PendingFoodDeleteStorage | undefined = browserStorage(),
): string[] {
  const next = unique(ids);
  if (storage) storage.setItem(PENDING_DELETED_FOOD_ENTRY_IDS_KEY, JSON.stringify(next));
  emit(next);
  return next;
}

export function addPendingDeletedFoodEntryId(
  entryId: string,
  storage: PendingFoodDeleteStorage | undefined = browserStorage(),
): string[] {
  return writePendingDeletedFoodEntryIds([...readPendingDeletedFoodEntryIds(storage), entryId], storage);
}

export function removePendingDeletedFoodEntryId(
  entryId: string,
  storage: PendingFoodDeleteStorage | undefined = browserStorage(),
): string[] {
  return writePendingDeletedFoodEntryIds(
    readPendingDeletedFoodEntryIds(storage).filter(id => id !== entryId),
    storage,
  );
}

export function clearPendingDeletedFoodEntryIds(
  storage: PendingFoodDeleteStorage | undefined = browserStorage(),
): string[] {
  if (storage) storage.removeItem(PENDING_DELETED_FOOD_ENTRY_IDS_KEY);
  emit([]);
  return [];
}

export function clearPendingDeletedFoodEntryIdsExcept(
  entryIdsToKeep: string[],
  storage: PendingFoodDeleteStorage | undefined = browserStorage(),
): string[] {
  const keep = new Set(entryIdsToKeep);
  const next = readPendingDeletedFoodEntryIds(storage).filter(id => keep.has(id));
  if (next.length > 0) return writePendingDeletedFoodEntryIds(next, storage);
  return clearPendingDeletedFoodEntryIds(storage);
}

export function subscribePendingDeletedFoodEntryIds(listener: (ids: string[]) => void) {
  listeners.add(listener);
  listener(readPendingDeletedFoodEntryIds());
  return () => {
    listeners.delete(listener);
  };
}
