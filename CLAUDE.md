# CLAUDE.md — medremind-app

> Agent workflow policy: `docs/project-rules-and-current-operating-model.md`. Architecture: `docs/architecture-current-main.md`. Backlog: `docs/project-backlog.md`.

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

## Parallel agents & deploys

- One agent = one branch = non-overlapping files; before starting: `bash scripts/git-state-check.sh`.
- **Merging a PR to `main` triggers a Vercel production deploy** — merge only on an explicit owner ask (global deploy hook also applies).
- Supabase auth: use the `supabase` CLI / documented env vars — never scan the keychain.

## Supabase

- `createServerClient` in API routes and Server Components
- `createBrowserClient` only in Client Components
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client

## Secrets (never hardcode)

`SUPABASE_SERVICE_ROLE_KEY` · `CRON_SECRET` · `VAPID_PRIVATE_KEY` — all in Vercel env vars

## Known landmines

- OpenRouter account privacy settings (`openrouter.ai/settings/privacy`) block some models account-wide with a 404 that looks like "model not found" but isn't — message is `"...guardrail restrictions and data policy"`. Before repinning `OPENROUTER_FOOD_VISION_MODEL`, verify with a live completion call, not just `GET /models` — see `docs/agent-handoff-current-main.md` §0.
- `supabase/008_oura_analytics.sql` exists in the repo but has never been applied to production — see `docs/agent-handoff-current-main.md` §0b before touching Oura sync.
