# Agent Handover and Onboarding

Date: 2026-03-19
Audience: new engineering/debugging agents

## 1. Read-first order (mandatory)

1. `docs/agent-handoff-current-main.md`
2. `docs/architecture-current-main.md`
3. `docs/auth-and-persistence-current-main.md`
4. `docs/domain-and-schedule-current-main.md`
5. `docs/current-status-and-next-phase.md`
6. `docs/system-logic.md`
7. `docs/current-status.md`
8. `README.md`

Historical incident/persistence/release notes in `docs/` are timeline artifacts, not source-of-truth.

## 2. Quick orientation

If you are touching:

- Auth/bootstrap/routing: start with `src/app/app/layout.tsx`, `src/proxy.ts`, `src/lib/supabase/auth.ts`
- Protocol/schedule/domain logic: start with `src/lib/store/store.ts`
- Sync/import/restore: start with `src/lib/supabase/realtimeSync.ts`, `src/lib/supabase/syncOutbox.ts`, `src/lib/supabase/cloudStore.ts`, `src/lib/supabase/importStore.ts`

## 3. Critical regression checklist

1. `npm run build`
2. `npm run test:e2e` (public smoke always, authenticated smoke when `E2E_EMAIL` and `E2E_PASSWORD` are set)
3. Auth boundary sanity (register/login/onboarding/app entry)
4. Protocol create/activate/update-duration/regenerate sanity
5. Dose action sanity (take/skip/snooze + AddDoseSheet)
6. Refresh + relogin + settings sign-out guard path

## 4. Documentation maintenance rule

When behavior changes, update the relevant current-main docs in the same branch.
Prefer updating current-main source docs over adding ad hoc historical notes.
