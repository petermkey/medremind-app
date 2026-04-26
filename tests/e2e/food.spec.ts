import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const e2eEmail = process.env.E2E_EMAIL;
const e2ePassword = process.env.E2E_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const hasE2eEnv = Boolean(e2eEmail && e2ePassword && supabaseUrl && supabaseAnonKey);
const e2eFoodTitlePrefixes = ['E2E ', 'Cancelled E2E '] as const;
const createdWaterEntryIds = new Set<string>();

type SupabaseE2eClient = ReturnType<typeof createClient>;
type NutritionTargetProfileRow = Record<string, unknown>;

const foodDraft = {
  title: 'E2E Photo Meal',
  summary: 'Greek yogurt with berries and granola.',
  mealLabel: 'breakfast',
  components: [
    {
      name: 'Greek yogurt',
      category: 'dairy',
      estimatedQuantity: 1,
      estimatedUnit: 'bowl',
      gramsEstimate: 180,
      confidence: 0.91,
      notes: 'Plain yogurt base.',
    },
    {
      name: 'Mixed berries',
      category: 'fruit',
      estimatedQuantity: 0.5,
      estimatedUnit: 'cup',
      gramsEstimate: 75,
      confidence: 0.83,
    },
  ],
  nutrients: {
    caloriesKcal: 321,
    proteinG: 22,
    totalFatG: 8,
    carbsG: 41,
    fiberG: 6,
    sugarsG: 18,
    sodiumMg: 95,
  },
  uncertainties: ['Granola portion estimated from visible volume.'],
  estimationConfidence: 0.88,
  model: 'e2e-food-analysis',
  schemaVersion: 'food-analysis-v1',
};

const pngFile = {
  name: 'meal.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
  ),
};

const jpegFile = {
  name: 'meal.jpg',
  mimeType: 'image/jpeg',
  buffer: Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Al//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EFBABAQAAAAAAAAAAAAAAAAAAARD/2gAIAQEAAT8QH//Z',
    'base64',
  ),
};

const webpFile = {
  name: 'meal.webp',
  mimeType: 'image/webp',
  buffer: Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AA/vuUAAA=', 'base64'),
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

  if (page.url().includes('/onboarding')) {
    const skip = page.getByRole('button', { name: 'Skip for now' });
    if (await skip.isVisible()) {
      await skip.click();
    }
  }

  if (page.url().includes('/onboarding')) {
    const getStarted = page.getByRole('button', { name: 'Get started →' });
    if (await getStarted.isVisible()) {
      await getStarted.click();
    }
  }

  await page.waitForURL('/app', { timeout: 30_000 });
}

async function loginAndOpenFood(page: Page) {
  await login(page);
  await finishOnboardingIfNeeded(page);
  await page.goto('/app/food');
  await ensureNutritionTargetProfile(page);
  await waitForFoodEntriesLoad(page);
}

async function waitForFoodEntriesLoad(page: Page) {
  const entriesHeading = page.getByRole('heading', { name: 'Entries' });
  await expect(entriesHeading).toBeVisible();
  await expect(
    entriesHeading.locator('xpath=..').getByText('Loading...', { exact: true }),
  ).toBeHidden();
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

async function cleanupE2eFoodEntries(supabase: SupabaseE2eClient, userId: string) {
  for (const prefix of e2eFoodTitlePrefixes) {
    const { error } = await supabase
      .from('food_entries')
      .delete()
      .eq('user_id', userId)
      .like('title', `${prefix}%`);
    if (error) {
      throw new Error(`Unable to clean up E2E food entries with prefix ${prefix}: ${error.message}`);
    }
  }
}

async function cleanupObservedWaterEntries(supabase: SupabaseE2eClient, userId: string) {
  if (createdWaterEntryIds.size === 0) return;

  const ids = Array.from(createdWaterEntryIds);
  const { error } = await supabase
    .from('water_entries')
    .delete()
    .eq('user_id', userId)
    .in('id', ids);
  if (error) {
    throw new Error(`Unable to clean up observed E2E water entries: ${error.message}`);
  }
  createdWaterEntryIds.clear();
}

async function deleteNutritionTargetProfile(supabase: SupabaseE2eClient, userId: string) {
  const { error } = await supabase.from('nutrition_target_profiles').delete().eq('user_id', userId);
  if (error) throw new Error(`Unable to delete E2E nutrition target profile: ${error.message}`);
}

async function loadNutritionTargetProfileRow(supabase: SupabaseE2eClient, userId: string) {
  const { data, error } = await supabase
    .from('nutrition_target_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Unable to load E2E nutrition target profile: ${error.message}`);
  return data as NutritionTargetProfileRow | null;
}

async function restoreNutritionTargetProfile(
  supabase: SupabaseE2eClient,
  profile: NutritionTargetProfileRow | null,
) {
  if (!profile) return;
  const { error } = await supabase
    .from('nutrition_target_profiles')
    .upsert(profile, { onConflict: 'user_id' });
  if (error) throw new Error(`Unable to restore E2E nutrition target profile: ${error.message}`);
}

async function withAuthenticatedSupabaseClient<T>(
  callback: (supabase: SupabaseE2eClient, userId: string) => Promise<T>,
) {
  const { supabase, userId } = await getAuthenticatedSupabaseClient();
  try {
    return await callback(supabase, userId);
  } finally {
    await supabase.auth.signOut();
  }
}

async function cleanupE2eData() {
  await withAuthenticatedSupabaseClient(async (supabase, userId) => {
    await cleanupE2eFoodEntries(supabase, userId);
    await cleanupObservedWaterEntries(supabase, userId);
  });
}

async function deleteNutritionTargetProfileForSetupTest() {
  return withAuthenticatedSupabaseClient(async (supabase, userId) => {
    const existingProfile = await loadNutritionTargetProfileRow(supabase, userId);
    await deleteNutritionTargetProfile(supabase, userId);
    return existingProfile;
  });
}

async function restoreNutritionTargetProfileAfterSetupTest(profile: NutritionTargetProfileRow | null) {
  if (!profile) return;
  await withAuthenticatedSupabaseClient(async supabase => {
    await restoreNutritionTargetProfile(supabase, profile);
  });
}

async function trackNextWaterEntrySave(page: Page) {
  // water_entries has no test marker beyond source=manual, so only delete IDs observed
  // from requests this run instead of deleting arbitrary shared manual hydration data.
  const requestPromise = page.waitForRequest(request => (
    request.method() === 'POST' &&
    request.url().includes('/rest/v1/water_entries')
  ));
  const responsePromise = page.waitForResponse(response => (
    response.request().method() === 'POST' &&
    response.url().includes('/rest/v1/water_entries')
  ));
  return async () => {
    const request = await requestPromise;
    const payload = request.postDataJSON() as { id?: unknown } | { id?: unknown }[] | null;
    const firstPayload = Array.isArray(payload) ? payload[0] : payload;
    if (typeof firstPayload?.id === 'string') {
      createdWaterEntryIds.add(firstPayload.id);
    }
    const response = await responsePromise;
    expect(response.ok(), `water_entries write failed with ${response.status()}`).toBeTruthy();
  };
}

async function waitForNextFoodEntrySave(page: Page) {
  const entryResponsePromise = page.waitForResponse(response => (
    response.request().method() === 'POST' &&
    response.url().includes('/rest/v1/food_entries')
  ));
  const componentsResponsePromise = page.waitForResponse(response => (
    response.request().method() === 'POST' &&
    response.url().includes('/rest/v1/food_entry_components')
  ));
  return async () => {
    const [entryResponse, componentsResponse] = await Promise.all([
      entryResponsePromise,
      componentsResponsePromise,
    ]);
    expect(entryResponse.ok(), `food_entries write failed with ${entryResponse.status()}`).toBeTruthy();
    expect(
      componentsResponse.ok(),
      `food_entry_components write failed with ${componentsResponse.status()}`,
    ).toBeTruthy();
  };
}

async function waitForNextFoodEntryDelete(page: Page) {
  const responsePromise = page.waitForResponse(response => (
    response.request().method() === 'DELETE' &&
    response.url().includes('/rest/v1/food_entries')
  ));
  return async () => {
    const response = await responsePromise;
    expect(response.ok(), `food_entries delete failed with ${response.status()}`).toBeTruthy();
  };
}

async function waitForNextNutritionTargetProfileSave(page: Page) {
  const responsePromise = page.waitForResponse(response => (
    response.request().method() === 'POST' &&
    response.url().includes('/rest/v1/nutrition_target_profiles')
  ));
  return async () => {
    const response = await responsePromise;
    expect(
      response.ok(),
      `nutrition_target_profiles write failed with ${response.status()}`,
    ).toBeTruthy();
  };
}

async function previousDayButtonNameFromDateStrip(page: Page) {
  const todayInStrip = page.getByRole('button', { name: /^Today\s+\d+$/ }).first();
  await expect(todayInStrip).toBeVisible();
  const previousDayButton = todayInStrip.locator('xpath=preceding-sibling::button[1]');
  await expect(previousDayButton).toBeVisible();
  return (await previousDayButton.innerText()).replace(/\s+/g, ' ').trim();
}

async function restoreOrEnsureTargetProfile(
  page: Page,
  originalProfile: NutritionTargetProfileRow | null,
) {
  if (originalProfile) {
    await restoreNutritionTargetProfileAfterSetupTest(originalProfile);
    return;
  }

  await ensureNutritionTargetProfile(page);
}

async function completeNutritionSetup(page: Page) {
  await expect(page.getByRole('heading', { name: 'Food setup' })).toBeVisible();
  await page.getByLabel('Age').fill('35');
  await page.getByLabel('Weight').fill('82');
  await page.getByLabel('Height').fill('178');
  await page.getByLabel('Sex').selectOption('male');
  await page.getByLabel('Activity').selectOption('moderate');
  await page.getByLabel('Body fat range').selectOption('15-20%');
  await page.getByLabel('Goal').selectOption('stabilization');
  await page.getByRole('button', { name: 'Calculate targets' }).click();

  await expect(page.getByRole('heading', { name: 'Daily targets' })).toBeVisible();
  await page.getByLabel('Calories').fill('2400');
  await page.getByLabel('Protein').fill('150');
  await page.getByLabel('Fat').fill('80');
  await page.getByLabel('Carbs').fill('250');
  await page.getByLabel('Fiber').fill('35');
  await page.getByLabel('Water').fill('2700');
  const waitForTargetSave = await waitForNextNutritionTargetProfileSave(page);
  await page.getByRole('button', { name: 'Save targets' }).click();
  await waitForTargetSave();
}

async function ensureNutritionTargetProfile(page: Page) {
  await expect(
    page.getByRole('heading', { name: /^(Food setup|Food)$/ }),
  ).toBeVisible({ timeout: 30_000 });

  if (await page.getByRole('heading', { name: 'Food setup' }).isVisible()) {
    await completeNutritionSetup(page);
  }

  await expect(page.getByRole('heading', { name: 'Food' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Targets' })).toBeVisible();
  await expect(page.getByText('Calories', { exact: true }).first()).toBeVisible();
}

async function mockFoodAnalysis(page: Page, draft = foodDraft) {
  await page.route('**/api/food/analyze-photo', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ draft }),
    });
  });
}

async function uploadMealPhoto(page: Page, file = pngFile) {
  await page.locator('input[type="file"]').setInputFiles(file);
}

function foodCardByTitle(page: Page, title: string) {
  return page.locator('.rounded-2xl').filter({
    has: page.getByRole('heading', { name: title, exact: true }),
  });
}

function savedEntryCardByTitle(page: Page, title: string) {
  return page.getByRole('heading', { name: title, exact: true }).locator(
    'xpath=ancestor::div[contains(@class, "relative") and contains(@class, "overflow-hidden")][1]',
  );
}

async function expandSavedEntry(page: Page, title: string) {
  const card = savedEntryCardByTitle(page, title);
  await card.locator('[role="button"]').filter({
    has: page.getByRole('heading', { name: title, exact: true }),
  }).click();
  await expect(card.getByText(foodDraft.components[0].name)).toBeVisible();
}

async function revealSwipeDeleteAction(card: ReturnType<typeof savedEntryCardByTitle>) {
  const box = await card.boundingBox();
  if (!box) throw new Error('Unable to locate saved entry card for swipe delete.');
  const pointerId = 1;
  const y = box.y + Math.min(48, box.height / 2);
  const startX = box.x + box.width - 16;
  const endX = startX - 96;

  await card.dispatchEvent('pointerdown', {
    pointerId,
    pointerType: 'touch',
    clientX: startX,
    clientY: y,
    bubbles: true,
  });
  await card.dispatchEvent('pointerup', {
    pointerId,
    pointerType: 'touch',
    clientX: endX,
    clientY: y,
    bubbles: true,
  });
}

async function saveAnalyzedMealPhoto(
  page: Page,
  file: typeof pngFile,
  draft: typeof foodDraft,
) {
  const baselineTotals = await getDailyTargetProgress(page);

  await uploadMealPhoto(page, file);

  const draftCard = foodCardByTitle(page, draft.title);
  await expect(draftCard.getByText('Draft', { exact: true })).toBeVisible();
  await expect(draftCard.getByRole('heading', { name: draft.title, exact: true })).toBeVisible();
  await expect(draftCard.getByText(draft.summary)).toBeVisible();
  await expect(draftCard.getByText('Greek yogurt')).toBeVisible();
  await expect(draftCard.getByText(String(draft.nutrients.caloriesKcal))).toBeVisible();
  await expect(draftCard.getByText(`${draft.nutrients.proteinG}g`)).toBeVisible();

  const waitForFoodEntrySave = await waitForNextFoodEntrySave(page);
  await page.getByRole('button', { name: 'Save' }).click();
  await waitForFoodEntrySave();

  await expect(draftCard.getByText('Draft', { exact: true })).not.toBeVisible();
  const savedEntryCard = foodCardByTitle(page, draft.title);
  await expect(savedEntryCard.getByRole('heading', { name: draft.title, exact: true })).toBeVisible();
  await expect(savedEntryCard.getByText('Photo · 88% confidence')).toBeVisible();
  await expect(savedEntryCard.getByText('Greek yogurt')).not.toBeVisible();
  await expandSavedEntry(page, draft.title);
  await expect(savedEntryCard.getByText(draft.summary)).toBeVisible();
  await expect.poll(() => getDailyTargetProgress(page)).toEqual({
    entryCount: baselineTotals.entryCount + 1,
    caloriesKcal: baselineTotals.caloriesKcal + draft.nutrients.caloriesKcal,
    proteinG: baselineTotals.proteinG + draft.nutrients.proteinG,
    carbsG: baselineTotals.carbsG + draft.nutrients.carbsG,
    totalFatG: baselineTotals.totalFatG + draft.nutrients.totalFatG,
  });
}

async function getDailyTargetProgress(page: Page) {
  const parseNumber = async (locator: ReturnType<Page['locator']>) => {
    const text = await locator.innerText();
    return Number(text.replace(/[^\d.-]/g, ''));
  };
  const consumedFromTargetCard = async (label: string) => {
    const card = page.locator('.rounded-2xl').filter({
      has: page.getByText(label, { exact: true }),
      hasText: '/',
    }).first();
    await expect(card).toBeVisible();
    const text = await card.innerText();
    const match = text.match(/([\d,.]+)\s*\//);
    if (!match) throw new Error(`Unable to parse ${label} target card: ${text}`);
    return Number(match[1].replace(/,/g, ''));
  };

  return {
    entryCount: await parseNumber(page.getByText(/^\d+ entries$/).first()),
    caloriesKcal: await consumedFromTargetCard('Calories'),
    proteinG: await consumedFromTargetCard('Protein'),
    carbsG: await consumedFromTargetCard('Carbs'),
    totalFatG: await consumedFromTargetCard('Fat'),
  };
}

async function getWaterConsumedMl(page: Page) {
  const tracker = page.locator('.rounded-2xl').filter({
    has: page.getByText('Water', { exact: true }),
    has: page.getByRole('button', { name: '+250 ml' }),
  }).first();
  await expect(tracker).toBeVisible();
  const text = await tracker.innerText();
  const match = text.match(/([\d.]+)\s*(ml|L)\s*\//);
  if (!match) throw new Error(`Unable to parse water tracker: ${text}`);
  return match[2] === 'L' ? Number(match[1]) * 1000 : Number(match[1]);
}

test.describe('food diary (requires authenticated Supabase E2E env)', () => {
  test.skip(
    !hasE2eEnv,
    'Set E2E_EMAIL, E2E_PASSWORD, NEXT_PUBLIC_SUPABASE_URL, and NEXT_PUBLIC_SUPABASE_ANON_KEY to run food diary tests.',
  );

  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    await cleanupE2eData();
  });

  test.afterEach(async () => {
    await cleanupE2eData();
  });

  test.afterAll(async () => {
    await cleanupE2eData();
  });

  const supportedPhotoFormats = [
    { label: 'PNG', file: pngFile },
    { label: 'JPEG', file: jpegFile },
    { label: 'WebP', file: webpFile },
  ] as const;

  test('shows nutrition setup on first Food visit without a target profile and opens diary after saving targets', async ({
    page,
  }) => {
    const originalProfile = await deleteNutritionTargetProfileForSetupTest();

    try {
      await login(page);
      await finishOnboardingIfNeeded(page);
      await page.goto('/app/food');

      await expect(page.getByRole('heading', { name: 'Food setup', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Food', exact: true })).not.toBeVisible();

      await completeNutritionSetup(page);

      await expect(page.getByRole('heading', { name: 'Food' })).toBeVisible();
      await expect(page.getByText('Calories', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Water', { exact: true })).toBeVisible();
      await waitForFoodEntriesLoad(page);
    } finally {
      await restoreOrEnsureTargetProfile(page, originalProfile);
    }
  });

  for (const { label, file } of supportedPhotoFormats) {
    test(`analyzes a ${label} meal photo, saves the draft, and shows the entry in daily totals`, async ({
      page,
    }, testInfo) => {
      const uniqueSuffix = `${label.toLowerCase()}-${testInfo.workerIndex}-${Date.now()}`;
      const draft = {
        ...foodDraft,
        title: `E2E ${label} Photo Meal ${uniqueSuffix}`,
        summary: `${label} upload draft analysis ${uniqueSuffix}.`,
      };

      await mockFoodAnalysis(page, draft);
      await loginAndOpenFood(page);
      await saveAnalyzedMealPhoto(page, file, draft);
    });
  }

  test('shows compact food command bar without the standalone meal photo card', async ({ page }) => {
    await loginAndOpenFood(page);

    await expect(page.getByRole('button', { name: 'Capture' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Targets/ })).toBeVisible();
    await expect(page.getByText('Add a meal photo')).not.toBeVisible();
  });

  test('moves between yesterday and today with date-scoped diary entries', async ({ page }, testInfo) => {
    const uniqueSuffix = `date-${testInfo.workerIndex}-${Date.now()}`;
    const yesterdayDraft = {
      ...foodDraft,
      title: `E2E Yesterday Meal ${uniqueSuffix}`,
      summary: `Yesterday-only diary entry ${uniqueSuffix}.`,
    };

    await mockFoodAnalysis(page, yesterdayDraft);
    await loginAndOpenFood(page);

    const previousDayButtonName = await previousDayButtonNameFromDateStrip(page);
    const todayBaselineTotals = await getDailyTargetProgress(page);
    await page.getByRole('button', { name: previousDayButtonName }).click();
    await expect(page.getByRole('button', { name: 'Capture' })).toBeVisible();
    const yesterdayBaselineTotals = await getDailyTargetProgress(page);
    await saveAnalyzedMealPhoto(page, pngFile, yesterdayDraft);
    await expect(page.getByRole('heading', { name: yesterdayDraft.title, exact: true })).toBeVisible();
    const yesterdayTotalsAfterSave = {
      entryCount: yesterdayBaselineTotals.entryCount + 1,
      caloriesKcal: yesterdayBaselineTotals.caloriesKcal + yesterdayDraft.nutrients.caloriesKcal,
      proteinG: yesterdayBaselineTotals.proteinG + yesterdayDraft.nutrients.proteinG,
      carbsG: yesterdayBaselineTotals.carbsG + yesterdayDraft.nutrients.carbsG,
      totalFatG: yesterdayBaselineTotals.totalFatG + yesterdayDraft.nutrients.totalFatG,
    };
    await expect.poll(() => getDailyTargetProgress(page)).toEqual(yesterdayTotalsAfterSave);

    await page.getByRole('button', { name: 'Today' }).click();
    await expect(page.getByRole('heading', { name: yesterdayDraft.title, exact: true })).not.toBeVisible();
    await expect.poll(() => getDailyTargetProgress(page)).toEqual(todayBaselineTotals);

    await page.getByRole('button', { name: previousDayButtonName }).click();
    await expect(page.getByRole('heading', { name: yesterdayDraft.title, exact: true })).toBeVisible();
    await expect.poll(() => getDailyTargetProgress(page)).toEqual(yesterdayTotalsAfterSave);
  });

  test('quick-add water increases daily water progress', async ({ page }) => {
    await loginAndOpenFood(page);

    const baselineWaterMl = await getWaterConsumedMl(page);
    const trackWaterEntrySave = await trackNextWaterEntrySave(page);
    await page.getByRole('button', { name: '+250 ml' }).click();
    await trackWaterEntrySave();

    await expect.poll(() => getWaterConsumedMl(page)).toBe(baselineWaterMl + 250);
  });

  test('confirms delete, removes a food entry, and updates totals', async ({ page }, testInfo) => {
    const uniqueSuffix = `delete-${testInfo.workerIndex}-${Date.now()}`;
    const deleteDraft = {
      ...foodDraft,
      title: `E2E Delete Meal ${uniqueSuffix}`,
      summary: `Entry to delete ${uniqueSuffix}.`,
    };

    await mockFoodAnalysis(page, deleteDraft);
    await loginAndOpenFood(page);
    await saveAnalyzedMealPhoto(page, pngFile, deleteDraft);

    const totalsAfterSave = await getDailyTargetProgress(page);
    const entryCard = savedEntryCardByTitle(page, deleteDraft.title);
    await expect(entryCard.getByRole('button', { name: `Delete ${deleteDraft.title}` })).not.toBeVisible();

    await revealSwipeDeleteAction(entryCard);
    await entryCard.getByRole('button', { name: `Delete ${deleteDraft.title}` }).click();
    await expect(page.getByRole('heading', { name: 'Delete food entry?' })).toBeVisible();
    await expect(page.getByText(`${deleteDraft.title} will be removed from this diary.`)).toBeVisible();
    const waitForFoodEntryDelete = await waitForNextFoodEntryDelete(page);
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await waitForFoodEntryDelete();

    await expect(page.getByRole('heading', { name: deleteDraft.title, exact: true })).not.toBeVisible();
    await expect.poll(() => getDailyTargetProgress(page)).toEqual({
      entryCount: totalsAfterSave.entryCount - 1,
      caloriesKcal: totalsAfterSave.caloriesKcal - deleteDraft.nutrients.caloriesKcal,
      proteinG: totalsAfterSave.proteinG - deleteDraft.nutrients.proteinG,
      carbsG: totalsAfterSave.carbsG - deleteDraft.nutrients.carbsG,
      totalFatG: totalsAfterSave.totalFatG - deleteDraft.nutrients.totalFatG,
    });
  });

  test('cancels an analyzed draft without adding a diary entry', async ({ page }) => {
    const cancelledDraft = {
      ...foodDraft,
      title: `Cancelled E2E Meal ${Date.now()}`,
      summary: 'This draft should not be saved.',
    };

    await mockFoodAnalysis(page, cancelledDraft);
    await loginAndOpenFood(page);

    await uploadMealPhoto(page, pngFile);

    await expect(page.getByRole('heading', { name: cancelledDraft.title })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('heading', { name: cancelledDraft.title })).not.toBeVisible();
    await expect(page.getByText(cancelledDraft.summary)).not.toBeVisible();
  });
});
