# Dose Persistence Handoff: Restart-Survival Investigation

Date: 2026-04-25
Audience: next agent continuing the dose intake persistence investigation
Status: current production write path verified; client restart/read-path verification still needs live authenticated browser confirmation

## 1. Executive summary

The reported symptom is: after marking medication doses as taken and seeing the green sync checkmark, restarting the app makes intake information appear unsaved.

Two fixes are now landed on `main` and deployed to production:

| Commit | Purpose |
|--------|---------|
| `016d7e0` | Make dose actions durable across restart windows by queueing fallback outbox operations before direct sync completes and resolving scheduled-dose unique-slot conflicts. |
| `e0123ff` | Scrub stale volatile dose state from Zustand hydration so old localStorage payloads cannot resurrect stale `scheduledDoses`, `doseRecords`, or `executionEvents` on boot. |
| `6e47068` | Merge commit currently deployed to production at `https://medremind-app-two.vercel.app`. |

Production `/api/version` was verified after deploy and returned:

```json
{
  "sha": "6e47068d926abf0a37141c9df55a37072d8e7cd2",
  "environment": "production"
}
```

## 2. Current source-of-truth files

Read these before changing lifecycle, persistence, or sync code:

| File | Why it matters |
|------|----------------|
| `docs/project-rules-and-current-operating-model.md` | Branching, source-of-truth, and operational run rules. |
| `docs/agent-handoff-current-main.md` | Current-main handoff and read-first map. |
| `docs/lifecycle-contract-v1.md` | Authoritative lifecycle and dose behavior contract. |
| `docs/auth-and-persistence-current-main.md` | Auth, local persistence, outbox, and cloud persistence model. |
| `docs/current-status.md` | Runtime status and remaining risks. |
| `src/lib/store/store.ts` | Client store, selectors, dose actions, and persistence partialize/merge. |
| `src/lib/supabase/realtimeSync.ts` | Direct Supabase command write paths. |
| `src/lib/supabase/syncOutbox.ts` | Durable local outbox retry path. |
| `src/lib/supabase/cloudStore.ts` | Boot-time Supabase pull/import into the client store. |
| `src/app/app/layout.tsx` | Authenticated app boot, cloud pull retry, sync outbox start. |
| `src/app/app/page.tsx` | Schedule UI selectors and dose card rendering. |

## 3. Confirmed production facts for `peter@alionuk.com`

The Supabase auth user is:

```text
f9b36ee9-823a-4ec1-9648-e5a3e793e207
```

Observed production facts on 2026-04-25 after the first persistence fix deployed:

| Check | Result |
|-------|--------|
| Duplicate auth users for `peter@alionuk.com` | None found. |
| Profile | Exists, `onboarded = true`, timezone `Europe/London`. |
| Scheduled doses on `2026-04-25` | 38 total. |
| Scheduled dose statuses on `2026-04-25` | 34 `pending`, 4 `taken`. |
| Dose records on `2026-04-25` | 12 `taken` records. |
| Sync operations since `2026-04-25T13:14:00Z` | 8 `succeeded`, 0 `failed`. |
| Latest production sync failures | Only older failures before fix; duplicate-slot failures stopped after deploy. |

The four scheduled dose rows confirmed as `taken` on `2026-04-25` were:

| Scheduled dose id | Time | Status | Notes |
|-------------------|------|--------|-------|
| `d9ea25a7-de1b-48e4-8306-74bfbe3711a3` | `01:00` | `taken` | melatonine row. |
| `5ea7b4f2-1135-42e3-b3db-9c7462780e6a` | `01:00` | `taken` | Creamer row. |
| `88604734-2ec2-4b3a-bd56-d320483b781a` | `12:00` | `taken` | Finasterid row. |
| `f1078efa-8cab-47e8-8beb-9d7f7451e0f8` | `12:00` | `taken` | Minoxidil row. |

This means the current production write path persisted the observed intake actions to Supabase. If the app still appears to lose intake information after restart, continue from the client read/boot/UI path, not from the assumption that Supabase writes are universally failing.

## 4. Root causes already fixed

### 4.1 Direct sync restart race

Before `016d7e0`, `syncFireAndForget` only enqueued the fallback outbox operation after direct sync failure. If the app was closed while direct sync was still in flight, optimistic local state could disappear on restart and no durable queued operation existed.

Current behavior:

- fallback outbox operation is queued before direct sync settles;
- direct sync success removes the queued fallback;
- direct sync failure leaves or re-enqueues the operation and forces the outbox pump.

Key files:

- `src/lib/store/store.ts`
- `src/lib/supabase/syncOutbox.ts`

### 4.2 Scheduled dose unique-slot conflict

Before `016d7e0`, `ensureCommandDoseRow()` tried to upsert by `id`. If the client had a local dose id but Supabase already had the same unique dose slot under a different id, command sync failed with:

```text
Ensure scheduled dose sync failed: duplicate key value violates unique constraint "scheduled_doses_active_protocol_id_protocol_item_id_schedul_key"
```

Current behavior:

- command sync resolves the canonical cloud scheduled dose row by the unique slot;
- take/skip/snooze writes use the resolved cloud scheduled dose id for `scheduled_doses`, `dose_records`, and `execution_events`.

Key file:

- `src/lib/supabase/realtimeSync.ts`

### 4.3 Stale localStorage hydrate resurrecting old dose state

Before `e0123ff`, `partialize` excluded `scheduledDoses` and `doseRecords`, but the persist `merge` still spread `...p`. Devices with older localStorage payloads could hydrate stale volatile slices before or during cloud boot.

Current behavior:

- persist `merge` whitelists only `profile`, `notificationSettings`, `activeProtocols`, and custom `protocols`;
- stale localStorage copies of `scheduledDoses`, `doseRecords`, and `executionEvents` are ignored;
- `resetUserData` and `signOut` also clear `executionEvents`.

Key file:

- `src/lib/store/store.ts`

## 5. Current client persistence model

Local Zustand persistence stores only:

- `profile`
- `notificationSettings`
- `activeProtocols`
- custom `protocols`

Local Zustand persistence intentionally does not store these volatile/cloud-owned slices:

- `scheduledDoses`
- `doseRecords`
- `executionEvents`
- `drugs` beyond the seed merge path

Schedule and history state after app boot must come from `pullStoreFromSupabase()` in `src/lib/supabase/cloudStore.ts`, called by `src/app/app/layout.tsx` after auth boot.

## 6. What remains to verify

The remaining unknown is an authenticated browser/UI verification after `6e47068` is loaded.

Verify the user's actual app instance, not a fresh anonymous DevTools tab:

1. Confirm URL is `https://medremind-app-two.vercel.app` or another alias serving `6e47068`.
2. Run `/api/version`; expected SHA is `6e47068d926abf0a37141c9df55a37072d8e7cd2` or newer.
3. Confirm the authenticated user id in Supabase client session is `f9b36ee9-823a-4ec1-9648-e5a3e793e207`.
4. Inspect `window.__medremindStore.getState()` after the app spinner clears.
5. Confirm `scheduledDoses` includes the four `taken` rows above for `2026-04-25`.
6. Confirm `selectActionableOccurrences('2026-04-25')` includes the taken rows if they belong to active protocols.
7. Confirm the visible UI cards show `Taken` and the progress count includes them.

Useful browser-console probes in an authenticated session:

```js
await fetch('/api/version', { cache: 'no-store' }).then(r => r.json())
```

```js
const s = window.__medremindStore.getState();
({
  profile: s.profile,
  scheduledToday: s.scheduledDoses
    .filter(d => d.scheduledDate === '2026-04-25')
    .map(d => ({ id: d.id, name: d.protocolItem?.name, time: d.scheduledTime, status: d.status, activeProtocolId: d.activeProtocolId })),
  recordsToday: s.doseRecords
    .filter(r => r.recordedAt >= '2026-04-25T00:00:00Z')
    .map(r => ({ id: r.id, scheduledDoseId: r.scheduledDoseId, action: r.action, recordedAt: r.recordedAt })),
  selected: s.selectActionableOccurrences('2026-04-25')
    .map(d => ({ id: d.id, name: d.protocolItem?.name, time: d.scheduledTime, status: d.status })),
})
```

```js
localStorage.getItem('medremind-sync-outbox-v1')
```

## 7. Suspected next failure classes if the symptom persists

If Supabase still contains `taken` rows but the UI does not show them, investigate in this order:

1. **Wrong URL or stale alias:** the user may be opening an old preview URL rather than `https://medremind-app-two.vercel.app`.
2. **Cloud pull failure:** `pullStoreFromSupabase()` can fail and app remains usable with local-only state; check console for `[cloud-pull-on-boot-failed]`.
3. **Auth/session mismatch:** confirm actual authenticated `user.id`; a duplicate account was not found for `peter@alionuk.com`, but the live browser session still must be verified.
4. **Cloud pull filtering:** `cloudStore.ts` drops scheduled rows if their `active_protocol_id` or `protocol_item_id` cannot be resolved into current in-memory `activeProtocols`/`protocols` maps.
5. **Selector/UI filtering:** `/app` uses `selectActionableOccurrences` for today/future and `selectHistoryOccurrences` for past dates; active protocol status can hide non-history rows.
6. **Date/timezone mismatch:** today is computed from `profile.timezone`; user timezone is currently `Europe/London`.

## 8. Commands already run

Local verification after the latest fixes:

```bash
npm run build
npm run test:e2e -- tests/e2e/smoke.spec.ts --grep "public smoke"
```

Both passed after `e0123ff` and after merge to `main` at `6e47068`.

Production deployment verification:

```bash
curl -fsS https://medremind-app-two.vercel.app/api/version
```

Expected response contains:

```text
6e47068d926abf0a37141c9df55a37072d8e7cd2
```

GitHub Actions deploy run for `6e47068`:

```text
https://github.com/petermkey/medremind-app/actions/runs/24932276147
```

Status: success.

## 9. Safety notes for next agent

- Do not print Supabase service-role keys, tokens, cookies, or private credentials.
- Use service-role env only locally for read-only diagnostics unless explicitly applying migrations or data repair.
- Follow branch policy: create `codex/<sprint-id>-<slice-name>` for new code/doc slices.
- Keep behavior fixes and data repair separated; do not mix operational data changes with code changes.
- If a live authenticated browser is available, use Chrome DevTools MCP first for URL/version/session/store verification.
- Do not assume the green sync pill means cloud pull succeeded; it reflects outbox/direct sync status, not necessarily restart read-path correctness.
