import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { analyzeFoodText } from '@/lib/food/analyze/providers';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const MAX_TEXT_LENGTH = 1000;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let text: unknown;
  try {
    ({ text } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Meal description is required.' }, { status: 400 });
  }
  if (typeof text !== 'string' || text.trim().length < 3 || text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: 'Meal description is required.' }, { status: 400 });
  }
  try {
    const draft = await analyzeFoodText(text.trim());
    return NextResponse.json({ draft });
  } catch (err) {
    console.error('[food-analyze-text]', err);
    Sentry.captureException(err);
    const reason = err instanceof Error && /^food_/.test(err.message) ? err.message : 'unknown';
    return NextResponse.json({ error: 'Food analysis failed.', reason }, { status: 502 });
  }
}
