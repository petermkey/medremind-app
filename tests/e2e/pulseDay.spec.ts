import { expect, test, type Page } from '@playwright/test';

const e2eEmail = process.env.E2E_EMAIL;
const e2ePassword = process.env.E2E_PASSWORD;
const hasAuthCreds = Boolean(e2eEmail && e2ePassword);

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

const summaryFixture = {
  connected: true,
  lastSyncAt: new Date().toISOString(),
  battery: null,
  days: Array.from({ length: 10 }, (_, index) => ({
    localDate: isoDaysAgo(9 - index),
    sleepScore: 80,
    readinessScore: 75,
    deepSleepMinutes: 85,
    nonWearMinutes: 0,
  })),
};

const pulseBase = Date.parse('2026-07-16T21:00:00.000Z');
const pulseFixture = {
  date: '2026-07-17',
  startIso: '2026-07-16T21:00:00.000Z',
  endIso: '2026-07-17T21:00:00.000Z',
  points: Array.from({ length: 48 }, (_, index) => ({
    ts: new Date(pulseBase + index * 30 * 60_000).toISOString(),
    bpm: 58 + (index % 20),
  })),
  tags: [
    { ts: '2026-07-17T06:30:00.000Z', kind: 'caffeine', tagType: 'tag_generic_caffeine', comment: 'Double espresso' },
  ],
  doses: [
    { ts: '2026-07-17T08:00:00.000Z', label: 'Vitamin D3' },
  ],
};

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(e2eEmail!);
  await page.getByLabel('Password').fill(e2ePassword!);
  const tokenResponse = page.waitForResponse(response => (
    response.url().includes('/auth/v1/token') && response.status() === 200
  ));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await tokenResponse;
}

async function stubSupabaseReads(page: Page) {
  await page.route('**/auth/v1/user', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'e2e-profile',
        aud: 'authenticated',
        role: 'authenticated',
        email: e2eEmail,
        email_confirmed_at: '2026-01-01T00:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
        app_metadata: {},
        user_metadata: { name: 'E2E User' },
      }),
    });
  });

  await page.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET') {
      await route.continue();
      return;
    }

    const url = new URL(request.url());
    const table = url.pathname.split('/').pop();
    const wantsObject = request.headers().accept?.includes('vnd.pgrst.object+json') ?? false;

    if (table === 'profiles') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'content-range': '0-0/1' },
        body: JSON.stringify({
          id: 'e2e-profile',
          name: 'E2E User',
          timezone: 'UTC',
          onboarded: true,
          age_range: null,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': '0-0/0' },
      body: JSON.stringify(wantsObject ? null : []),
    });
  });
}

test.describe('Pulse Day (requires E2E_EMAIL and E2E_PASSWORD)', () => {
  test.skip(!hasAuthCreds, 'Set E2E_EMAIL and E2E_PASSWORD to run the Pulse Day E2E.');

  test('renders the intraday chart and shows tooltips for tag and dose markers', async ({ page }) => {
    await stubSupabaseReads(page);
    await page.route('**/api/health/oura/summary*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(summaryFixture),
      });
    });
    await page.route('**/api/health/oura/heartrate-day*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(pulseFixture),
      });
    });

    await login(page);
    await page.goto('/app/progress?tab=oura');

    await expect(page.getByRole('heading', { name: 'Пульс дня' })).toBeVisible();
    await expect(page.getByTestId('pulse-day-chart')).toBeVisible();

    const markers = page.getByTestId('pulse-marker');
    await expect(markers).toHaveCount(2);

    await markers.nth(0).click();
    await expect(page.getByText('Caffeine - Double espresso', { exact: false })).toBeVisible();

    await markers.nth(1).click();
    await expect(page.getByText('Vitamin D3 · dose taken', { exact: false })).toBeVisible();
  });
});
