# iOS Web Push — Architecture & Known Issues

Date: 2026-03-23
Status: Implemented, deployed to production, **verified end-to-end 2026-03-23**

---

## 1. Stack overview

| Layer | Implementation |
|---|---|
| Service Worker | `public/sw.js` — handles `push`, `notificationclick`, `install`, `activate` |
| SW registration | `src/lib/push/swRegister.ts` — registers on app boot, handles `NOTIFICATION_CLICK` message |
| Subscription | `src/lib/push/subscription.ts` — `subscribeToPush`, `unsubscribeFromPush`, `saveNotificationSettingsToSupabase` |
| Install detection | `src/lib/push/useInstallState.ts` — detects `standalone` vs `browser` mode |
| Push delivery | `POST /api/push/send` — CRON_SECRET auth, calls `web-push`, auto-deletes stale endpoints |
| Scheduler | `GET /api/cron/notify` — queries `notification_settings`, finds due doses, deduplicates via `notification_log` |
| Cron trigger | [cron-job.org](https://cron-job.org) job #7402447 — calls `/api/cron/notify` every minute with Bearer token |
| DB tables | `push_subscriptions`, `notification_log` (see `supabase/003_web_push.sql`) |

---

## 2. iOS requirements

- Push only works when the PWA is **installed on the Home Screen** (iOS 16.4+)
- `PushManager` API is absent in regular Safari tab — returns `not-installed` reason
- Permission must be requested from a user gesture (button click)

---

## 3. Key data flows

### Subscription registration (Settings → Save Notifications)
1. `saveNotifications()` calls `subscribeToPush()`
2. `Notification.requestPermission()` → iOS system dialog
3. `pushManager.getSubscription() ?? pushManager.subscribe({ userVisibleOnly, applicationServerKey })`
4. On `QuotaExceededError` (iOS WebKit bug): unregisters SW, re-registers, retries subscribe
5. Saves `{user_id, endpoint, p256dh, auth}` to `push_subscriptions` **with single-device enforcement**: older endpoints for the user are deleted first (see `subscription.ts` lines 102–106). If multi-device support is added later, remove the delete and deduplicate in the send path instead.
6. `saveNotificationSettingsToSupabase()` upserts `{push_enabled, lead_time_min, ...}` to `notification_settings` — **critical for cron to find the user**

### Notification delivery (cron) — two-pass firing with reliability

**Pass A: Initial scheduled notifications**
1. cron-job.org hits `GET /api/cron/notify` every minute with `Authorization: Bearer $CRON_SECRET`
2. Before processing each user: **stale-claim recovery** deletes `notification_log` rows with `notification_count=1` older than 2× WINDOW_MINUTES (2 min). This unblocks doses whose Pass A lock was written by a crashed worker that never delivered the push.
3. Queries `notification_settings` where `push_enabled = true`
4. For each user: computes target time with `lead_time_min` offset, queries `scheduled_doses` in ±1 min window
5. Lifecycle filters: `active` protocols only, `pending`/`overdue` doses, within `end_date`
6. Atomic Pass A lock: upsert `notification_log` with `notification_count=1` using `onConflict: ignoreDuplicates` to ensure only one cron worker claims the initial send per dose.
7. Calls `POST /api/push/send` per dose → `webpush.sendNotification()` → Apple APNs
8. On success: lock remains; Pass B will later remind
9. On failure: **lock is deleted immediately** (lines 217–222) so the next cron window can retry the initial send without waiting

**Pass B: Reminder notifications for unactioned doses**
1. Find log rows where `sent_at ≤ now - REMINDER_INTERVAL_MINUTES` and `notification_count < MAX_NOTIFICATIONS`
2. Atomic Pass B reservation: update `sent_at` and increment `notification_count` only if the row still matches the window conditions
3. On success: sends reminder push
4. On failure: **rolls back reservation** (lines 339–347) — reverts `sent_at` and `notification_count` to previous values so the next cron window can retry the reminder without losing track of the attempt count

---

## 4. Environment variables (Vercel Production)

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | VAPID public key (client-side subscribe) |
| `VAPID_PRIVATE_KEY` | VAPID private key (server-side send) |
| `VAPID_EMAIL` | `mailto:` contact for VAPID |
| `CRON_SECRET` | Bearer token shared between cron-job.org and `/api/push/send` + `/api/cron/notify` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for cron/send routes (bypasses RLS) |

---

## 5. Known iOS WebKit bugs & workarounds

| Bug | Workaround |
|---|---|
| `QuotaExceededError` on `pushManager.subscribe()` | Unregister SW, re-register, retry subscribe |
| `getSubscription()` returns `null` after app restart | Retry subscribe; new endpoint saved to DB, old one auto-deleted |
| Subscription terminated after 3 silent pushes | `sw.js` always wraps `showNotification` in `event.waitUntil()` |
| 5MB localStorage quota exceeded on iOS | `scheduledDoses`/`doseRecords` excluded from `partialize`; custom storage with `QuotaExceededError` auto-evict |

---

## 6. Supabase tables

```sql
-- push_subscriptions: one row per device per user
-- RLS: users manage own rows; service role has full access

-- notification_log: deduplication — one row per dose sent
-- RLS: service role only

-- notification_settings: push preferences — cron reads this
-- Columns: user_id, push_enabled, email_enabled, lead_time_min, digest_time
-- Written by: saveNotificationSettingsToSupabase() in subscription.ts
-- Read by: /api/cron/notify
```

---

## 7. Manual test commands

```bash
# Send test push to a specific user
curl -X POST https://medremind-app-two.vercel.app/api/push/send \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"userId":"<uuid>","title":"Test","body":"Push works","url":"/app","tag":"test"}'

# Trigger cron manually
curl https://medremind-app-two.vercel.app/api/cron/notify \
  -H "Authorization: Bearer $CRON_SECRET"
```

---

## 8. cron-job.org setup

- URL: `https://medremind-app-two.vercel.app/api/cron/notify`
- Schedule: every 1 minute
- Header: `Authorization: Bearer <CRON_SECRET>`
- Vercel Hobby plan does NOT support sub-daily cron jobs — cron-job.org is the trigger
- `vercel.json` has `"crons": []` (empty — Vercel cron disabled)
- Job ID: **7402447** (console.cron-job.org/jobs/7402447)
- cron-job.org API key stored in `vercel-env-import.env` (local only, not committed)

---

## 9. Reliability features (added 2026-04-01)

### Stale-claim recovery

**Problem:** If a cron worker crashes after writing the Pass A lock (`notification_count=1`) but before calling `/api/push/send`, the row remains indefinitely and blocks all future Pass A attempts for that dose. The dose will never fire.

**Solution:** Before processing each user, delete any `notification_count=1` rows whose `sent_at` is older than 2× WINDOW_MINUTES (i.e., 2 minutes). A worker writing the lock has 2 minutes to deliver; if the timestamp is older, the writer is clearly gone and the row is safe to reclaim.

**Implementation:** Lines 92–106 of `/api/cron/notify`.

### Pass B rollback on transient send failure

**Problem:** When Pass B (reminder) increments `sent_at` and `notification_count` and then the push send fails transiently (network error, quota exceeded, etc.), the reservation update is lost. The next cron window will not find the dose because `sent_at` is already ahead of the reminder cutoff window.

**Solution:** On send failure in Pass B, immediately update the row back to its pre-reservation state using the cached `prevSentAt` and previous `notification_count`. The dose remains in the reminder queue and will be attempted again on the next cron window.

**Implementation:** Lines 339–347 of `/api/cron/notify`.

---

## 10. Incidents & fixes (2026-03-23)

### Bug: `RangeError: Invalid time value` in `/api/cron/notify`

**Symptom:** cron returned HTTP 500, no notifications delivered.

**Root cause:** `new Date(targetUtc.toLocaleString('en-CA', { timeZone: tz }))` throws
`RangeError` in Node 22 / V8 — `toLocaleString('en-CA')` returns a locale-formatted
string that `new Date()` cannot parse.

**Fix (commit `028cf6f`):** replaced with `Intl.DateTimeFormat('en-CA').formatToParts()`:
```ts
const localDateParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: tz,
  year: 'numeric', month: '2-digit', day: '2-digit',
}).formatToParts(targetUtc);
const localDate = `${...year}-${...month}-${...day}`;
```

### Env vars missing from Vercel Production

All env vars were added via CLI with `printf` (no trailing `\n`):
```bash
printf 'value' | npx vercel env add VAR_NAME production
```
Using `echo` or heredoc appends `\n` which breaks string comparison (401 Unauthorized).

**Complete list of required Vercel env vars:**

| Var | Source |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project settings |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings → service_role |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | `vercel-env-import.env` |
| `VAPID_PRIVATE_KEY` | `vercel-env-import.env` |
| `VAPID_EMAIL` | `vercel-env-import.env` |
| `CRON_SECRET` | `vercel-env-import.env` |
| `NEXT_PUBLIC_APP_URL` | `https://medremind-app-two.vercel.app` |

### cron-job.org job was disabled

After saving the job in the UI, it was showing `enabled: false` via API.
Fix: `PATCH /jobs/7402447` with `{"job":{"enabled":true}}` via cron-job.org REST API.
