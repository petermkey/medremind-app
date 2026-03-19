# Domain and Schedule Logic (Current Main)

Date: 2026-03-19
Scope: protocol lifecycle, dose generation, and day/schedule behavior on `main`

## 1. Core domain entities

Defined in `src/types/index.ts` and managed in `src/lib/store/store.ts`:

- `Protocol`
- `ProtocolItem`
- `ActiveProtocol`
- `ScheduledDose`
- `DoseRecord`

Key status enums:

- Protocol status: `active | paused | completed | abandoned`
- Dose status: `pending | taken | skipped | snoozed | overdue`

## 2. Protocol creation and finalization

Entry UI: `src/app/app/protocols/new/page.tsx`.

Flow:

1. Step 1 validates protocol metadata.
2. Step 2 composes protocol items.
3. Step 3 finalizes and optionally activates.

Current safeguards:

- Fixed-duration input is validated at entry:
- only positive whole numbers are accepted (`parseFixedDurationDays`).
- invalid fixed duration blocks progression/finalization with user warning.
- Draft item IDs use safe local generation (`generateDraftItemId`) before passing into store.
- Final save path catches and reports finalize errors with controlled UI warning.

Store create path:

- `createCustomProtocol(...)` normalizes `durationDays` defensively (`normalizeDurationDays`).
- Protocol ID is generated via guarded `generateId('protocol')`.

## 3. ID hardening in protocol flow

`src/lib/store/store.ts` uses `generateId(prefix)` in all local write paths relevant to protocol flow:

- profile creation (`signUp` fallback path)
- protocol creation
- active protocol creation
- protocol item creation
- scheduled dose generation
- dose record creation (take/skip/snooze)

`generateId` behavior:

1. try `uuid()`
2. fallback to `crypto.randomUUID()`
3. fallback to `prefix + timestamp + random`

This is the current mitigation for runtime UUID generation failures.

## 4. Activation and fixed-duration end boundary

Activation path: `activateProtocol(protocolId, startDate)` in store.

Current behavior:

- Reads protocol duration via `normalizeDurationDays(protocol.durationDays)`.
- Computes `active.endDate` with `computeInclusiveEndDate(startDate, durationDays)`.
- Inclusive rule is active:
- `durationDays = 1` -> only start date is valid.
- `durationDays = 3` -> start date + day2 + day3 valid.

Dose generation during activation:

- Generates up to a 90-day horizon from start date.
- `expandItemToDoses` caps generation at `active.endDate` when present.

## 5. Update protocol + immediate reconciliation

Update path: `updateProtocol(id, patch)` in store.

Current behavior when `durationDays` changes:

1. Normalize incoming duration defensively.
2. Detect duration change.
3. Update active instances for that protocol (`endDate` recomputed inclusively).
4. Trigger `regenerateDoses(activeId)` for each active instance (except completed).

Result:

- Duration shortening removes future doses outside new boundary.
- Duration extension adds missing future doses up to new boundary.
- Ongoing protocols (`durationDays` undefined) remain uncapped.

## 6. Regeneration logic

Path: `regenerateDoses(activeProtocolId)`.

Current behavior:

- Uses live protocol reference from current store:
- `state.protocols.find(...) ?? active.protocol`
- Deletes future doses (`scheduledDate >= today`) for target active protocol.
- Rebuilds future doses from today over 90-day horizon.
- `expandItemToDoses` still enforces active `endDate` cap.
- Sync path (`syncRegeneratedDoses`) preserves protected slots:
- statuses `taken`, `skipped`, `snoozed`
- doses that already have records

## 7. Dose actions

Store actions:

- `takeDose(doseId, note?)`
- `skipDose(doseId, note?)`
- `snoozeDose(doseId, option)`

Behavior:

- Each action updates dose status locally.
- Each action appends immutable `DoseRecord`.
- Snooze updates both status and scheduled date/time (plus `snoozedUntil`).

Schedule UI (`src/app/app/page.tsx`) provides snooze options:

- 1 hour
- this evening
- tomorrow
- next week

Snooze conflict avoidance in UI:

- If target slot is occupied for same item, it shifts forward in 5-minute increments.

Cloud sync conflict fallback:

- `syncDoseAction` retries snooze update with next available slot when unique slot conflict is returned.

## 8. Day schedule and visibility rules

`getDaySchedule(date)`:

- Past dates: shows all doses for the date.
- Today/future: shows doses only for currently active protocol instances.

`getVisibleDoseDates()`:

- Includes past doses regardless of active status.
- Includes today/future only for currently active protocol instances.

Practical outcome:

- Pausing protocol hides upcoming doses from active surfaces.
- Historical records stay visible.

## 9. AddDoseSheet behavior

Path: `src/components/app/AddDoseSheet.tsx`.

Current behavior:

- Can create/use "My Protocol" when no active protocol exists.
- Ensures activation if needed.
- Adds item and then resolves active instance using fresh store state (`useStore.getState()`), not stale closure.
- Calls `regenerateDoses` on resolved active instance.

This prevents stale-instance bugs immediately after activation.

## 10. Known domain limitations on current main

- Rule engine is still centralized in one large store module.
- Recurrence model supports common cases but not full advanced scheduling DSL.
- Regeneration is local-first and eventually synced; server-side canonical rule engine is not present.

These are part of the deferred domain redesign track, not unresolved regressions in the current hardened slices.
