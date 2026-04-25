import { expect, test, type Page } from '@playwright/test';

const e2eEmail = process.env.E2E_EMAIL;
const e2ePassword = process.env.E2E_PASSWORD;
const hasAuthCreds = Boolean(e2eEmail && e2ePassword);

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
  await expect(page.getByRole('heading', { name: 'Food' })).toBeVisible();
  await waitForFoodEntriesLoad(page);
}

async function waitForFoodEntriesLoad(page: Page) {
  const entriesHeading = page.getByRole('heading', { name: 'Entries' });
  await expect(entriesHeading).toBeVisible();
  await expect(
    entriesHeading.locator('xpath=..').getByText('Loading…', { exact: true }),
  ).toBeHidden();
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

async function saveAnalyzedMealPhoto(
  page: Page,
  file: typeof pngFile,
  draft: typeof foodDraft,
) {
  const baselineTotals = await getTopDailyTotals(page);

  await uploadMealPhoto(page, file);

  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: draft.title })).toBeVisible();
  await expect(page.getByText(draft.summary)).toBeVisible();
  await expect(page.getByText('Greek yogurt')).toBeVisible();
  await expect(page.getByText(String(draft.nutrients.caloriesKcal))).toBeVisible();
  await expect(page.getByText(`${draft.nutrients.proteinG}g`)).toBeVisible();

  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('Draft', { exact: true })).not.toBeVisible();
  await expect(page.getByRole('heading', { name: draft.title })).toBeVisible();
  await expect(page.getByText('Photo · 88% confidence')).toBeVisible();
  await expect(page.getByText('Greek yogurt')).toBeVisible();
  await expect.poll(() => getTopDailyTotals(page)).toEqual({
    entryCount: baselineTotals.entryCount + 1,
    caloriesKcal: baselineTotals.caloriesKcal + draft.nutrients.caloriesKcal,
    proteinG: baselineTotals.proteinG + draft.nutrients.proteinG,
    carbsG: baselineTotals.carbsG + draft.nutrients.carbsG,
    totalFatG: baselineTotals.totalFatG + draft.nutrients.totalFatG,
  });
}

async function getTopDailyTotals(page: Page) {
  const topTotals = page.locator('.flex-shrink-0').filter({
    has: page.getByRole('heading', { name: 'Food' }),
  }).first();

  await expect(topTotals).toBeVisible();

  const parseNumber = async (locator: ReturnType<Page['locator']>) => {
    const text = await locator.innerText();
    return Number(text.replace(/[^\d.-]/g, ''));
  };
  const nutrientValue = (label: string) => parseNumber(
    topTotals.locator('.grid').first().locator(':scope > div').filter({
      has: page.getByText(label, { exact: true }),
    }).locator('div').first(),
  );

  return {
    entryCount: await parseNumber(topTotals.getByText(/^\d+ entries$/)),
    caloriesKcal: await nutrientValue('kcal'),
    proteinG: await nutrientValue('Protein'),
    carbsG: await nutrientValue('Carbs'),
    totalFatG: await nutrientValue('Fat'),
  };
}

test.describe('food diary (requires E2E_EMAIL and E2E_PASSWORD)', () => {
  test.skip(!hasAuthCreds, 'Set E2E_EMAIL and E2E_PASSWORD to run food diary tests.');

  test.describe.configure({ mode: 'serial' });

  const supportedPhotoFormats = [
    { label: 'PNG', file: pngFile },
    { label: 'JPEG', file: jpegFile },
    { label: 'WebP', file: webpFile },
  ] as const;

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
