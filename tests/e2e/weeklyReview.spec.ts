import { expect, test, type Page } from '@playwright/test';

const e2eEmail = process.env.E2E_EMAIL;
const e2ePassword = process.env.E2E_PASSWORD;
const hasAuthCreds = Boolean(e2eEmail && e2ePassword);

test.skip(!hasAuthCreds, 'E2E credentials not configured');

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(e2eEmail!);
  await page.getByLabel('Password').fill(e2ePassword!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(app|onboarding)(\/|$)/, { timeout: 30_000 });
}

const REVIEW_STUB = {
  reviews: [
    {
      id: '9df9f6a2-0000-4000-8000-000000000001',
      weekStart: '2026-07-06',
      model: 'mock-weekly-review',
      createdAt: '2026-07-13T06:00:00.000Z',
      payload: {
        schemaVersion: 'weekly-review-v1',
        highlights: ['Белок в среднем 92 г/день', 'Адхиренс 86%', 'HRV +6 мс к прошлой неделе'],
        eatingPatterns: [{ title: 'Поздние ужины', detail: '3 дня приём пищи после 21:00.' }],
        stackAdherence: { summary: 'Принято 36 из 42 доз (86%). Слабый день — суббота.' },
        ouraLinkage: ['Средний сон вырос на 4 балла на фоне более коротких пищевых окон.'],
        actions: [
          { title: 'Ужин до 21:00', detail: 'В будни закрывать пищевое окно до 21:00.' },
          { title: 'Вода в выходные', detail: 'Держать не меньше 1.5 л в сб и вс.' },
        ],
      },
    },
  ],
};

test('stored weekly review renders section-by-section on Progress', async ({ page }) => {
  await page.route('**/api/insights/weekly-review', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REVIEW_STUB) }),
  );
  await login(page);
  await page.goto('/app/progress');

  const section = page.getByTestId('weekly-review-section');
  await expect(section).toBeVisible({ timeout: 15_000 });
  await expect(section).toContainText('Weekly review');
  await expect(section).toContainText('Белок в среднем 92 г/день');
  await expect(section).toContainText('Поздние ужины');
  await expect(section).toContainText('Принято 36 из 42 доз (86%)');
  await expect(section).toContainText('Ужин до 21:00');
  await expect(section).toContainText('This is not medical advice');
});

test('settings: weekly-review toggle replaced the email-digest block', async ({ page }) => {
  await login(page);
  await page.goto('/app/settings');
  await expect(page.getByText('Weekly AI review')).toBeVisible();
  await expect(page.getByText('Email digest')).toHaveCount(0);
  await expect(page.getByText('Daily digest time')).toHaveCount(0);
});
