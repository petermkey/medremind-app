# Lifecycle V1 → V2 Cut-over & Monolith Split — Plan

> Audit item #10. Status as of 2026-06-10. This is a **plan document**, not an
> implementation. Each phase is independently shippable behind a gate.

## 1. Current state (measured, not assumed)

**Dual-write, single-read.** V2 tables are written (dual-write in
`realtimeSync.ts`) but the read model is still entirely V1.

| | V1 | V2 |
|---|---|---|
| Tables | `scheduled_doses`, `dose_records` | `planned_occurrences`, `execution_events` |
| Live rows (2026-06-10) | 9101 doses / 374 records | 8911 occurrences / 376 events |
| Written by | `realtimeSync.ts` | `realtimeSync.ts` (dual-write) |
| **Read by** | cron/notify, store, cloudStore, importStore, medication-knowledge, correlation | **nobody** (types only) |

**Backfill gap:** 9101 V1 doses vs 8911 V2 occurrences → ~190 doses have no
occurrence; 8168/8911 occurrences link back to a V1 dose via
`legacy_scheduled_dose_id` (743 are V2-native: snooze replacements / direct
creates). Tooling already exists: `tool:backfill:planned-future`,
`tool:backfill:execution-history`, `tool:validate:lifecycle-parity`,
`scripts/check-lifecycle-consistency.mjs`.

## 2. Target state

- All readers consume V2 (`planned_occurrences` / `execution_events`).
- `realtimeSync.ts` writes only V2.
- `scheduled_doses` / `dose_records` dropped.
- `store.ts` and `realtimeSync.ts` split into domain modules.

## 3. Risks

| Risk | Mitigation |
|---|---|
| Backfill gap → doses disappear on read cut-over | Phase 1 gate: parity validator must report 0 unreconciled before any reader flips |
| cron/notify reads V1 — a regression stops **all** notifications | Flip cron last, behind a per-route flag, verify against prod with a test dose |
| Snooze lineage differs between models | Parity validator already covers snooze chains (sprint4f); extend if gaps found |
| Big-bang reader flip | Flip one reader at a time; each is its own PR + deploy |
| Monolith split + behavior change at once | Split is **pure move/re-export, no logic change**, done *after* cut-over |

## 4. Cut-over phases (gated)

### Phase 0 — Reconcile backfill (no code)
- Run `tool:backfill:execution-history` + `tool:backfill:planned-future`.
- Run `tool:validate:lifecycle-parity` until **0 unreconciled**.
- Gate: parity clean on prod snapshot. Until then, do not proceed.

### Phase 1 — Read cut-over, one reader per PR
Order chosen by blast radius (low → high):
1. **medication-knowledge** (`refresh/route.ts`) — batch job, easy to verify, no UX.
2. **correlation** (`persistence.ts`) — analytics, non-realtime.
3. **cloudStore / importStore** — backup/restore read paths.
4. **store.ts** read model — the live UX; flip behind a runtime check, watch closely.
5. **cron/notify** — flip **last**. Notifications are the highest-stakes reader
   (a silent regression = no reminders). Verify with a real test dose + the
   Sentry capture added in audit #8.

Each PR: switch the query, keep dual-write intact, ship, verify, then next.

### Phase 2 — Stop V1 writes
- Remove V1 writes from `realtimeSync.ts` (occurrences/events only).
- Keep V1 tables (read-only safety net) for one release.

### Phase 3 — Drop V1
- After one clean release: migration to `DROP TABLE scheduled_doses, dose_records`.
- Remove V1 types from `src/types/index.ts`.

## 5. Monolith split (after cut-over, pure refactor)

Do **not** combine with logic changes. With V1 gone, both files shrink first.

**`store.ts` (1406 lines)** → split by domain, re-exported from a barrel so
imports don't churn in one commit:
- `store/protocols.ts` — templates + items
- `store/activation.ts` — activate/pause/resume/complete/archive
- `store/doses.ts` — take/skip/snooze on occurrences
- `store/sync-state.ts` — outbox status wiring

**`realtimeSync.ts` (1453 lines)** → split by command family:
- `realtimeSync/protocols.ts`, `/activation.ts`, `/doses.ts`, `/snooze.ts`

Method: extract one domain, re-export from the original path, verify `tsc` +
build green, repeat. No call-site changes until the very end.

## 6. Rollback

- Phases 1–2: revert the single reader/writer PR; V1 tables still intact and
  dual-written through Phase 2, so rollback is a deploy, not a data recovery.
- Phase 3 (drop) is the point of no return — only after a full clean release
  and a verified DB backup.

## 7. Sequencing vs other work

Independent of audit #6/#7/#9 (already shipped). Phase 0 can start anytime.
Estimated 5–8 small PRs over a focused sprint; no single PR is risky if the
parity gate in Phase 0 holds.
