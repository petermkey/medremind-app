type FoodEntrySaveQueueItem = {
  id?: string;
  kind: string;
  payload?: {
    userId?: string;
    entry?: {
      id?: string;
    };
  };
};

export function isStaleFoodEntrySaveOperation(
  item: FoodEntrySaveQueueItem,
  userId: string,
  entryId: string,
): boolean {
  return (
    item.kind === 'foodEntrySave' &&
    item.payload?.userId === userId &&
    item.payload.entry?.id === entryId
  );
}

export function removeStaleFoodEntrySaveOperationsFromQueue<T extends FoodEntrySaveQueueItem>(
  queue: T[],
  userId: string,
  entryId: string,
): T[] {
  return queue.filter(item => !isStaleFoodEntrySaveOperation(item, userId, entryId));
}

export function hasStaleFoodEntrySaveOperationInQueue<T extends FoodEntrySaveQueueItem>(
  queue: T[],
  userId: string,
  entryId: string,
): boolean {
  return queue.some(item => isStaleFoodEntrySaveOperation(item, userId, entryId));
}

export function removeSyncOperationFromQueueById<T extends { id: string }>(
  queue: T[],
  id: string,
): T[] {
  return queue.filter(item => item.id !== id);
}
