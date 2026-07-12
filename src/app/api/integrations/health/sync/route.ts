import { NextRequest, NextResponse } from 'next/server';

import { syncOuraSnapshots } from '@/lib/health/ouraSyncEngine';
import {
  ensureOuraHealthConnection,
  getEnabledHealthConnections,
  markHealthConnectionSyncError,
} from '@/lib/health/sourceRegistry';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toDateInput(value: string | null): string | null {
  if (!value) return null;
  return DATE_RE.test(value) ? value : null;
}

function defaultStartDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 14);
  return date.toISOString().slice(0, 10);
}

function defaultEndDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startDate = toDateInput(request.nextUrl.searchParams.get('start_date')) ?? defaultStartDate();
  const endDate = toDateInput(request.nextUrl.searchParams.get('end_date')) ?? defaultEndDate();

  if (startDate > endDate) {
    return NextResponse.json({ error: 'start_date must be before or equal to end_date.' }, { status: 400 });
  }

  const userId = data.user.id;
  const range = { start_date: startDate, end_date: endDate };

  try {
    await ensureOuraHealthConnection(userId);
    const connections = await getEnabledHealthConnections(userId);
    const counts: Record<string, number> = {};

    for (const connection of connections) {
      if (connection.source === 'oura') {
        counts.oura = await syncOuraSnapshots(userId, range, 'manual_refresh');
      }
    }

    return NextResponse.json({ counts });
  } catch (err) {
    console.error('[health/sync] sync failed', err);

    try {
      await markHealthConnectionSyncError(
        userId,
        'oura',
        err instanceof Error ? err.message : 'Health sync failed.',
      );
    } catch (markErr) {
      console.error('[health/sync] failed to mark sync error', markErr);
    }

    return NextResponse.json({ error: 'Health sync failed.' }, { status: 502 });
  }
}
