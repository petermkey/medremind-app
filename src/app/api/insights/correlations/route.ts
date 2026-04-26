import { NextRequest, NextResponse } from 'next/server';

import {
  generateAndPersistCorrelationInsights,
  getCorrelationConsent,
  getLatestCorrelationInsightCards,
  hasActiveCorrelationConsent,
  createCorrelationServiceClient,
} from '@/lib/correlation/persistence';
import type { CorrelationConsent } from '@/lib/correlation/types';
import type { CorrelationInsightCard } from '@/lib/correlation/types';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

function publicCard(card: CorrelationInsightCard) {
  return {
    windowDays: card.windowDays,
    feature: card.feature,
    outcome: card.outcome,
    r: card.r,
    n: card.n,
    strength: card.strength,
    direction: card.direction,
    recommendationKind: card.recommendationKind,
    title: card.title,
    body: card.body,
    evidence: card.evidence,
    generatedAt: card.generatedAt,
  };
}

function consentFromRow(row: Record<string, unknown> | null): CorrelationConsent {
  return {
    enabled: row?.enabled === true,
    includesMedicationPatterns: row?.includes_medication_patterns === true,
    includesHealthData: row?.includes_health_data === true,
    acknowledgedNoMedChanges: row?.acknowledged_no_med_changes === true,
  };
}

async function upsertRouteConsent(userId: string, consent: unknown): Promise<CorrelationConsent> {
  const value = consent && typeof consent === 'object'
    ? consent as Partial<CorrelationConsent>
    : {};
  const supabase = createCorrelationServiceClient();
  const { data, error } = await supabase
    .from('correlation_consents')
    .upsert({
      user_id: userId,
      enabled: value.enabled === true,
      includes_medication_patterns: value.includesMedicationPatterns === true,
      includes_health_data: value.includesHealthData === true,
      acknowledged_no_med_changes: value.acknowledgedNoMedChanges === true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    .select('enabled, includes_medication_patterns, includes_health_data, acknowledged_no_med_changes')
    .single();

  if (error) throw error;
  return consentFromRow(data as Record<string, unknown> | null);
}

async function requireUser(): Promise<
  | { userId: string; response?: never }
  | { userId: null; response: NextResponse }
> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return { userId: null, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  return { userId: data.user.id };
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.userId) return auth.response;

  const [consent, cards] = await Promise.all([
    getCorrelationConsent(auth.userId),
    getLatestCorrelationInsightCards(auth.userId),
  ]);

  return NextResponse.json({
    consent,
    cards: hasActiveCorrelationConsent(consent) ? cards.map(publicCard) : [],
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.userId) return auth.response;

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const requestedConsent = body && typeof body === 'object' && 'consent' in body
    ? (body as { consent?: unknown }).consent
    : null;
  const shouldRefresh = !body || typeof body !== 'object' || (body as { refresh?: unknown }).refresh !== false;

  const consent = requestedConsent && typeof requestedConsent === 'object'
    ? await upsertRouteConsent(auth.userId, requestedConsent)
    : await getCorrelationConsent(auth.userId);

  if (!hasActiveCorrelationConsent(consent)) {
    return NextResponse.json(
      {
        error: 'Correlation consent is required before generating insights.',
        consent,
        cards: [],
      },
      { status: 403 },
    );
  }

  if (!shouldRefresh) {
    const cards = await getLatestCorrelationInsightCards(auth.userId);
    return NextResponse.json({
      consent,
      cards: cards.map(publicCard),
    });
  }

  const cards = await generateAndPersistCorrelationInsights(auth.userId);

  return NextResponse.json({
    consent,
    cards: cards.map(publicCard),
  });
}
