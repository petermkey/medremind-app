import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const e2eEmail = process.env.E2E_EMAIL;
const e2ePassword = process.env.E2E_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const hasE2eEnv = Boolean(e2eEmail && e2ePassword && supabaseUrl && supabaseAnonKey);
const e2ePort = Number(process.env.E2E_PORT ?? 3200);
const e2eBaseUrl = process.env.E2E_BASE_URL ?? `http://localhost:${e2ePort}`;
const supabaseProjectRef = supabaseUrl ? new URL(supabaseUrl).hostname.split('.')[0] : '';
const authStorageKey = `sb-${supabaseProjectRef}-auth-token`;
const cookieChunkSize = 3180;

const SUGGESTION_TITLE = 'E2E Suggest Bowl';

const stubSuggestions = {
  suggestions: [
    {
      title: SUGGESTION_TITLE,
      description: 'A protein bowl to close the day.',
      rationale: 'Closes most of the remaining protein.',
      approxNutrients: { caloriesKcal: 420, proteinG: 38, fiberG: 9 },
    },
  ],
  gaps: { caloriesKcal: 8000, proteinG: 450, fatG: 180, carbsG: 700, fiberG: 180, waterMl: 7000 },
  model: 'e2e-stub',
};

const stubDraft = {
  title: SUGGESTION_TITLE,
  summary: 'A protein bowl to close the day.',
  mealLabel: 'dinner',
  components: [
    {
      name: 'Protein bowl',
      category: 'mixed',
      estimatedQuantity: 1,
      estimatedUnit: 'bowl',
      gramsEstimate: 350,
      confidence: 0.9,
    },
  ],
  nutrients: { caloriesKcal: 420, proteinG: 38, totalFatG: 12, carbsG: 40, fiberG: 9 },
  uncertainties: [],
  estimationConfidence: 0.9,
  model: 'e2e-food-analysis',
  schemaVersion: 'food-analysis-v1',
};

type TargetProfileRow = Record<string, unknown>;
type ProfileRow = Record<string, unknown>;

function cookieChunks(name: string, value: string): { name: string; value: string }[] {
  if (value.length < cookieChunkSize) return [{ name, value }];
  const chunks: { name: string; value: string }[] = [];
  for (let offset = 0; offset < value.length; offset += cookieChunkSize) {
    chunks.push({ name: `${name}.${chunks.length}`, value: value.slice(offset, offset + cookieChunkSize) });
  }
  return chunks;
}

function encodeCookieSession(session: unknown): string {
  return `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
}

async function installAuthenticatedSession(page: Page) {
  const supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: e2eEmail!,
    password: e2ePassword!,
  });
  if (error || !data.session) {
    throw new Error(`Unable to authenticate E2E browser session: ${error?.message ?? 'missing session'}`);
  }

  const cookieValue = encodeCookieSession(data.session);
  await page.context().addCookies(
    cookieChunks(authStorageKey, cookieValue).map(cookie => ({
      ...cookie,
      url: e2eBaseUrl,
      sameSite: 'Lax' as const,
      httpOnly: false,
      secure: e2eBaseUrl.startsWith('https://'),
    })),
  );
  await page.addInitScript(
    ({ key, session }) => {
      window.localStorage.setItem(key, JSON.stringify(session));
    },
    { key: authStorageKey, session: data.session },
  );
}

async function getAuthenticatedSupabaseClient() {
  const supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: e2eEmail!,
    password: e2ePassword!,
  });
  if (error || !data.user) {
    throw new Error(`Unable to authenticate E2E Supabase client: ${error?.message ?? 'missing user'}`);
  }
  return { supabase, userId: data.user.id };
}

async function seedLargeTargetProfile(): Promise<TargetProfileRow | null> {
  const { supabase, userId } = await getAuthenticatedSupabaseClient();
  const { data: previous, error: previousError } = await supabase
    .from('nutrition_target_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (previousError) throw previousError;

  const { error } = await supabase.from('nutrition_target_profiles').upsert(
    {
      user_id: userId,
      age_years: 35,
      sex: 'male',
      weight_kg: 80,
      height_cm: 180,
      activity_level: 'moderate',
      body_fat_range: 'unknown',
      goal_mode: 'stabilization',
      calories_kcal: 10000,
      protein_g: 500,
      fat_g: 250,
      carbs_g: 900,
      fiber_g: 200,
      water_ml: 8000,
      algorithm_version: 'e2e-close-the-gap',
    },
    { onConflict: 'user_id' },
  );
  if (error) throw error;
  return (previous as TargetProfileRow | null) ?? null;
}

async function seedProfileTimezone(): Promise<ProfileRow | null> {
  const { supabase, userId } = await getAuthenticatedSupabaseClient();
  const { data: previous, error: previousError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (previousError) throw previousError;

  const { error } = await supabase.from('profiles').update({ timezone: 'UTC' }).eq('id', userId);
  if (error) throw error;
  return (previous as ProfileRow | null) ?? null;
}

async function restoreTargetProfile(previous: TargetProfileRow | null) {
  const { supabase, userId } = await getAuthenticatedSupabaseClient();
  if (previous) {
    const { error } = await supabase.from('nutrition_target_profiles').upsert(previous, {
      onConflict: 'user_id',
    });
    if (error) throw error;
  } else {
    const { error } = await supabase.from('nutrition_target_profiles').delete().eq('user_id', userId);
    if (error) throw error;
  }
}

async function restoreProfile(previous: ProfileRow | null) {
  if (!previous) return;
  const { supabase } = await getAuthenticatedSupabaseClient();
  const { error } = await supabase.from('profiles').upsert(previous, { onConflict: 'id' });
  if (error) throw error;
}

test.describe('close the gap', () => {
  test.skip(!hasE2eEnv, 'E2E credentials are not configured');

  test('button opens stubbed suggestions and a tap prefills the analyze input', async ({ page }) => {
    const previousTargetProfile = await seedLargeTargetProfile();
    const previousProfile = await seedProfileTimezone();

    try {
      await page.route('**/api/food/suggest', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(stubSuggestions),
        });
      });
      await page.route('**/api/food/analyze-text', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ draft: stubDraft }),
        });
      });

      await installAuthenticatedSession(page);

      await page.goto('/app/food', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Food' })).toBeVisible({ timeout: 30_000 });

      const suggestButton = page.getByRole('button', { name: 'Close today’s gaps' });
      await expect(suggestButton).toBeVisible();
      await suggestButton.click();

      await expect(page.getByRole('heading', { name: 'Close today’s gaps' })).toBeVisible();
      await page.getByRole('button', { name: new RegExp(SUGGESTION_TITLE) }).click();

      await expect(page.getByLabel('Describe your meal')).toHaveValue(
        `${SUGGESTION_TITLE}. A protein bowl to close the day.`,
      );

      await page.getByRole('button', { name: 'Analyze' }).click();
      await expect(page.getByRole('heading', { name: SUGGESTION_TITLE })).toBeVisible();

      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.getByRole('heading', { name: SUGGESTION_TITLE })).toBeHidden();
    } finally {
      await restoreTargetProfile(previousTargetProfile);
      await restoreProfile(previousProfile);
    }
  });
});
