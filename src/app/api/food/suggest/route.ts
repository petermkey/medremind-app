import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import {
  computeNutrientGaps,
  hasMeaningfulGaps,
  localDateForTimestamp,
} from '@/lib/food/suggest/gaps';
import { suggestFoodForGaps } from '@/lib/food/suggest/providers';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Row = Record<string, unknown>;

function addDays(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function rowsForLocalDate(rows: Row[], date: string, fallbackTimezone: string): Row[] {
  return rows.filter(row => {
    if (typeof row.consumed_at !== 'string') return false;
    const timezone =
      typeof row.timezone === 'string' && row.timezone.trim().length > 0
        ? row.timezone
        : fallbackTimezone;
    return localDateForTimestamp(row.consumed_at, timezone) === date;
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let date: unknown;
  try {
    ({ date } = await request.json());
  } catch {
    return NextResponse.json(
      { error: 'A date is required.', reason: 'food_suggest_bad_date' },
      { status: 400 },
    );
  }

  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    return NextResponse.json(
      { error: 'A date is required.', reason: 'food_suggest_bad_date' },
      { status: 400 },
    );
  }

  try {
    const fromIso = `${addDays(date, -1)}T00:00:00.000Z`;
    const toIso = `${addDays(date, 1)}T23:59:59.999Z`;

    const [profileResult, targetsResult, foodResult, waterResult] = await Promise.all([
      supabase.from('profiles').select('timezone').eq('id', auth.user.id).maybeSingle(),
      supabase
        .from('nutrition_target_profiles')
        .select('calories_kcal, protein_g, fat_g, carbs_g, fiber_g, water_ml')
        .eq('user_id', auth.user.id)
        .maybeSingle(),
      supabase
        .from('food_entries')
        .select('consumed_at, timezone, calories_kcal, protein_g, total_fat_g, carbs_g, fiber_g')
        .eq('user_id', auth.user.id)
        .gte('consumed_at', fromIso)
        .lte('consumed_at', toIso),
      supabase
        .from('water_entries')
        .select('consumed_at, timezone, amount_ml')
        .eq('user_id', auth.user.id)
        .gte('consumed_at', fromIso)
        .lte('consumed_at', toIso),
    ]);

    if (profileResult.error) throw profileResult.error;
    if (targetsResult.error) throw targetsResult.error;
    if (foodResult.error) throw foodResult.error;
    if (waterResult.error) throw waterResult.error;

    const targetsRow = targetsResult.data as Row | null;
    if (!targetsRow) {
      return NextResponse.json(
        { error: 'Nutrition targets are not configured.', reason: 'food_suggest_no_targets' },
        { status: 400 },
      );
    }

    const profileRow = profileResult.data as Row | null;
    const timezone =
      typeof profileRow?.timezone === 'string' && profileRow.timezone.trim().length > 0
        ? profileRow.timezone
        : 'UTC';

    const foodRows = rowsForLocalDate((foodResult.data as Row[] | null) ?? [], date, timezone);
    const waterRows = rowsForLocalDate((waterResult.data as Row[] | null) ?? [], date, timezone);

    const totals = {
      caloriesKcal: foodRows.reduce((sum, row) => sum + toNumber(row.calories_kcal), 0),
      proteinG: foodRows.reduce((sum, row) => sum + toNumber(row.protein_g), 0),
      totalFatG: foodRows.reduce((sum, row) => sum + toNumber(row.total_fat_g), 0),
      carbsG: foodRows.reduce((sum, row) => sum + toNumber(row.carbs_g), 0),
      fiberG: foodRows.reduce((sum, row) => sum + toNumber(row.fiber_g), 0),
    };
    const waterTotalMl = waterRows.reduce((sum, row) => sum + toNumber(row.amount_ml), 0);

    const gaps = computeNutrientGaps(totals, waterTotalMl, {
      caloriesKcal: toNumber(targetsRow.calories_kcal),
      proteinG: toNumber(targetsRow.protein_g),
      fatG: toNumber(targetsRow.fat_g),
      carbsG: toNumber(targetsRow.carbs_g),
      fiberG: toNumber(targetsRow.fiber_g),
      waterMl: toNumber(targetsRow.water_ml),
    });

    if (!hasMeaningfulGaps(gaps)) {
      return NextResponse.json({ suggestions: [], gaps, reason: 'food_suggest_no_gap' });
    }

    const result = await suggestFoodForGaps(gaps);
    return NextResponse.json({ suggestions: result.suggestions, gaps, model: result.model });
  } catch (err) {
    Sentry.captureException(err);
    const reason = err instanceof Error && /^food_/.test(err.message) ? err.message : 'unknown';
    return NextResponse.json({ error: 'Food suggest failed.', reason }, { status: 502 });
  }
}
