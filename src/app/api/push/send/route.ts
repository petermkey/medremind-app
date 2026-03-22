// POST /api/push/send
// Internal API used by the notification scheduler (cron) to deliver a push
// notification to all subscriptions for a given user.
//
// Authentication: CRON_SECRET bearer token — not accessible by browser clients.

import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const vapidEmail = process.env.VAPID_EMAIL!;
const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY!;

if (vapidEmail && vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey);
}

type SendBody = {
  userId: string;
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

export async function POST(request: NextRequest) {
  // Verify the request comes from the cron scheduler, not a browser client.
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!vapidEmail || !vapidPublicKey || !vapidPrivateKey) {
    return NextResponse.json({ error: 'VAPID not configured' }, { status: 500 });
  }

  let body: SendBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { userId, title, body: notifBody, url = '/app', tag } = body;
  if (!userId || !title || !notifBody) {
    return NextResponse.json({ error: 'Missing required fields: userId, title, body' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: subscriptions, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId);

  if (error) {
    console.error('[push/send] fetch subscriptions failed', error);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  if (!subscriptions || subscriptions.length === 0) {
    return NextResponse.json({ sent: 0, stale: 0 });
  }

  const payload = JSON.stringify({ title, body: notifBody, url, tag });
  let sent = 0;
  let stale = 0;
  const staleEndpoints: string[] = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sent++;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 410 || status === 404) {
          // Subscription expired or invalid — delete it.
          staleEndpoints.push(sub.endpoint);
          stale++;
        } else {
          console.error('[push/send] delivery failed', sub.endpoint.slice(-20), err);
        }
      }
    }),
  );

  // Clean up expired subscriptions.
  if (staleEndpoints.length > 0) {
    await supabase
      .from('push_subscriptions')
      .delete()
      .in('endpoint', staleEndpoints);
  }

  return NextResponse.json({ sent, stale });
}
