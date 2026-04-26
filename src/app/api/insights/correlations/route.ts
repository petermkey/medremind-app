import { NextResponse } from 'next/server';

import {
  generateAndPersistCorrelationInsights,
  getCorrelationConsent,
  getLatestCorrelationInsightCards,
  hasActiveCorrelationConsent,
} from '@/lib/correlation/persistence';
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
    cards: cards.map(publicCard),
  });
}

export async function POST() {
  const auth = await requireUser();
  if (!auth.userId) return auth.response;

  const consent = await getCorrelationConsent(auth.userId);
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

  const cards = await generateAndPersistCorrelationInsights(auth.userId);

  return NextResponse.json({
    consent,
    cards: cards.map(publicCard),
  });
}
