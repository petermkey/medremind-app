# CLAUDE.md — medremind-app

> Agent workflow policy: `docs/project-rules-and-current-operating-model.md`. Architecture: `docs/architecture-current-main.md`.

## Stack

- **Next.js 15** (App Router) + **TypeScript** strict mode
- **Supabase** (Postgres + Auth + Realtime) via `@supabase/ssr`
- **Zustand** (`src/lib/store/`) | **Tailwind CSS** | **web-push** (PWA) | **Playwright** (E2E)

## Build & verify

```bash
npm run build       # must pass before any PR
npx tsc --noEmit    # type check
npm run test:e2e    # Playwright E2E
```

## Directory layout

```
src/app/          # Next.js App Router (auth-gated routes, api handlers)
src/lib/store/    # Zustand stores
src/lib/supabase/ # client helpers + realtimeSync
src/components/
supabase/         # migrations
tests/            # Playwright E2E
docs/             # architecture (read before coding)
```

## Rules

- Never `--no-verify` | Never modify `tsconfig.json` | No `any` without comment
- Never push to `main` — use `codex/<sprint-id>-<slice-name>` branches
- Read `docs/project-rules-and-current-operating-model.md` before a new slice
- Run `npx tsc --noEmit` after any `.ts/.tsx` change
- Run `npm run build` before declaring work done
- Conventional commits: `feat|fix|docs|refactor|test|chore: description`

## Supabase

- `createServerClient` in API routes and Server Components
- `createBrowserClient` only in Client Components
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client

## Secrets (never hardcode)

`SUPABASE_SERVICE_ROLE_KEY` · `CRON_SECRET` · `VAPID_PRIVATE_KEY` — all in Vercel env vars
