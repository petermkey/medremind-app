// GET /api/healthz
// Public, unauthenticated liveness check for external uptime monitors
// (cron-job.org, UptimeRobot, etc.). Pings Postgres with a hard timeout so
// a stalled/unreachable Supabase project (e.g. 522s from Cloudflare, as on
// 2026-08-14) is reported as down within seconds instead of the caller
// hanging on the default fetch/TCP timeout.
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { withTimeout } from '@/lib/supabase/withTimeout';

export const runtime = 'nodejs';

const DB_PING_TIMEOUT_MS = 5000;

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const start = Date.now();
  try {
    const { error } = await withTimeout(
      supabase.from('profiles').select('id', { head: true, count: 'exact' }),
      DB_PING_TIMEOUT_MS,
    );
    if (error) throw error;
    return NextResponse.json({ status: 'ok', latencyMs: Date.now() - start });
  } catch (err) {
    console.error('[healthz] database unreachable', err);
    return NextResponse.json(
      {
        status: 'down',
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'unknown error',
      },
      { status: 503 },
    );
  }
}
