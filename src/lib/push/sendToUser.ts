// Server-side push delivery core. Shared by /api/push/send (HTTP entry point)
// and /api/cron/notify (direct in-process call — no self-fetch). Fetches all of
// a user's push subscriptions, delivers the payload, and prunes expired ones.

import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';

let vapidConfigured = false;

export function isVapidConfigured(): boolean {
  const email = process.env.VAPID_EMAIL;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!email || !publicKey || !privateKey) return false;
  if (!vapidConfigured) {
    webpush.setVapidDetails(email, publicKey, privateKey);
    vapidConfigured = true;
  }
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

export type SendResult = { sent: number; stale: number };

/**
 * Deliver a push payload to every subscription belonging to `userId`.
 * Expired subscriptions (410/404) are deleted. Assumes VAPID is configured
 * (call isVapidConfigured() first at the HTTP boundary).
 */
export async function sendPushToUser(
  supabase: SupabaseClient,
  userId: string,
  payload: PushPayload,
): Promise<SendResult> {
  const { data: subscriptions, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId);

  if (error) {
    console.error('[push/send] fetch subscriptions failed', error);
    throw new Error('Failed to fetch push subscriptions');
  }

  if (!subscriptions || subscriptions.length === 0) {
    return { sent: 0, stale: 0 };
  }

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? '/app',
    tag: payload.tag,
  });

  let sent = 0;
  let stale = 0;
  const staleEndpoints: string[] = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        );
        sent++;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 410 || status === 404) {
          staleEndpoints.push(sub.endpoint);
          stale++;
        } else {
          console.error('[push/send] delivery failed', sub.endpoint.slice(-20), err);
        }
      }
    }),
  );

  if (staleEndpoints.length > 0) {
    await supabase.from('push_subscriptions').delete().in('endpoint', staleEndpoints);
  }

  return { sent, stale };
}
