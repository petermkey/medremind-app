// Push subscription management — client side.
// Handles creating a PushManager subscription and saving/deleting it in Supabase.

import { createBrowserClient } from '@supabase/ssr';
import { getSwRegistration } from './swRegister';

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const bytes = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) bytes[i] = rawData.charCodeAt(i);
  return bytes.buffer;
}

function subscriptionMatchesKey(subscription: PushSubscription, key: ArrayBuffer): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const a = new Uint8Array(current);
  const b = new Uint8Array(key);
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

export type PushSubscribeResult =
  | { ok: true }
  | { ok: false; reason: 'not-supported' | 'permission-denied' | 'not-installed' | 'error'; message?: string };

/**
 * Request push permission and subscribe.
 * Must be called from a user gesture (button click).
 * On iOS: only works when running in standalone mode (Home Screen installed).
 */
export async function subscribeToPush(): Promise<PushSubscribeResult> {
  if (typeof window === 'undefined') return { ok: false, reason: 'not-supported' };

  // Check PushManager availability — not available in regular Safari browser tab on iOS.
  if (!('PushManager' in window)) {
    // Running in Safari browser (not Home Screen). iOS constraint.
    return { ok: false, reason: 'not-installed' };
  }

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    console.error('[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY not set');
    return { ok: false, reason: 'error', message: 'Push not configured' };
  }

  // Request notification permission — must come from user gesture.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, reason: 'permission-denied' };
  }

  const registration = await getSwRegistration();
  if (!registration) {
    return { ok: false, reason: 'not-supported', message: 'Service worker not available' };
  }

  const subscribeOptions = {
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  };

  let subscription: PushSubscription;
  try {
    // Reuse an existing subscription only if it was created with the current
    // VAPID key. After a key rotation the old subscription still exists but
    // every delivery to it fails with 403, and subscribing over it throws
    // InvalidStateError — so drop it and subscribe fresh.
    const existing = await registration.pushManager.getSubscription();
    if (existing && !subscriptionMatchesKey(existing, subscribeOptions.applicationServerKey)) {
      await existing.unsubscribe();
      subscription = await registration.pushManager.subscribe(subscribeOptions);
    } else {
      subscription = existing ?? await registration.pushManager.subscribe(subscribeOptions);
    }
  } catch (err) {
    const isRetryable = err instanceof Error
      && (err.name === 'QuotaExceededError' || err.name === 'InvalidStateError');
    if (isRetryable) {
      // iOS quirk: a subscription exists internally but getSubscription()
      // returned null (QuotaExceededError), or a stale subscription with a
      // different key survived (InvalidStateError). Unregister the SW and
      // re-register to clear the stale state, then subscribe.
      try {
        await registration.unregister();
        const newReg = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
        await navigator.serviceWorker.ready;
        subscription = await newReg.pushManager.subscribe(subscribeOptions);
      } catch (retryErr) {
        console.error('[push] subscribe retry failed', retryErr);
        return { ok: false, reason: 'error', message: String(retryErr) };
      }
    } else {
      console.error('[push] subscribe failed', err);
      return { ok: false, reason: 'error', message: String(err) };
    }
  }

  const json = subscription.toJSON();
  const endpoint = json.endpoint!;
  const p256dh = json.keys?.['p256dh']!;
  const auth = json.keys?.['auth']!;

  const supabase = getSupabase();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'error', message: 'Not authenticated' };

  // Multi-device: upsert on (user_id, endpoint) — that unique constraint has
  // been live since migration 011 (2026-06-10). Previously this deleted ALL
  // of the user's subscriptions before inserting the new one, so a second
  // installed device (phone + tablet) silently lost notifications the
  // moment either device re-subscribed — see docs/system-audit-2026-07-09.md §2.
  const { error } = await supabase.from('push_subscriptions').upsert(
    { user_id: user.id, endpoint, p256dh, auth },
    { onConflict: 'user_id,endpoint' },
  );

  if (error) {
    console.error('[push] save subscription failed', error);
    return { ok: false, reason: 'error', message: error.message };
  }

  return { ok: true };
}

/**
 * Count this user's stored push subscriptions. Used by the Settings page to
 * warn when push is enabled but no subscription is actually on file (see
 * docs/system-audit-2026-07-09.md §2 — the cron previously marked these
 * users as "delivered" even though nobody received anything).
 */
export async function getPushSubscriptionCount(): Promise<number> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;

  const { count, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint', { count: 'exact', head: true })
    .eq('user_id', user.id);

  if (error) {
    console.error('[push] subscription count check failed', error);
    return 0;
  }
  return count ?? 0;
}

/**
 * Unsubscribe from push and delete the subscription from Supabase.
 * Called on sign-out or when the user disables push in Settings.
 */
export async function unsubscribeFromPush(): Promise<void> {
  if (typeof window === 'undefined') return;

  const registration = await getSwRegistration();
  if (!registration) return;

  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;

  try {
    await subscription.unsubscribe();
  } catch (err) {
    console.error('[push] unsubscribe failed', err);
  }

  const supabase = getSupabase();
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
}

/**
 * Persist notification preferences to Supabase so the cron job can find
 * users with push_enabled = true.
 */
export async function saveNotificationSettingsToSupabase(settings: {
  pushEnabled: boolean;
  emailEnabled: boolean;
  leadTimeMin: number;
  digestTime: string;
  morningBriefingEnabled: boolean;
  smartFoodTiming: boolean;
}): Promise<void> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from('notification_settings').upsert(
    {
      user_id: user.id,
      push_enabled: settings.pushEnabled,
      email_enabled: settings.emailEnabled,
      lead_time_min: settings.leadTimeMin,
      digest_time: settings.digestTime,
      morning_briefing_enabled: settings.morningBriefingEnabled,
      smart_food_timing: settings.smartFoodTiming,
    },
    { onConflict: 'user_id' },
  );
}
