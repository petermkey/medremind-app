# MedRemind App

MedRemind is a Next.js application for protocol scheduling, dose adherence tracking, and account-bound cloud persistence with Supabase.

## Tech Stack

- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS v4
- Zustand (client state + persistence)
- Supabase (Auth + Postgres)

## Current Functional Scope

- Authentication: register, login, onboarding
  - confirmation-aware signup flow (no forced onboarding when email confirmation is pending)
  - resend confirmation actions with cooldown in confirmation-required states
- Protocols:
  - seed templates
  - custom protocol creation
  - protocol metadata edit
  - protocol item composition edit (add/edit/delete)
  - lifecycle transitions: activate, pause, resume, complete, archive-aware delete
  - 16 dose-form icons (tablet, capsule, softgel, injection, cream, drops, powder, liquid, patch, inhaler, spray, eye_drops, nasal_spray, suppository, lozenge, other) auto-assigned from `DoseForm`
  - 9 route-of-administration icons (oral, subcutaneous, intramuscular, topical, sublingual, inhalation, nasal, iv, other) shown in Form/Route selects
- Schedule:
  - per-day schedule view with week strip selector
  - dose actions: take, skip, snooze
  - snooze options: `1 hour`, `this evening`, `tomorrow`, `next week`
- Progress view:
  - adherence summary, weekly bars, 30-day heatmap
- Settings:
  - export snapshot
  - backup current state to cloud
  - restore from cloud
  - import from local snapshot payload
  - flush sync now

## Critical Runtime Rules (Current)

- Local updates are optimistic and synced asynchronously.
- Failed cloud writes are queued in local outbox and retried with backoff.
- Sign-out path is guarded against in-flight/outbox data loss.
- Fixed-duration protocols use inclusive end-date boundaries.
- Snooze marks original row as `snoozed` and creates replacement `pending` row.
- Additive write-through is active:
  - command paths write execution facts into `execution_events`
  - activation writes planned future rows into `planned_occurrences`

## Project Structure

- `src/app` - routes/pages
- `src/components` - UI and app components
- `src/lib/store/store.ts` - Zustand state + domain logic
- `src/lib/supabase/realtimeSync.ts` - cloud write operations and command paths
- `src/lib/supabase/syncOutbox.ts` - retry outbox + sync status
- `src/lib/supabase/cloudStore.ts` - cloud pull + snapshot export/backup
- `src/lib/supabase/importStore.ts` - snapshot import to cloud
- `scripts/backfill-execution-history.mjs` - D2 backfill tooling
- `scripts/backfill-planned-future-occurrences.mjs` - D3 backfill tooling
- `scripts/validate-lifecycle-parity.mjs` - C5 parity tooling
- `scripts/check-lifecycle-consistency.mjs` - D4 consistency checker

## Quick Start

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

Runtime:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Operational tooling (D2/D3/C5/D4):

- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional:

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_EMAIL`
- `RESEND_API_KEY`
- `NEXT_PUBLIC_APP_URL`

## Available Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run tool:backfill:execution-history`
- `npm run tool:backfill:planned-future`
- `npm run tool:validate:lifecycle-parity`
- `node scripts/check-lifecycle-consistency.mjs`
- `npm run test:e2e`
- `npm run test:e2e:headed`
- `npm run test:e2e:install`

## Branch and Governance Rules

Authoritative process rules are documented in:

- `docs/project-rules-and-current-operating-model.md`

Key rules:

- `main` is source of truth.
- New implementation branches must use `codex/<sprint-id>-<slice-name>`.
- One slice per branch; no mixed-concern branches.
- Use `main` directly only for merge/cleanup/operational runs unless explicitly instructed.

## Documentation Notes

For current behavior/process truth, start with:

1. `docs/project-rules-and-current-operating-model.md`
2. `docs/system-logic.md`
3. `docs/current-status.md`
4. `docs/agent-handoff-current-main.md`

Historical incident/release/design docs in `docs/` are timeline artifacts.

## Medical Disclaimer

This app is not a medical device and does not provide medical advice, diagnosis, or treatment. Always consult a qualified healthcare provider.
