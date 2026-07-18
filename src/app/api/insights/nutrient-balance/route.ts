import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { getNutrientBalance } from '@/lib/nutrientBalance/service';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const refresh = request.nextUrl.searchParams.get('refresh') === '1';
    const response = await getNutrientBalance(data.user.id, { refresh });
    return NextResponse.json(response);
  } catch (err) {
    Sentry.captureException(err);
    const reason =
      err instanceof Error && /^nutrient_balance_/.test(err.message) ? err.message : 'unknown';
    return NextResponse.json({ error: 'Nutrient balance failed.', reason }, { status: 502 });
  }
}
