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
  - Google OAuth sign-in (`/login`, `/register`, callback `/auth/callback`)
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
  - adherence summary, weekly bars, heatmap with 30/60/90-day toggle
- Food diary:
  - authenticated `/app/food` nutrition target setup before first diary use
  - editable daily targets for calories, macros, fiber, and water
  - date-aware diary with daily target progress, photo upload, AI-assisted food analysis drafts, and Supabase-backed saved entries
  - collapsible saved food entries with component details and confirmed delete
  - hydration quick-add buttons with daily water progress
- Settings:
  - export snapshot
  - backup current state to cloud
  - restore from cloud
  - import from local snapshot payload
  - flush sync now
- Oura integration backend:
  - OAuth connect, callback, status, daily sync, and disconnect routes
  - encrypted server-side token storage
  - daily sleep/readiness/activity/SpO2/stress fetch endpoint
- Health and medication insights:
  - external health snapshot boundary for Oura now and Apple Health later
  - medication knowledge safety/rules/features layer
  - consent-gated correlation patterns surfaced in `/app/progress`
  - Oura connection and health sync controls surfaced in `/app/settings`
  - user consent required before generating or showing correlation insight cards

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
- `supabase/005_food_intake.sql` - food diary tables
- `supabase/006_nutrition_targets_and_hydration.sql` - nutrition target profile and water entry tables
- `supabase/007_oura_integrations.sql` - encrypted server-side Oura integration records
- `supabase/008_external_health_snapshots.sql` - source-compatible external health snapshots
- `supabase/009_medication_knowledge.sql` - medication knowledge records
- `supabase/010_correlation_insights.sql` - aggregate medication/health correlation insights

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

Food photo analysis (server-side):

- `FOOD_AI_PROVIDER`: unset or `mock` for mock mode; `openai`; `openrouter`; `gemini`
- `OPENAI_API_KEY` and optional `OPENAI_FOOD_VISION_MODEL` for `FOOD_AI_PROVIDER=openai`
- `OPENROUTER_API_KEY` for `FOOD_AI_PROVIDER=openrouter`
- `OPENROUTER_FOOD_VISION_MODEL` for `FOOD_AI_PROVIDER=openrouter`; defaults to `google/gemma-4-31b-it:free`
- `OPENROUTER_FOOD_VISION_FALLBACK_MODEL` for `FOOD_AI_PROVIDER=openrouter`; unset by default so food recognition fails closed instead of silently switching away from Gemma
- `GEMINI_API_KEY` and optional `GEMINI_FOOD_VISION_MODEL` for `FOOD_AI_PROVIDER=gemini`
- `NEXT_PUBLIC_APP_URL` is also used as the OpenRouter `HTTP-Referer`; it remains the optional app URL above.

Oura integration (server-side):

- `OURA_CLIENT_ID`
- `OURA_CLIENT_SECRET`
- `OURA_REDIRECT_URI`
- `OURA_TOKEN_ENCRYPTION_KEY`
- `OURA_SCOPES` supports Oura OAuth scopes: `email personal daily heartrate tag workout session spo2`.

Apply `supabase/007_oura_integrations.sql` before using the OAuth callback route. The `user_integrations` table is intentionally server-only: browser clients should call the Oura API routes rather than reading token rows directly.

Medication Knowledge and correlation insights (server-side):

- `OPENROUTER_API_KEY`
- `OPENROUTER_API_BASE_URL`
- `OPENROUTER_HTTP_REFERER`
- `OPENROUTER_APP_TITLE`
- `MED_KNOWLEDGE_FAST_MODEL`
- `MED_KNOWLEDGE_REASONING_MODEL`
- `MED_KNOWLEDGE_SECOND_OPINION_MODEL`
- `MED_KNOWLEDGE_NANO_MODEL`
- `MED_KNOWLEDGE_LONG_CONTEXT_MODEL`
- `MED_KNOWLEDGE_AUTO_FALLBACK_MODEL`

OpenRouter configuration is used only behind server routes. The medication knowledge safety layer must not emit direct medication-change instructions.

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
- `npm run test:med-knowledge`
- `npm run test:correlation`

Authenticated E2E specs, including `tests/e2e/food.spec.ts`, require `E2E_EMAIL`, `E2E_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## CI/CD and Runtime Pipelines

- GitHub Actions: `.github/workflows/vercel.yml`
  - triggers on `push` to `main` and on `pull_request` targeting `main`
  - uses Node 20
  - deploys to Vercel via `vercel deploy` (production on `main`)
- Build mode: `next build --webpack` (set in `package.json`)
- Scheduler pipeline:
  - `vercel.json` keeps `"crons": []` (Vercel cron disabled on Hobby constraints)
  - external cron-job.org job calls `GET /api/cron/notify` every minute with `Authorization: Bearer <CRON_SECRET>`

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
