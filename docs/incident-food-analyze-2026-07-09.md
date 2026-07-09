# Incident: Food Photo Analysis Broken in Production (2026-07-09)

**Reported:** owner attempted to analyze a food photo on 2026-07-09 — generic failure message, no diagnosis visible.
**Status:** root cause identified and **reproduced live**; fix plan below (not yet executed).
**Related:** `docs/system-audit-2026-07-09.md` §4.4 flagged the *mechanisms* that made this failure silent (reason codes discarded by client, thin fallback chain) but did not catch the live breakage itself — see §4 "Why the audit missed it".

---

## 1. Diagnosis (confirmed by live reproduction)

Reproduced against production (`/api/food/analyze-photo`, E2E account, test image):

```
STATUS: 502
BODY: {"error":"Food analysis failed.","reason":"food_provider_openrouter_404"}
```

**Root cause chain:**
1. Production pins `OPENROUTER_FOOD_VISION_MODEL` + `OPENROUTER_FOOD_VISION_FALLBACK_MODEL` in Vercel env vars (created ~May 18, marked *Sensitive* → values are write-only, not readable via `vercel env pull`).
2. Both pinned models have since been **removed from OpenRouter** (the May free/preview model cohort is gone — every candidate from that era now 404s). The fallback logic itself is correct — 404 *is* fallback-eligible ([openRouterModels.ts:3](../src/lib/food/analyze/openRouterModels.ts)) — but when **every** model in the chain is dead, the last 404 becomes the final error.
3. The code default `google/gemini-2.5-flash` is **alive and would work** — but the env pin overrides it and the default is never appended as a last resort.
4. The client discards the server's `reason` code and shows one generic message ([food/page.tsx:395-403](../src/app/app/food/page.tsx)) — so the owner saw "Unable to analyze this meal photo" with zero diagnostic value.
5. The API key is valid (a dead key would produce 401, not 404). No storage/DB side effects: analysis fails before upload, so Supabase logs show nothing for failed attempts — the only server-side trace is on Vercel (ephemeral) and in Sentry.

**Repro details:** signed in as the E2E account, crafted the `sb-<ref>-auth-token` cookie, POSTed a 64×64 test PNG to the production endpoint. Same result path as the owner's real attempt.

## 2. Full error sweep (all sources, this period)

| Source | Window | Result |
|---|---|---|
| Supabase edge logs | 20h (≈ retention) | 7,098 requests, **3 errors** — all `409 Conflict` on `execution_events` / `planned_occurrences` from the owner's iPhone ≈ 09:47 UTC: the known benign at-least-once retry path (same signature as June audit §2.2) |
| Supabase postgres logs | 20h | 0 ERROR / 0 FATAL |
| Supabase auth logs | 20h | 0 errors |
| Storage (`food-photos`) | 20h | **0 requests** — confirms failed analyses never reach storage |
| Vercel runtime logs | live stream only | cron ticking normally; historical logs of the failed attempt outside retention |
| Sentry | — | inaccessible from this environment (`SENTRY_AUTH_TOKEN` is a write-only sensitive env var); the 502s were captured there by `Sentry.captureException` |

So the **only real production error in this period is the food-analysis breakage** (plus the long-running phantom-push P0 from the system audit, independently confirmed today: the owner's iPhone was active at 09:47 UTC and receives no pushes — 0 subscriptions).

## 3. Fix plan

### F1 — restore service (operational, ~10 min, needs owner: env change + redeploy)
1. Set in Vercel (production):
   - `OPENROUTER_FOOD_VISION_MODEL` = `google/gemini-2.5-flash` (alive, proven with this schema, matches code default)
   - `OPENROUTER_FOOD_VISION_FALLBACK_MODEL` = `google/gemini-3.5-flash` (alive, current stable flash tier)
2. Redeploy (env changes need a new deployment).
3. Verify with the same live repro (expect `200` + draft payload).

### F2 — make it impossible to brick this way again (code, S)
1. **Terminal fallback:** `getOpenRouterFoodVisionModels()` appends `DEFAULT_OPENROUTER_FOOD_VISION_MODEL` to the chain when not already present — a dead env pin can then never take the pipeline below the code default. Unit test: chain with dead-pin env includes default last.
2. **Surface reason codes in the client:** map `food_provider_*` codes to actionable messages (429/5xx → "service busy, try again"; 404 → "recognition model unavailable"; 413 → "photo too large"; timeout → "took too long — try describing the meal in text"). One small map in `food/page.tsx`, reads `payload.reason` that the API already returns.
3. **Fix stale README:** `README.md:124-125` documents a `google/gemma-4-31b-it:free` default that doesn't match the code (`google/gemini-2.5-flash`) — update to reality.

### F3 — detect silently-dead config before the user does (S–M)
Add a config healthcheck to the (already planned) cron surface: a daily job (or a branch of `/api/cron/oura-sync` once it lands) calls OpenRouter `GET /models` (free, no LLM cost) and verifies every configured vision model still exists; on failure → Sentry + result summary. Pattern note: this is the food-pipeline twin of the audit's cron-heartbeat recommendation (§2.5) — both watch for "infrastructure silently rotted".

### F4 — silence the benign 409 noise (P3, carried from June audit §6.2)
Replace insert-then-catch with `upsert(..., { onConflict: 'idempotency_key', ignoreDuplicates: true })` in the take/skip retry path. Cosmetic; unchanged priority.

**Suggested order:** F1 now (restores the feature today) → F2 as one small PR (`codex/food-model-chain-hardening`) → F3 rides the Oura cron work → F4 whenever convenient.

## 4. Why the audit missed it

The 2026-07-09 system audit tested the food pipeline **statically and with the mock provider** (as the E2E suite does) — it verified code paths, error mapping, and storage policies, but never issued a **real OpenRouter call with the production model config**, and Sentry (where the 502s were visible) is not reachable from the audit environment. The audit did flag the *enabling* defects (§4.4: thin fallback chain, discarded reason codes) but scored the pipeline "technically healthy, unused". **Lesson recorded:** pipeline health claims require one live production probe per external dependency (the F3 healthcheck automates exactly this).
