import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { NUTRIENT_LIMITS_VERSION } from '../../src/lib/nutrientBalance/limits';

const e2eEmail = process.env.E2E_EMAIL;
const e2ePassword = process.env.E2E_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasE2eEnv = Boolean(e2eEmail && e2ePassword && supabaseUrl && supabaseAnonKey && serviceRoleKey);

function localToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const seededPayload = {
  report: {
    version: NUTRIENT_LIMITS_VERSION,
    buckets: {
      deficits: [
        {
          nutrientKey: 'fiberG',
          label: 'Fiber',
          unit: 'g',
          foodAvgPerDay: 12,
          stackPerDay: 0,
          totalPerDay: 12,
          target: 35,
          ul: null,
          ulScope: 'total',
          pctOfTarget: 34,
          contributors: [],
          unverified: false,
        },
      ],
      covered: [
        {
          nutrientKey: 'omega3EpaDhaMg',
          label: 'Omega-3 (EPA+DHA)',
          unit: 'mg',
          foodAvgPerDay: 220,
          stackPerDay: 600,
          totalPerDay: 820,
          target: 250,
          ul: 5000,
          ulScope: 'supplemental',
          pctOfTarget: 328,
          contributors: [{ displayName: 'Omega-3', amountPerDay: 600, validationStatus: 'verified' }],
          unverified: false,
        },
      ],
      excess: [
        {
          nutrientKey: 'magnesiumMg',
          label: 'Magnesium',
          unit: 'mg',
          foodAvgPerDay: 200,
          stackPerDay: 300,
          totalPerDay: 500,
          target: 420,
          ul: 350,
          ulScope: 'supplemental',
          pctOfTarget: 119,
          contributors: [{ displayName: 'Mg glycinate', amountPerDay: 300, validationStatus: 'pending' }],
          unverified: true,
        },
      ],
    },
  },
  pendingItems: ['Collagen'],
  loggedDays: 9,
  insufficientFoodData: false,
  limitsVersion: NUTRIENT_LIMITS_VERSION,
};

async function resolveUserId(): Promise<string> {
  const supabase = createClient(supabaseUrl!, supabaseAnonKey!);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: e2eEmail!,
    password: e2ePassword!,
  });
  if (error || !data.user) throw error ?? new Error('no user');
  const userId = data.user.id;
  await supabase.auth.signOut();
  return userId;
}

function serviceClient() {
  return createClient(supabaseUrl!, serviceRoleKey!);
}

async function seedReport(userId: string) {
  const { error } = await serviceClient().from('nutrient_balance_reports').upsert(
    {
      user_id: userId,
      report_date: localToday(),
      payload: seededPayload,
      limits_version: NUTRIENT_LIMITS_VERSION,
    },
    { onConflict: 'user_id,report_date' },
  );
  if (error) throw error;
}

async function deleteReport(userId: string) {
  const { error } = await serviceClient()
    .from('nutrient_balance_reports')
    .delete()
    .eq('user_id', userId)
    .eq('report_date', localToday());
  if (error) throw error;
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(e2eEmail!);
  await page.getByLabel('Password').fill(e2ePassword!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(app|onboarding)(\/|$)/, { timeout: 30_000 });
}

test.describe('nutrient balance card', () => {
  test.skip(!hasE2eEnv, 'E2E credentials (incl. service role key) are not configured');
  let userId: string;

  test.beforeEach(async () => {
    userId = await resolveUserId();
    await seedReport(userId);
  });

  test.afterEach(async () => {
    await deleteReport(userId);
  });

  test('renders three buckets from a seeded report with chips and disclaimer', async ({ page }) => {
    await login(page);
    await page.goto('/app/progress');

    await expect(page.getByText('Nutrient Balance', { exact: true })).toBeVisible();
    await expect(page.getByText('Deficits', { exact: true })).toBeVisible();
    await expect(page.getByText('Covered / redundant', { exact: true })).toBeVisible();
    await expect(page.getByText('Possible excess', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /Magnesium/ }).click();
    await expect(page.getByText('Stack contribution')).toBeVisible();
    await expect(page.getByText('Upper limit (supplemental)')).toBeVisible();
    await expect(page.getByText('unverified').first()).toBeVisible();

    await expect(page.getByText(/Awaiting nutrient facts .*Collagen/)).toBeVisible();
    await expect(page.getByText(/not medical advice/)).toBeVisible();
  });
});
