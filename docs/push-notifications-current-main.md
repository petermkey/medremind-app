# iOS Web Push — Architecture & Known Issues

Date: 2026-03-23
Status: Implemented, deployed to production, functional end-to-end

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
| Cron trigger | [cron-job.org](https://cron-job.org) job #7402449 — calls `/api/cron/notify` every minute with Bearer token |
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
5. Saves `{user_id, endpoint, p256dh, auth}` to `push_subscriptions` via delete+insert
6. `saveNotificationSettingsToSupabase()` upserts `{push_enabled, lead_time_min, ...}` to `notification_settings` — **critical for cron to find the user**

### Notification delivery (cron)
1. cron-job.org hits `GET /api/cron/notify` every minute with `Authorization: Bearer $CRON_SECRET`
2. Queries `notification_settings` where `push_enabled = true`
3. For each user: computes target time with `lead_time_min` offset, queries `scheduled_doses` in ±1 min window
4. Lifecycle filters: `active` protocols only, `pending`/`overdue` doses, within `end_date`
5. Deduplicates via `notification_log` (upsert on `user_id, scheduled_dose_id`)
6. Calls `POST /api/push/send` per dose → `webpush.sendNotification()` → Apple APNs

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
