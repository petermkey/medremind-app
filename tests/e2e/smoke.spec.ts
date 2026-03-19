import { expect, test, type Page } from '@playwright/test';

const e2eEmail = process.env.E2E_EMAIL;
const e2ePassword = process.env.E2E_PASSWORD;
const hasAuthCreds = Boolean(e2eEmail && e2ePassword);

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

test.describe('public smoke', () => {
  test('landing page renders and exposes auth entry points', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'MedRemind' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Get started/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Sign in/i })).toBeVisible();
  });

  test('unauthenticated /app redirects to login', async ({ page }) => {
    await page.goto('/app');
    await page.waitForURL('**/login');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });
});

test.describe('authenticated smoke (requires E2E_EMAIL and E2E_PASSWORD)', () => {
  test.skip(!hasAuthCreds, 'Set E2E_EMAIL and E2E_PASSWORD to run authenticated smoke tests.');

  test.describe.configure({ mode: 'serial' });

  test('auth bootstrap and app shell remain reachable after login', async ({ page }) => {
    await login(page);
    await finishOnboardingIfNeeded(page);
    await expect(page).toHaveURL('/app');

    await page.reload();
    await page.waitForURL('/app');
    await expect(page.getByText("Today's progress")).toBeVisible();
  });

  test('create + activate fixed-duration protocol smoke', async ({ page }) => {
    const protocolName = `E2E Protocol ${Date.now()}`;

    await login(page);
    await finishOnboardingIfNeeded(page);

    await page.goto('/app/protocols/new');
    await page.getByLabel('Protocol name').fill(protocolName);
    await page.getByRole('button', { name: /Fixed/i }).click();
    await page.getByLabel('Number of days').fill('3');
    await page.getByRole('button', { name: 'Next →' }).click();

    await page.getByLabel('Name').fill('Vitamin D3');
    await page.getByRole('button', { name: '+ Add item' }).click();
    await page.getByRole('button', { name: 'Review →' }).click();
    await page.getByRole('button', { name: 'Create & Activate' }).click();

    await page.waitForURL('/app/protocols');
    await expect(page.getByText(protocolName)).toBeVisible();
  });

  test('settings sync flush and sign-out path smoke', async ({ page }) => {
    await login(page);
    await finishOnboardingIfNeeded(page);

    await page.goto('/app/settings');
    await page.getByRole('button', { name: 'Flush sync now' }).click();
    await expect(page.getByText(/Syncing|All pending sync operations completed|Still pending/i)).toBeVisible();

    await page.getByRole('button', { name: 'Sign Out' }).click();
    await page.waitForURL('**/login');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });
});
