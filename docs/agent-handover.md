# Agent Handover and Onboarding

Date: 2026-03-18
Audience: new engineering/debugging agents

## 1. Read-first order

1. `docs/system-logic.md`
2. `docs/current-status.md`
3. `README.md`
4. Relevant historical report in `docs/` only if investigating a specific incident timeline

## 2. Main code locations

- Core state and domain logic: `src/lib/store/store.ts`
- Cloud write operations: `src/lib/supabase/realtimeSync.ts`
- Outbox/retry and sync status: `src/lib/supabase/syncOutbox.ts`
- Cloud pull/backup/export: `src/lib/supabase/cloudStore.ts`
- Snapshot import to cloud: `src/lib/supabase/importStore.ts`
- App bootstrap/auth boundary: `src/app/app/layout.tsx`
- Settings recovery and sign-out controls: `src/app/app/settings/page.tsx`
- Schedule and week-strip logic: `src/app/app/page.tsx`
- Protocol list/detail editing: `src/app/app/protocols/page.tsx`, `src/app/app/protocols/[id]/page.tsx`

## 3. Business logic hotspots

- Protocol lifecycle and dose generation are in `store.ts`.
- Visibility behavior for paused protocols is enforced by schedule selectors in `store.ts`.
- Snooze/skip behavior is split between UI (`/app/page.tsx`) and store action reducers (`store.ts`).
- Sync failures are expected to be eventually retried by outbox, not immediately fatal.

## 4. Fragile areas to treat carefully

- Auth boundary and local persisted state ownership.
- Regeneration behavior when dose history exists (`dose_records` FK constraints).
- Outbox payload growth and repeated replay operations.
- Import/restore semantics when overlapping data already exists.

## 5. Minimum regression checks after touching logic

1. `npm run build`
2. Login, create/edit protocol and items, activate protocol.
3. Dose actions: take, skip, snooze (all snooze options).
4. Pause protocol and verify:
   - today/future schedule hidden
   - past history still visible
5. Refresh and relogin same account.
6. Settings:
   - flush sync now
   - sign out with pending ops warning path
   - restore from cloud

## 6. Documentation maintenance rule

When behavior changes, update these files in the same PR/commit:

- `docs/system-logic.md`
- `docs/current-status.md`
- `README.md` (if user-visible behavior changes)
