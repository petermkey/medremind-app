const inflightSaveCountsByEntryId = new Map<string, number>();

export function incrementInflightFoodEntrySave(entryId: string) {
  inflightSaveCountsByEntryId.set(entryId, (inflightSaveCountsByEntryId.get(entryId) ?? 0) + 1);
}

export function decrementInflightFoodEntrySave(entryId: string) {
  const next = (inflightSaveCountsByEntryId.get(entryId) ?? 0) - 1;
  if (next > 0) {
    inflightSaveCountsByEntryId.set(entryId, next);
    return;
  }
  inflightSaveCountsByEntryId.delete(entryId);
}

export function hasInflightFoodEntrySave(entryId: string): boolean {
  return (inflightSaveCountsByEntryId.get(entryId) ?? 0) > 0;
}

export function getInflightFoodEntrySaveIds(): string[] {
  return Array.from(inflightSaveCountsByEntryId.keys());
}
