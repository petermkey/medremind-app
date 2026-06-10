// POST /api/push/send
// Internal API used to deliver a push notification to all subscriptions for a
// given user. Delivery logic lives in lib/push/sendToUser (also called directly
// by the cron scheduler, avoiding a self-fetch round trip).
//
// Authentication: CRON_SECRET bearer token — not accessible by browser clients.

import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

import { isVapidConfigured, sendPushToUser } from '@/lib/push/sendToUser';

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

  if (!isVapidConfigured()) {
    return NextResponse.json({ error: 'VAPID not configured' }, { status: 500 });
  }

  let body: SendBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { userId, title, body: notifBody, url, tag } = body;
  if (!userId || !title || !notifBody) {
    return NextResponse.json({ error: 'Missing required fields: userId, title, body' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  try {
    const result = await sendPushToUser(supabase, userId, { title, body: notifBody, url, tag });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }
}
