# Dose Persistence Restart Investigation

Date: 2026-04-25
Branch: codex/e7-dose-persistence-restart-debug
Scope: dose action persistence after the sync pill shows synced and the app restarts.

## Symptom

After marking medication doses as taken, the UI can show a green synced state. After restarting the app, some taken state disappears.

## Root Cause

Two issues combined:

1. Dose action writes were not durable before the direct sync promise completed. `syncFireAndForget` only enqueued the fallback outbox operation after a direct sync failure. If the app was closed or restarted while the direct sync was still in flight, the optimistic local `doseRecords` update could be lost because `scheduledDoses` and `doseRecords` are intentionally not persisted in Zustand localStorage.

2. The command recovery path only upserted `scheduled_doses` by `id`. When the local dose id differed from an existing cloud row for the same unique slot, Supabase rejected the write with `scheduled_doses_active_protocol_id_protocol_item_id_schedul_key`. The correct behavior is to resolve the existing cloud row by slot and attach the `dose_records` row to that existing scheduled dose.

## Evidence

Read-only Supabase checks for the affected user found recent `take_command` failures on 2026-04-25 with:

- `Ensure scheduled dose sync failed: duplicate key value violates unique constraint "scheduled_doses_active_protocol_id_protocol_item_id_schedul_key"`

The same account also had successful `dose_records` and `execution_events` for other dose clicks, proving that the failure is slot-specific rather than a global auth or RLS outage.

## Fix

- `src/lib/store/store.ts`: persist a fallback outbox operation before direct sync completion, keep the sync pill non-green while the durable fallback exists, remove it on direct success, and force outbox retry on direct failure.
- `src/lib/supabase/syncOutbox.ts`: support enqueue-without-immediate-pump and queued-operation removal.
- `src/lib/supabase/realtimeSync.ts`: make `ensureCommandDoseRow` return the resolved cloud scheduled dose id; on slot conflict, lookup the existing row by slot and use it for take/skip/snooze records and execution events.

## Verification

- `npm run build` passed.
- `npm run test:e2e -- tests/e2e/smoke.spec.ts --grep "public smoke"` passed after installing Playwright Chromium.
- D2 execution-history dry-run: no rows to insert; known duplicate legacy execution-event anomalies remain.
- D3 planned-future dry-run: rows to insert remain; terminal future-row anomalies remain unrelated to this fix.
- C5 parity dry-run: no missing parity; known legacy anomalies remain.
- D4 consistency dry-run: known lifecycle anomalies remain; not introduced by this fix.

## Status

DONE_WITH_CONCERNS: root cause fixed in code and verified by build/public smoke/read-only DB checks. Full authenticated browser persistence replay was not run because no dedicated E2E credentials were provided and creating real test accounts would mutate Supabase production-like data.
