// GET /api/insights/weekly-review — the user's stored weekly reviews,
// newest first (latest + archive for the Progress page).
import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const ARCHIVE_LIMIT = 12;

export async function GET() {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('weekly_reviews')
    .select('id, week_start, payload, model, created_at')
    .eq('user_id', authData.user.id)
    .order('week_start', { ascending: false })
    .limit(ARCHIVE_LIMIT);

  if (error) {
    console.error('[insights/weekly-review] query failed', error);
    return NextResponse.json({ error: 'Weekly reviews unavailable.' }, { status: 500 });
  }

  return NextResponse.json({
    reviews: (data ?? []).map((row) => ({
      id: String(row.id),
      weekStart: String(row.week_start),
      payload: row.payload,
      model: String(row.model),
      createdAt: String(row.created_at),
    })),
  });
}
