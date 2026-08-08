// GET /api/cron/correlation-refresh
// WS2 (audit remediation, 2026-08-06): daily regeneration of correlation
// insights for consented users. Previously generateAndPersistCorrelationInsights
// was only reachable via the manual "Refresh patterns" button on the Progress
// page (POST /api/insights/correlations), so insights silently went stale
// after the one-time click. Runs at 05:00 UTC, ahead of the 06:00 UTC
// weekly-review / morning-briefing crons.
//
// Discipline: fail-closed CRON_SECRET; Sentry check-in + monitorConfig upsert
// (cron/oura-sync pattern, PR #93/#106). Trigger/work are decoupled via
// after() (maxDuration 300) because the per-user snapshot rebuild + card
// regeneration loop can exceed cron-job.org's fixed 30s client timeout; the
// Sentry check-in is the real success/failure monitor, not cron-job.org. A
// per-user try/catch keeps one user's failure from aborting the rest of the
// batch.
import * as Sentry from '@sentry/nextjs';
import { after, NextRequest, NextResponse } from 'next/server';

import {
  generateAndPersistCorrelationInsights,
  listConsentedCorrelationUserIds,
} from '@/lib/correlation/persistence';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MONITOR_SLUG = 'cron-correlation-refresh';

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const checkInId = Sentry.captureCheckIn(
    {
      monitorSlug: MONITOR_SLUG,
      status: 'in_progress',
    },
    {
      schedule: { type: 'crontab', value: '0 5 * * *' },
      checkinMargin: 60,
      maxRuntime: 10,
      timezone: 'UTC',
    },
  );

  after(() => runCorrelationRefresh(checkInId));

  return NextResponse.json({ triggered: true });
}

async function runCorrelationRefresh(checkInId: string): Promise<void> {
  try {
    const userIds = await listConsentedCorrelationUserIds();

    for (const userId of userIds) {
      try {
        await generateAndPersistCorrelationInsights(userId);
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'cron/correlation-refresh', userId } });
      }
    }

    Sentry.captureCheckIn({ checkInId, monitorSlug: MONITOR_SLUG, status: 'ok' });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'cron/correlation-refresh', stage: 'after' } });
    Sentry.captureCheckIn({ checkInId, monitorSlug: MONITOR_SLUG, status: 'error' });
  }
}
