# Agent Handoff (Current Main)

Date: 2026-03-19
Audience: engineering agents continuing development from current `main`

## 1. Read-first order for new agents

1. `docs/system-logic.md`
2. `docs/current-status.md`
3. `docs/agent-handover.md`
4. `docs/architecture-current-main.md`
5. `docs/auth-and-persistence-current-main.md`
6. `docs/domain-and-schedule-current-main.md`
7. `docs/current-status-and-next-phase.md`
8. `README.md`

Historical incident/release docs in `docs/` are useful context, but not source-of-truth.

## 2. Product purpose and primary user journey

MedRemind is a protocol-driven medication/adherence tracker.

Typical journey:

1. Register/login.
2. Complete onboarding profile.
3. Create or choose protocol.
4. Activate protocol.
5. Track doses on schedule screen with take/skip/snooze actions.
6. Monitor adherence/progress.
7. Manage sync and account actions in settings.

## 3. Most important code surfaces

- Core state/domain: `src/lib/store/store.ts`
- Auth wrappers: `src/lib/supabase/auth.ts`
- App boot/auth gate: `src/app/app/layout.tsx`
- Proxy routing guard: `src/proxy.ts`
- Cloud pull/import/backup: `src/lib/supabase/cloudStore.ts`, `src/lib/supabase/importStore.ts`
- Realtime sync + outbox: `src/lib/supabase/realtimeSync.ts`, `src/lib/supabase/syncOutbox.ts`
- Protocol creation: `src/app/app/protocols/new/page.tsx`
- Protocol list/detail editing: `src/app/app/protocols/page.tsx`, `src/app/app/protocols/[id]/page.tsx`
- Schedule/today actions: `src/app/app/page.tsx`, `src/components/app/MedCard.tsx`, `src/components/app/AddDoseSheet.tsx`

## 4. Stable behaviors already landed (do not regress)

Auth:

- register is confirmation-aware (no false onboarding when no session)
- confirmation resend action exists on register/login
- resend cooldown is enforced
- onboarding and settings profile saves are non-blocking
- app layout boot hardening avoids indefinite spinner lock

Protocol/schedule:

- protocol creation/finalization uses hardened ID generation paths
- fixed-duration input validation at creation
- inclusive end date on activation for fixed-duration protocols
- duration change triggers immediate active-dose reconciliation
- regenerate uses live protocol snapshot
- AddDoseSheet resolves active instance from fresh store after activation

Persistence/sync:

- deterministic import ID mapping for active protocols/scheduled doses/dose records
- sign-out is guarded by in-flight + outbox checks with user confirmations

UI/a11y:

- swipe targeting stabilized
- secondary action labels added
- schedule action labels/explicit button semantics added

## 5. Known high-risk areas

- `store.ts` has dense domain + sync coupling.
- Auth policy is split between proxy and client layout behavior.
- Import/restore and regeneration paths can create subtle duplicates if ID/slot semantics are changed.
- Outbox replay behavior can surface edge cases under unstable network.

## 6. Safe working model for future slices

- Always branch from current `main`.
- One concern per branch.
- One isolated commit per validated slice when possible.
- Avoid broad refactors in high-risk files.
- Validate focused behavior + `npm run build` before merge.

## 7. Minimum regression checklist before merge

1. `npm run build`
2. Auth flow sanity:
- register confirmation-required branch
- login with unconfirmed branch + resend
- login success path + onboarding/app routing
3. Protocol flow sanity:
- create protocol (fixed + ongoing)
- activate protocol
- duration update (shorten/extend) on active protocol
4. Schedule actions:
- take / skip / snooze
- AddDoseSheet add-to-active path
5. Persistence sanity:
- refresh + relogin
- settings sign-out path with sync guards

## 8. Deferred larger tracks (start fresh from main)

- Auth and email confirmation redesign
- Domain and schedule engine redesign
- UI and PWA pack audit

These should continue only via new scoped branches from `main`, not by mining retired mixed branches.
