# Sprint 2B Read-Model Planning (Design Only)

Date: 2026-03-19  
Branch: `codex/lifecycle-sprint2b-readmodel-plan`  
Status: planning-ready

## Scope and non-goals

- Define read-model switch plan only.
- Do not switch runtime reads in this pass.
- Do not change current screen behavior in this pass.

## 1. Current read-path map

### Today / Schedule (`/app`)

Primary file: [`src/app/app/page.tsx`](/Volumes/DATA/GRAVITY%20REPO/worktrees/medremind-sprint2b/src/app/app/page.tsx)  
Current selectors:

1. `getDaySchedule(selectedDate)` from store:
- For past date: all `scheduledDoses` on date.
- For today/future: only doses whose `activeProtocolId` is currently in `activeProtocols` with `status = active`.

2. `getVisibleDoseDates()` from store:
- Includes any past date with doses.
- Includes today/future only for active protocol instances.

3. UI-only semantic filtering in page:
- `visibleDoses = doses.filter(status !== 'skipped')` (hides skipped rows on Schedule surface).
- `nextDose` is from statuses `pending|snoozed|upcoming`.

### Calendar (`/app/progress`, calendar and 7-day rings)

Primary file: [`src/app/app/progress/page.tsx`](/Volumes/DATA/GRAVITY%20REPO/worktrees/medremind-sprint2b/src/app/app/progress/page.tsx)  
Current source:

- Direct raw scans over `scheduledDoses` by date/protocol/status.
- Uses `activeProtocols` for track selection and protocol labels/colors.
- Future days are displayed with zeroed progress rings (`isFuture ? 0 : pct`) in component logic.

### History (currently implicit, not a dedicated screen)

Current behavior is split:

1. Schedule page past-date view (`getDaySchedule(date < today)`) shows all dose rows including non-active instances.
2. Progress page aggregates all historical `scheduledDoses` statuses directly.
3. `doseRecords` is not used as the primary history read model in UI; history semantics are inferred from mutable `scheduledDoses.status`.

### Protocol detail (`/app/protocols/[id]`)

Primary file: [`src/app/app/protocols/[id]/page.tsx`](/Volumes/DATA/GRAVITY%20REPO/worktrees/medremind-sprint2b/src/app/app/protocols/%5Bid%5D/page.tsx)  
Current source:

- Reads protocol metadata from `protocols`.
- Reads lifecycle state from `activeProtocols.find(ap.protocolId === id)`.
- Item edits trigger protocol writes and optional `regenerateDoses(instance.id)` for active instance.
- No dedicated timeline model; historical instance events are not normalized for this screen.

## 2. Target read-model definitions

## `today_schedule_view`

Inputs:
- `planned_occurrences` (or bridge from `scheduled_doses` during migration)
- `execution_events`
- `active_protocols`
- `protocols`, `protocol_items`
- current date/time + user timezone

Output fields:
- `occurrence_id`, `active_protocol_id`, `protocol_id`, `protocol_item_id`
- display: `protocol_name`, `item_name`, `dose_meta`, `scheduled_date`, `scheduled_time`
- lifecycle: `occurrence_state`, `is_superseded`, `is_future`, `is_today`
- execution summary: `last_event_type`, `last_event_at`, `effective_status`
- actionability: `can_take`, `can_skip`, `can_snooze`, `is_hidden_on_today_surface`

Visibility/lifecycle rules:
- Show today rows only.
- Include pending and snoozed actionable rows.
- Exclude `superseded` rows by default.
- Hide skipped rows from the primary Today queue (to preserve current UX).
- Keep taken/skipped rows available in optional “completed today” subsection.

## `current_schedule_view`

Inputs:
- same base inputs as `today_schedule_view`
- date range filter (`selected_date` or week window)

Output fields:
- all `today_schedule_view` fields plus `section_label` (Morning/Afternoon/Evening)
- `instance_status_at_occurrence` (active/paused/completed/cancelled/archived)

Visibility/lifecycle rules:
- For past dates: include all non-superseded rows for historical visibility.
- For today/future: include rows for active instances by default.
- Rows from paused/completed/cancelled/archived instances are excluded from active queue but available through history/timeline surfaces.

## `history_view`

Inputs:
- `execution_events` (primary)
- `planned_occurrences` linkage (optional enrich)
- protocol/item dimensions

Output fields:
- `event_id`, `event_type`, `event_at`
- linked occurrence info (`occurrence_date`, `occurrence_time`, `occurrence_id`)
- context (`protocol_name`, `item_name`, `active_protocol_id`)
- `source`, `note`, `supersession_context`

Visibility/lifecycle rules:
- Immutable event stream; never removed by regenerate.
- Superseded planned rows remain visible only through historical linkage, not as current actionable schedule rows.
- Snoozes appear as events; final effective slot appears in schedule views.

## `instance_timeline_view`

Inputs:
- `active_protocols`
- protocol metadata revisions
- `planned_occurrences` revision chain
- `execution_events`

Output fields:
- `timeline_entry_id`, `entry_type` (`instance_started`, `paused`, `resumed`, `completed`, `cancelled`, `archived`, `plan_superseded`, `dose_event`)
- `entry_at`
- `active_protocol_id`, `protocol_id`
- optional payload (`from_status`, `to_status`, `occurrence_key`, `revision`)

Visibility/lifecycle rules:
- Full lifecycle audit for one protocol instance.
- Includes paused/completed/cancelled/archived transitions even when current schedule hides those rows.
- Superseded plan revisions stay visible in timeline for traceability.

## 3. UI visibility rules per screen

1. Today (`/app`, selected date = today)
- Show actionable rows from `today_schedule_view`.
- Skip hidden from primary queue.
- Snoozed shown at effective slot.
- Superseded hidden.

2. Schedule day (`/app`, any selected date)
- Use `current_schedule_view`.
- Past dates include completed/skipped/taken visibility.
- Future uses active-instance filtering by default.

3. Calendar (`/app/progress`)
- Drive rings from `current_schedule_view` aggregates, not raw mutable row status.
- Future dates render as planned-only indicators (no adherence score yet).

4. History (future dedicated surface or Progress subsection)
- Use `history_view` only.
- Never infer historical truth from mutable planned row status alone.

5. Protocol detail (`/app/protocols/[id]`)
- Keep metadata/forms as-is.
- Add timeline panel from `instance_timeline_view` when implemented.

## 4. Where current main is most fragile

1. Business meaning is encoded in UI filters instead of dedicated views:
- `status !== 'skipped'` in schedule page.
- Past/future + active-instance branching inside store selectors.

2. Historical truth depends heavily on mutable `scheduledDoses.status`, while immutable `doseRecords` is not the primary read source.

3. Progress/calendar aggregates scan all raw rows and can mix planned-vs-history semantics.

4. Protocol detail lacks lifecycle timeline and depends on local inferred instance state only.

## 5. Smallest future implementation slice (for Sprint 2B execution)

1. Add a single selector adapter in store: `selectTodayScheduleView(date)` returning normalized row DTOs from existing legacy tables (`scheduledDoses` + `doseRecords` + `activeProtocols`).
2. Switch only `/app` list rendering to consume this adapter while preserving current UI output.
3. Keep all write paths unchanged.
4. Verify parity on:
- skipped hidden behavior
- paused protocol visibility rule
- snoozed ordering and next-dose banner

This yields immediate read-model centralization with minimal blast radius and no schema dependency.
