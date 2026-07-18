import { expect, test, type Page } from '@playwright/test';

const e2eEmail = process.env.E2E_EMAIL;
const e2ePassword = process.env.E2E_PASSWORD;
const hasAuthCreds = Boolean(e2eEmail && e2ePassword);

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

// 40 days of fully-populated summary data so every delta chip has the >=7
// prior values medianOfPreviousDays needs.
function buildDays(count = 40) {
  return Array.from({ length: count }, (_, index) => ({
    localDate: isoDaysAgo(count - 1 - index),
    sleepScore: 78 + (index % 5),
    readinessScore: 74 + (index % 6),
    activityScore: 70 + (index % 8),
    sleepAvgHrv: 42 + (index % 7),
    deepSleepMinutes: 80 + (index % 10),
    remSleepMinutes: 95 + (index % 12),
    sleepEfficiency: 90 + (index % 4),
    sleepLatencySeconds: 600 + (index % 5) * 60,
    minutesToFirstDeepSleep: 10 + (index % 6),
    deepSleepFirstThirdMinutes: 35 + (index % 8),
    hrvRecoveryDelta: 4 + (index % 5),
    restingHeartRate: 50 + (index % 4),
    respiratoryRate: 14.1,
    averageSpo2: 97 + (index % 2) * 0.4,
    breathingDisturbanceIndex: 3 + (index % 3),
    temperatureDeviation: index % 2 === 0 ? 0.1 : -0.1,
    temperatureTrendDeviation: index % 2 === 0 ? 0.05 : -0.05,
    steps: 8000 + index * 20,
    activeCalories: 480 + (index % 9) * 10,
    totalCalories: 2350 + (index % 9) * 15,
    stressHighSeconds: 1100 + (index % 5) * 30,
    recoveryHighSeconds: 5200 + (index % 5) * 40,
    vo2Max: 43,
    cardiovascularAge: 32,
    resilienceLevel: 'solid',
    nonWearMinutes: 0,
    hrvBalance: 'balanced',
    workoutCount: index % 2,
  }));
}

const summaryFixture = {
  connected: true,
  lastSyncAt: new Date().toISOString(),
  battery: { level: 82, charging: false, at: new Date().toISOString() },
  days: buildDays(),
};

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(e2eEmail!);
  await page.getByLabel('Password').fill(e2ePassword!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(app|onboarding)(\/|$)/, { timeout: 30_000 });
}

test.describe('Oura Sleep Lab (requires E2E_EMAIL and E2E_PASSWORD)', () => {
  test.skip(!hasAuthCreds, 'Set E2E_EMAIL and E2E_PASSWORD to run the Sleep Lab E2E.');

  test('night and day cards surface the sleep-lab metrics with explainers and trends', async ({ page }) => {
    await page.route('**/api/health/oura/summary*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(summaryFixture),
      });
    });

    await login(page);
    await page.goto('/app/progress?tab=oura');

    // Night card v2 rows are asserted via unique explainer copy because row
    // labels also appear as trend-chart titles.
    await expect(page.getByText('Share of time in bed actually spent asleep', { exact: false })).toBeVisible();
    await expect(page.getByText('How long it took to fall asleep', { exact: false })).toBeVisible();
    await expect(page.getByText('Deep sleep banked in the first third', { exact: false })).toBeVisible();
    await expect(page.getByText('Multi-day drift of night skin temperature', { exact: false })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Day recap' })).toBeVisible();
    await expect(page.getByText('HRV balance')).toBeVisible();
    await expect(page.getByText('balanced', { exact: true })).toBeVisible();
    await expect(page.getByText('Workouts')).toBeVisible();
    await expect(page.getByText('Active calories').first()).toBeVisible();
    await expect(page.getByText('Total calories')).toBeVisible();

    await expect(page.getByRole('img', { name: 'Sleep efficiency trend' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Sleep latency trend' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Deep sleep, first ⅓ trend' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Activity score trend' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Active calories trend' })).toBeVisible();
  });
});
