import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const e2eEmail = process.env.E2E_EMAIL;
const e2ePassword = process.env.E2E_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const hasE2eEnv = Boolean(e2eEmail && e2ePassword && supabaseUrl && supabaseAnonKey);

const ENTRY_TITLE = 'E2E EW Meal';

const windowDraft = {
  title: ENTRY_TITLE,
  summary: 'Buckwheat with chicken for the eating-window test.',
  mealLabel: 'lunch',
  components: [
    {
      name: 'Buckwheat with chicken',
      category: 'grain',
      estimatedQuantity: 1,
      estimatedUnit: 'bowl',
      gramsEstimate: 300,
      confidence: 0.9,
    },
  ],
  nutrients: { caloriesKcal: 450, proteinG: 35, totalFatG: 10, carbsG: 55, fiberG: 5 },
  uncertainties: [],
  estimationConfidence: 0.9,
  model: 'e2e-food-analysis',
  schemaVersion: 'food-analysis-v1',
};

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(e2eEmail!);
  await page.getByLabel('Password').fill(e2ePassword!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(app|onboarding)(\/|$)/, { timeout: 30_000 });
}

async function finishOnboardingIfNeeded(page: Page) {
  if (!page.url().includes('/onboarding')) return;

  const nameInput = page.getByLabel('Your name');
  if (await nameInput.isVisible()) {
    await nameInput.fill('E2E User');
    await page.getByRole('button', { name: 'Continue →' }).click();
  }

  const skip = page.getByRole('button', { name: 'Skip for now' });
  if (page.url().includes('/onboarding') && await skip.isVisible()) {
    await skip.click();
  }

  const getStarted = page.getByRole('button', { name: 'Get started →' });
  if (page.url().includes('/onboarding') && await getStarted.isVisible()) {
    await getStarted.click();
  }

  await page.waitForURL('/app', { timeout: 30_000 });
}

async function ensureNutritionTargetProfile(page: Page) {
  await expect(
    page.getByRole('heading', { name: /^(Food setup|Food)$/ }),
  ).toBeVisible({ timeout: 30_000 });

  if (!(await page.getByRole('heading', { name: 'Food setup' }).isVisible())) return;

  await page.getByLabel('Age').fill('35');
  await page.getByLabel('Weight').fill('80');
  await page.getByLabel('Height').fill('180');
  await page.getByRole('button', { name: 'Calculate targets' }).click();
  await expect(page.getByRole('heading', { name: 'Daily targets' })).toBeVisible();
  await page.getByLabel('Calories').fill('2400');
  await page.getByLabel('Protein').fill('150');
  await page.getByLabel('Fat').fill('80');
  await page.getByLabel('Carbs').fill('250');
  await page.getByLabel('Fiber').fill('35');
  await page.getByLabel('Water').fill('2700');
  await page.getByRole('button', { name: 'Save targets' }).click();
  await expect(page.getByRole('heading', { name: 'Food' })).toBeVisible();
}

async function loginAndOpenFood(page: Page) {
  await login(page);
  await finishOnboardingIfNeeded(page);
  await page.goto('/app/food');
  await ensureNutritionTargetProfile(page);
  await expect(page.getByRole('heading', { name: 'Entries' })).toBeVisible();
}

async function mockFoodTextAnalysis(page: Page) {
  await page.route('**/api/food/analyze-text', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ draft: windowDraft }),
    });
  });
}

async function deleteTestEntries() {
  const supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error: signInError } = await supabase.auth.signInWithPassword({
    email: e2eEmail!,
    password: e2ePassword!,
  });
  if (signInError || !data.user) {
    throw new Error(`Unable to authenticate E2E cleanup client: ${signInError?.message ?? 'missing user'}`);
  }

  const { error } = await supabase
    .from('food_entries')
    .delete()
    .eq('user_id', data.user.id)
    .eq('title', ENTRY_TITLE);
  if (error) throw error;
  await supabase.auth.signOut();
}

test.describe('eating window card', () => {
  test.skip(
    !hasE2eEnv,
    'Set E2E_EMAIL, E2E_PASSWORD, NEXT_PUBLIC_SUPABASE_URL, and NEXT_PUBLIC_SUPABASE_ANON_KEY to run eating-window E2E tests.',
  );

  test.beforeEach(async () => {
    await deleteTestEntries();
  });

  test.afterEach(async () => {
    await deleteTestEntries();
  });

  test('logging a meal shows the eating-window card and links to 7-day averages', async ({
    page,
  }) => {
    await mockFoodTextAnalysis(page);
    await loginAndOpenFood(page);

    await page.getByLabel('Describe your meal').fill('buckwheat with chicken');
    await page.getByRole('button', { name: 'Analyze' }).click();
    await expect(page.getByRole('heading', { name: ENTRY_TITLE })).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByText('Eating window', { exact: true })).toBeVisible();
    await expect(page.getByText('→').first()).toBeVisible();
    await expect(page.getByText(/≤10h streak: \d+ days?/)).toBeVisible();

    await page.getByRole('link', { name: '7-day averages →' }).click();
    await page.waitForURL('**/app/insights');
    await expect(page.getByRole('heading', { name: 'Insights' })).toBeVisible();
  });
});
