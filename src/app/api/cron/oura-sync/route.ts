import { NextRequest, NextResponse } from 'next/server';

import { syncOuraSnapshots } from '@/lib/health/ouraSyncEngine';
import {
  listConnectedOuraUserIds,
  markHealthConnectionSyncError,
} from '@/lib/health/sourceRegistry';
import { computeOuraCronSyncRange } from '@/lib/oura/syncWindows';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const connections = await listConnectedOuraUserIds();
  const results: Array<{ userId: string; status: string; snapshots?: number }> = [];

  for (const connection of connections) {
    const range = computeOuraCronSyncRange(new Date(), connection.lastSyncAt);
    try {
      const snapshots = await syncOuraSnapshots(connection.userId, range, 'daily');
      results.push({ userId: connection.userId, status: 'ok', snapshots });
    } catch (err) {
      console.error('[cron/oura-sync] user sync failed', connection.userId, err);
      await markHealthConnectionSyncError(
        connection.userId,
        'oura',
        err instanceof Error ? err.message : 'Scheduled Oura sync failed.',
      ).catch(() => undefined);
      results.push({ userId: connection.userId, status: 'error' });
    }
  }

  return NextResponse.json({ synced: results.filter((r) => r.status === 'ok').length, results });
}
