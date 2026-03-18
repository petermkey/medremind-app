# MedRemind System Logic (Current)

Date: 2026-03-18

## 1. Persistence Model

Source of truth is layered:
1. Local Zustand store (`src/lib/store/store.ts`) for immediate UX.
2. Supabase tables for account-bound cloud persistence.
3. Local sync outbox (`src/lib/supabase/syncOutbox.ts`) for failed-write replay.

Local storage keys:
- `medremind-store` - persisted app state.
- `medremind-sync-outbox-v1` - queued cloud operations for retry.

## 2. Cloud Sync Lifecycle

Write path:
- UI action updates local store optimistically.
- Matching cloud call is fired via `realtimeSync`.
- If cloud call fails, operation is queued in outbox.
- Outbox retries with exponential backoff and on online/visibility events.

Read path:
- `/app` layout boot authenticates user and calls `pullStoreFromSupabase()`.
- Cloud rows are mapped to local entities and injected into Zustand state.

## 3. Supabase Entity Mapping

- `protocols` (`owner_id`) <-> local `protocols`
- `protocol_items` (`protocol_id`) <-> `protocol.items`
- `active_protocols` (`user_id`) <-> local `activeProtocols`
- `scheduled_doses` (`user_id`) <-> local `scheduledDoses`
- `dose_records` (`user_id`) <-> local `doseRecords`
- `profiles` (`id`) <-> local `profile`
- `notification_settings` (`user_id`) <-> local `notificationSettings`

## 4. Recovery Flows

Implemented in settings page:
- Export snapshot to JSON file.
- Backup current local state into Supabase.
- Restore local state from Supabase.
- Load raw local snapshot payload.
- Import raw snapshot payload into Supabase.

Primary modules:
- `src/lib/supabase/cloudStore.ts`
- `src/lib/supabase/importStore.ts`

## 5. Protocol and Item CRUD UX

Protocol list page (`/app/protocols`):
- Swipe left (touch) or drag left (mouse) on a protocol card.
- Actions:
  - `Edit` - updates protocol metadata (name/description/category).
  - `Delete` - removes protocol plus related active protocols/scheduled doses/dose records.

Protocol detail page (`/app/protocols/[id]`):
- Swipe left/drag left on each protocol item.
- Actions:
  - `Edit` - updates item fields (name, dose, unit, frequency, time).
  - `Delete` - removes item.
- If protocol is active, edit/delete triggers dose regeneration.

## 6. Frequency Rules

Supported item frequencies in current UI:
- `daily`
- `twice_daily`
- `three_times_daily`
- `weekly`
- `every_n_days` (requires explicit `N` value)

Notes:
- For `every_n_days`, UI now captures `frequencyValue`.
- Display labels render as `every N days`.

## 7. Regeneration Safety Rules

`syncRegeneratedDoses` avoids destructive deletes:
- Loads existing future doses.
- Protects doses with status `taken/skipped/snoozed`.
- Protects doses referenced by `dose_records` (FK safety).
- Deletes only non-protected future doses.
- Upserts new generated doses excluding protected schedule slots.

This prevents FK failures like:
- deleting `scheduled_doses` rows referenced by `dose_records`.

## 8. Known Constraints

- Conflict resolution is currently last-write-wins.
- Outbox stores full operation payloads (can grow for large entities).
- No dedicated automated integration suite yet for full persistence matrix.
