import * as Sentry from '@sentry/nextjs';
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

  // Heartbeat: lets Sentry alert if this route stops being invoked by the
  // external cron-job.org scheduler, independent of any in-request error.
  // monitorConfig upserts the expected schedule so it stays in lockstep with
  // the cron-job.org job (#8090621, hourly) without touching the Sentry UI.
  const checkInId = Sentry.captureCheckIn(
    {
      monitorSlug: 'cron-oura-sync',
      status: 'in_progress',
    },
    {
      schedule: { type: 'crontab', value: '0 * * * *' },
      checkinMargin: 10,
      maxRuntime: 10,
      timezone: 'Europe/London',
    },
  );

  const results: Array<{ userId: string; status: string; snapshots?: number }> = [];

  try {
    const connections = await listConnectedOuraUserIds();

    for (const connection of connections) {
      const range = computeOuraCronSyncRange(new Date(), connection.lastSyncAt);
      try {
        const snapshots = await syncOuraSnapshots(connection.userId, range, 'daily');
        results.push({ userId: connection.userId, status: 'ok', snapshots });
      } catch (err) {
        console.error('[cron/oura-sync] user sync failed', connection.userId, err);
        Sentry.captureException(err, { tags: { route: 'cron/oura-sync', userId: connection.userId } });
        await markHealthConnectionSyncError(
          connection.userId,
          'oura',
          err instanceof Error ? err.message : 'Scheduled Oura sync failed.',
        ).catch(() => undefined);
        results.push({ userId: connection.userId, status: 'error' });
      }
    }
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'cron/oura-sync', stage: 'listConnectedOuraUserIds' } });
    Sentry.captureCheckIn({ checkInId, monitorSlug: 'cron-oura-sync', status: 'error' });
    throw err;
  }

  Sentry.captureCheckIn({ checkInId, monitorSlug: 'cron-oura-sync', status: 'ok' });
  return NextResponse.json({ synced: results.filter((r) => r.status === 'ok').length, results });
}
