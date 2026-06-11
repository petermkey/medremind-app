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
    if (await skip.isVisible()) await skip.click();
  }
  if (page.url().includes('/onboarding')) {
    const getStarted = page.getByRole('button', { name: 'Get started →' });
    if (await getStarted.isVisible()) await getStarted.click();
  }
  await page.waitForURL('/app', { timeout: 30_000 });
}

async function ensureAuthenticated(page: Page) {
  if (hasAuthCreds) {
    await login(page);
    await finishOnboardingIfNeeded(page);
    return;
  }
  const email = `e2e-${Date.now()}@example.com`;
  const password = 'E2ePassword123!';
  await page.goto('/register');
  await page.getByLabel('Full name').fill('E2E Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/(app|onboarding)(\/|$)/, { timeout: 30_000 });
  await finishOnboardingIfNeeded(page);
}

async function waitForSyncFlushed(page: Page) {
  // The outbox holds the fallback op until the primary fire-and-forget sync
  // settles, so an empty live queue means the take command reached Supabase.
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('medremind-sync-outbox-v1');
    if (!raw) return true;
    try {
      const queue = JSON.parse(raw) as Array<{ dead?: boolean }>;
      return Array.isArray(queue) && queue.filter(item => !item.dead).length === 0;
    } catch {
      return true;
    }
  }, { timeout: 20_000 });
}

test.describe('dose status persistence', () => {
  test('taken status survives a full reload (cloud round-trip)', async ({ page }) => {
    await ensureAuthenticated(page);

    // Create & activate a protocol with one daily med so today has a dose.
    const name = `PersistTest ${Date.now()}`;
    await page.goto('/app/protocols/new');
    await page.getByLabel('Protocol name').fill(name);
    await page.getByRole('button', { name: /Fixed/i }).click();
    await page.getByLabel('Number of days').fill('3');
    await page.getByRole('button', { name: 'Next →' }).click();
    await page.getByLabel('Name').fill('Persist Med');
    await page.getByRole('button', { name: '+ Add item' }).click();
    await page.getByRole('button', { name: 'Review →' }).click();
    await page.getByRole('button', { name: 'Create & Activate' }).click();
    await page.waitForURL('/app/protocols');

    // Mark the dose as taken on today's view.
    await page.goto('/app');
    const takeButton = page.getByRole('button', { name: 'Mark as taken' }).first();
    await expect(takeButton).toBeVisible({ timeout: 20_000 });
    await takeButton.click();
    await expect(
      page.getByRole('button', { name: 'Already marked as taken' }).first(),
    ).toBeVisible({ timeout: 10_000 });

    await waitForSyncFlushed(page);
    // Let the in-flight realtime command settle before the boot pull replaces state.
    await page.waitForTimeout(2_000);

    // Reload: the app layout re-pulls the whole store from Supabase.
    await page.reload();
    await page.waitForURL(/\/app/, { timeout: 30_000 });
    await expect(
      page.getByRole('button', { name: 'Already marked as taken' }).first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('removed dose stays removed after reload', async ({ page }) => {
    await ensureAuthenticated(page);
    const name = `RemoveTest ${Date.now()}`;
    await page.goto('/app/protocols/new');
    await page.getByLabel('Protocol name').fill(name);
    await page.getByRole('button', { name: /Fixed/i }).click();
    await page.getByLabel('Number of days').fill('3');
    await page.getByRole('button', { name: 'Next →' }).click();
    await page.getByLabel('Name').fill('Remove Med');
    await page.getByRole('button', { name: '+ Add item' }).click();
    await page.getByRole('button', { name: 'Review →' }).click();
    await page.getByRole('button', { name: 'Create & Activate' }).click();
    await page.waitForURL('/app/protocols');

    await page.goto('/app');
    await expect(page.getByRole('button', { name: 'Mark as taken' }).first()).toBeVisible({ timeout: 20_000 });
    const before = await page.evaluate(() => {
      const store = (window as unknown as { __medremindStore: { getState(): { scheduledDoses: { id: string; scheduledDate: string }[]; removeDose(id: string): void } } }).__medremindStore;
      const state = store.getState();
      const today = new Date().toISOString().slice(0, 10);
      const dose = state.scheduledDoses.find(d => d.scheduledDate === today);
      if (dose) state.removeDose(dose.id);
      return store.getState().scheduledDoses.length;
    });
    await waitForSyncFlushed(page);
    await page.waitForTimeout(2_000);
    await page.reload();
    await page.waitForURL(/\/app/, { timeout: 30_000 });
    // wait for the boot pull to finish hydrating
    await expect(page.getByRole('button', { name: /Mark as taken|Already marked as taken/ }).first()).toBeVisible({ timeout: 30_000 });
    const after = await page.evaluate(() =>
      (window as unknown as { __medremindStore: { getState(): { scheduledDoses: unknown[] } } })
        .__medremindStore.getState().scheduledDoses.length,
    );
    expect(after).toBeLessThan(before);
  });
});
