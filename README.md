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
- Protocols:
  - seed templates
  - custom protocol creation
  - protocol metadata edit
  - protocol item composition edit (add/edit/delete)
- Schedule:
  - per-day schedule view with week strip selector
  - dose actions: take, skip, snooze
  - snooze options: `15 minutes`, `1 hour`, `this evening`, `tomorrow`
- Protocol lifecycle:
  - activate, pause, resume, complete
- Progress view:
  - adherence summary, weekly bars, 30-day heatmap
- Recovery and sync operations in Settings:
  - export snapshot
  - backup current state to cloud
  - restore from cloud
  - import from local snapshot payload
  - flush sync now

## Critical Runtime Rules (Current)

- Local updates are optimistic.
- Failed cloud writes are queued in local outbox and retried with backoff.
- `/app` boot pulls account state from Supabase.
- Protocol pause visibility rule:
  - paused protocols do not contribute active doses to today/future schedule surfaces.
  - pause does not delete or hide historical (past-date) dose history.
- Skip visibility rule:
  - skipped dose is removed from active queue for that day.
- Snooze rule:
  - snooze reschedules dose date/time (not only status).

## Project Structure

- `src/app` - routes/pages
- `src/components` - UI and app components
- `src/lib/store/store.ts` - Zustand state + domain logic
- `src/lib/supabase/realtimeSync.ts` - cloud write operations
- `src/lib/supabase/syncOutbox.ts` - retry outbox + sync status
- `src/lib/supabase/cloudStore.ts` - cloud pull + snapshot export/backup
- `src/lib/supabase/importStore.ts` - snapshot import to cloud
- `supabase/001_initial.sql` - schema + policies
- `docs/system-logic.md` - source of truth for current logic
- `docs/current-status.md` - current maturity, risks, next priorities
- `docs/agent-handover.md` - onboarding and test focus for new agents

## Quick Start

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

Required for Supabase integration:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
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

## Documentation Notes

Several incident verification files in `docs/` are historical point-in-time reports.
For current behavior and logic, use:

1. `docs/system-logic.md`
2. `docs/current-status.md`
3. `docs/agent-handover.md`

## Medical Disclaimer

This app is not a medical device and does not provide medical advice, diagnosis, or treatment. Always consult a qualified healthcare provider.
