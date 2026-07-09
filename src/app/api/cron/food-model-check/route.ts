// GET /api/cron/food-model-check
// Verifies the configured OpenRouter food-vision model chain still resolves
// to a working provider endpoint. Catches both model retirement (404 "no
// endpoints found") and account-level data-policy/guardrail blocks (404 "no
// endpoints available matching your guardrail restrictions") — the latter
// was the 2026-07-10 follow-up to docs/incident-food-analyze-2026-07-09.md
// that a plain /models catalog check would have missed.
import * as Sentry from '@sentry/nextjs';
import { NextRequest, NextResponse } from 'next/server';

import { getOpenRouterFoodVisionModels } from '@/lib/food/analyze/openRouterModels';
import { checkOpenRouterModelAvailable } from '@/lib/food/analyze/modelHealthcheck';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const checkInId = Sentry.captureCheckIn({
    monitorSlug: 'cron-food-model-check',
    status: 'in_progress',
  });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    Sentry.captureCheckIn({ checkInId, monitorSlug: 'cron-food-model-check', status: 'error' });
    return NextResponse.json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 500 });
  }

  const models = getOpenRouterFoodVisionModels();
  const results = await Promise.all(
    models.map((model) => checkOpenRouterModelAvailable(model, apiKey)),
  );
  const anyWorking = results.some((r) => r.ok);

  if (!anyWorking) {
    Sentry.captureMessage('[cron/food-model-check] every configured food vision model is unavailable', {
      level: 'error',
      tags: { route: 'cron/food-model-check' },
      extra: { results },
    });
    Sentry.captureCheckIn({ checkInId, monitorSlug: 'cron-food-model-check', status: 'error' });
    return NextResponse.json({ ok: false, results }, { status: 500 });
  }

  const anyBroken = results.some((r) => !r.ok);
  if (anyBroken) {
    Sentry.captureMessage('[cron/food-model-check] one or more configured food vision models are unavailable', {
      level: 'warning',
      tags: { route: 'cron/food-model-check' },
      extra: { results },
    });
  }

  Sentry.captureCheckIn({ checkInId, monitorSlug: 'cron-food-model-check', status: 'ok' });
  return NextResponse.json({ ok: true, results });
}
