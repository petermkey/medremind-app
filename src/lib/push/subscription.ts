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
    // Reuse an existing subscription if one already exists for this device.
    subscription = await registration.pushManager.getSubscription()
      ?? await registration.pushManager.subscribe(subscribeOptions);
  } catch (err) {
    const isQuota = err instanceof Error && err.name === 'QuotaExceededError';
    if (isQuota) {
      // iOS quirk: subscription exists internally but getSubscription() returned null.
      // Unregister the SW and re-register to clear the stale state, then subscribe.
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
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      endpoint,
      p256dh,
      auth,
      user_agent: navigator.userAgent.slice(0, 200),
    },
    { onConflict: 'user_id,endpoint' },
  );

  if (error) {
    console.error('[push] save subscription failed', error);
    return { ok: false, reason: 'error', message: error.message };
  }

  return { ok: true };
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
