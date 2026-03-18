# MedRemind System Logic (Current)

Date: 2026-03-18
Status: active source of truth

## 1. State and persistence model

The application uses layered persistence:

1. Local Zustand state for immediate UX (`src/lib/store/store.ts`).
2. Supabase as account-bound cloud persistence (`src/lib/supabase/*`).
3. Local outbox retry queue for failed cloud writes (`src/lib/supabase/syncOutbox.ts`).

Browser keys:

- `medremind-store`
- `medremind-sync-outbox-v1`

## 2. Auth bootstrap and cloud load

App shell boot (`src/app/app/layout.tsx`) performs:

1. start outbox processing
2. read current Supabase user
3. if no user: reset local user-scoped state and redirect to `/login`
4. if user changed: reset local user-scoped state to prevent cross-account bleed
5. set profile from auth
6. pull cloud state from Supabase (`pullStoreFromSupabase`)

If cloud pull fails, app remains usable with local state.

## 3. Supabase mapping

- `profiles` (`id`) <-> `profile`
- `notification_settings` (`user_id`) <-> `notificationSettings`
- `protocols` (`owner_id`) <-> custom `protocols`
- `protocol_items` (`protocol_id`) <-> `protocol.items`
- `active_protocols` (`user_id`) <-> `activeProtocols`
- `scheduled_doses` (`user_id`) <-> `scheduledDoses`
- `dose_records` (`user_id`) <-> `doseRecords`
- `drugs` (`created_by`, `is_custom=true`) <-> custom `drugs`

## 4. Sync lifecycle and outbox

Write path pattern:

1. UI action mutates local Zustand state optimistically.
2. Matching cloud write is attempted via `realtimeSync.ts`.
3. On failure, operation is enqueued in outbox.
4. Outbox retries with exponential backoff.

Outbox triggers:

- app start
- online event
- tab visibility regain
- manual flush from Settings (`Flush sync now`)

Global sync status UI:

- `SyncStatusPill` in app shell
- states: `Synced`, `Syncing N`, `Sync error`

## 5. Safe sign-out behavior

Settings sign-out flow:

1. If outbox has pending ops, app attempts forced flush.
2. If pending remains after timeout, user gets confirmation dialog.
3. On sign-out completion, outbox is cleared and local user data is reset.

## 6. Recovery flows

Settings supports:

- export current snapshot to file
- backup current local state to Supabase
- restore local state from Supabase
- load raw local snapshot payload
- import snapshot payload into Supabase

Primary modules:

- `src/lib/supabase/cloudStore.ts`
- `src/lib/supabase/importStore.ts`

## 7. Protocol editing and composition

Protocol list (`/app/protocols`):

- swipe/drag actions per protocol:
  - edit -> opens `/app/protocols/[id]?edit=1`
  - delete

Protocol detail (`/app/protocols/[id]`):

- metadata edit: name/description/category
- full item composition CRUD:
  - add item
  - edit item
  - delete item
- supported item fields follow current protocol item schema:
  - item type, name
  - dose amount/unit/form
  - route
  - frequency + Every N days value
  - time
  - with food
  - instructions
  - icon/color

If protocol instance is active, item composition changes trigger dose regeneration.

## 8. Dose action logic

### Take

- sets dose status to `taken`
- appends `dose_records` action `taken`

### Skip

- sets dose status to `skipped`
- appends `dose_records` action `skipped`
- skipped dose is removed from active queue rendering for the selected day

### Snooze

UI offers options:

- 15 minutes
- 1 hour
- this evening
- tomorrow

Snooze updates:

- status `snoozed`
- `snoozedUntil`
- `scheduledDate`
- `scheduledTime`
- appends `dose_records` action `snoozed`

## 9. Pause/resume visibility rules

Pause/resume changes `active_protocols.status`.

Visibility rule now applied consistently in schedule selectors:

- today/future dates: show doses only from active protocol instances (`status === active`)
- past dates: keep historical doses visible regardless of current protocol status

Implications:

- pausing removes active upcoming doses from user-facing schedule surfaces
- pausing does not erase or hide past recorded history
- resuming restores upcoming visibility for that protocol

## 10. Calendar and schedule surfaces

There is no separate full calendar page currently.

Calendar-like surface is the week strip on `/app`.

- day entries come from `getDaySchedule(selectedDate)`
- date markers come from `getVisibleDoseDates()`
- both follow the pause visibility rules above

## 11. Known limitations

- conflict policy is effectively last-write-wins
- outbox is client-side only (device-local)
- no automated end-to-end persistence matrix in CI yet
- no server-side idempotency framework for all mutation classes

## 12. Historical documents

Point-in-time verification reports are preserved in `docs/` for audit history.
They may describe earlier states and should not override this file.
