# MedRemind App

MedRemind is a Next.js application for protocol/medication scheduling, adherence tracking, and cloud persistence with Supabase.

## Tech Stack

- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS v4
- Zustand (client state + persistence)
- Supabase SQL schema (migration file in `supabase/001_initial.sql`)

## Features

- Register, login, onboarding flow
- Protocol templates and custom protocols
- Dose scheduling (daily/weekly/every N days)
- Dose actions: take, skip, snooze
- Real-time optimistic sync to Supabase
- Retry outbox for failed cloud writes
- Data recovery actions: export/backup/restore/import (settings)
- Swipe/drag actions in protocols:
  - protocol: edit/delete
  - protocol item (medication/analysis/therapy): edit/delete
- Progress view (7-day bars, 30-day heatmap, streak)
- User settings and notification preferences

## Project Structure

- `src/app` - app routes and pages
- `src/components` - UI and app components
- `src/lib/store/store.ts` - Zustand store and business logic
- `src/lib/supabase/realtimeSync.ts` - cloud CRUD sync operations
- `src/lib/supabase/syncOutbox.ts` - local outbox + retry/backoff replay
- `src/lib/supabase/cloudStore.ts` - pull/backup/export flows
- `src/lib/supabase/importStore.ts` - import snapshot into Supabase
- `src/lib/data/seed.ts` - starter templates and drug seed data
- `supabase/001_initial.sql` - initial database schema and RLS policies
- `.github/workflows/vercel.yml` - CI/CD deploy workflow to Vercel
- `docs/persistence-verification-2026-03-18.md` - verification/hardening report
- `docs/system-logic.md` - current persistence and CRUD logic

## Prerequisites

- Node.js 20+
- npm 10+

## Quick Start

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

Use `.env.local.example` as the source of truth.

Required for production backend integration:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional:

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_EMAIL`
- `RESEND_API_KEY`
- `NEXT_PUBLIC_APP_URL`

## Database Setup (Supabase)

1. Create a Supabase project.
2. Open SQL Editor in Supabase.
3. Run `supabase/001_initial.sql`.
4. Set Supabase env vars in `.env.local`.

The schema includes:

- Profiles and notification settings
- Protocols and protocol items
- Active protocols and scheduled doses
- Dose records and push subscriptions
- RLS policies and signup trigger (`handle_new_user`)

## Available Scripts

- `npm run dev` - start development server
- `npm run build` - production build
- `npm run start` - run production server

## Deployment

GitHub Actions workflow (`.github/workflows/vercel.yml`) deploys to Vercel on:

- Push to `main`
- Pull requests targeting `main`

Required GitHub secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

## Data and State Notes

- App state is persisted in browser storage under key `medremind-store`.
- Sync outbox is persisted in browser storage under key `medremind-sync-outbox-v1`.
- Writes are optimistic locally; failed cloud writes are retried from outbox.
- `/app` layout performs authenticated cloud pull from Supabase on entry.
- “Delete account” in UI clears local app state (`localStorage.clear()` in settings page).
- Seed templates are merged back into state on rehydration.

## Protocol Editing UX

- In `/app/protocols` swipe left (mobile) or drag left (desktop) on protocol card:
  - `Edit` updates name/description/category.
  - `Delete` removes protocol and related active/scheduled/record data.
- In `/app/protocols/[id]` swipe left/drag left on protocol item:
  - `Edit` updates item fields (name/dose/frequency/time).
  - `Delete` removes item from protocol.
- For active protocols, item edit/delete triggers dose regeneration.

## Validation Checklist

1. Start app with `npm run dev`.
2. Register a user and complete onboarding.
3. Activate a protocol and verify doses appear on schedule.
4. Mark doses as taken/skipped/snoozed.
5. Confirm progress charts update.
6. Open settings and save profile/notification preferences.

## Medical Disclaimer

This app is not a medical device and does not provide medical advice, diagnosis, or treatment. Always consult a qualified healthcare provider.
