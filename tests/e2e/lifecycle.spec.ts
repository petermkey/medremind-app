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

test.describe('protocol lifecycle invariants', () => {
  test.beforeEach(async ({ page }) => {
    await ensureAuthenticated(page);
  });

  test('lifecycle: create -> activate -> pause -> resume -> complete', async ({ page }) => {
    const name = `LifeTest ${Date.now()}`;
    
    // Create & Activate
    await page.goto('/app/protocols/new');
    await page.getByLabel('Protocol name').fill(name);
    await page.getByRole('button', { name: /Fixed/i }).click();
    await page.getByLabel('Number of days').fill('3');
    await page.getByRole('button', { name: 'Next →' }).click();
    await page.getByLabel('Name').fill('Test Med');
    await page.getByRole('button', { name: '+ Add item' }).click();
    await page.getByRole('button', { name: 'Review →' }).click();
    await page.getByRole('button', { name: 'Create & Activate' }).click();
    await page.waitForURL('/app/protocols');

    // Verify Active status
    const row = page.getByText(name);
    await expect(row).toBeVisible();
    await expect(page.getByText('active', { exact: false })).toBeVisible();

    // Go to details
    await page.click(`text=${name}`);
    await page.waitForURL(/\/app\/protocols\/.*/);

    // PAUSE
    await page.click('button:has-text("Pause")');
    await expect(page.getByText('paused', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause' })).not.toBeVisible();

    // RESUME
    await page.click('button:has-text("Resume")');
    await expect(page.getByText('active', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

    // COMPLETE
    await page.click('button:has-text("Complete")');
    await page.waitForTimeout(500); // Wait for transition
    await expect(page.getByText('completed', { exact: true })).toBeVisible();
    
    // Verify terminal state (Activate should be available for NEW instance, but old instance is terminal)
    await expect(page.getByRole('button', { name: 'Pause' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Complete' })).not.toBeVisible();
  });

  test('archival: delete protocol with history becomes archived', async ({ page }) => {
    const name = `ArchiveTest ${Date.now()}`;
    const uniqueItemName = `Med ${Date.now()}`;
    
    // 1. Create and Activate
    await page.goto('/app/protocols/new');
    await page.getByLabel('Protocol name').fill(name);
    await page.getByRole('button', { name: /Fixed/i }).click();
    await page.getByLabel('Number of days').fill('3');
    await page.getByRole('button', { name: 'Next →' }).click();
    await page.getByLabel('Name', { exact: true }).fill(uniqueItemName);
    await page.getByRole('button', { name: '+ Add item' }).click();
    await page.getByRole('button', { name: 'Review →' }).click();
    await page.getByRole('button', { name: 'Create & Activate' }).click();
    await page.waitForURL('/app/protocols');
    
    // Verify Active status
    const row = page.locator('div, a').filter({ hasText: name }).first();
    await expect(row).toBeVisible();

    // 2. Head to Schedule to see if doses were generated (client-side nav)
    // 2. Head to Schedule to see if doses were generated (client-side nav)
    await page.locator('nav a[href="/app"]').click();
    await page.waitForTimeout(2000); 

    // We need to click "Take"
    await page.waitForSelector(`div[data-dose-id]`, { timeout: 4000 });
    const doseCard = page.locator('div[data-dose-id]').filter({ hasText: uniqueItemName }).first();
    await doseCard.locator('button[aria-label="Mark as taken"]').first().click();
    await page.waitForTimeout(1000); 

    // 3. Go back to Protocols, then to Detail and DELETE
    await page.locator('nav a[href="/app/protocols"]').click();
    await page.click('text=' + name);
    await page.waitForURL(/\/app\/protocols\/.*/);

    // Register dialog handler BEFORE action that triggers it
    page.on('dialog', async dialog => {
      console.log('Dialog appeared:', dialog.message());
      await dialog.accept();
    });
    
    // Click the new Delete button on the detail page (wait for it to be visible)
    const delBtn = page.getByTestId('delete-protocol-button');
    await expect(delBtn).toBeVisible();
    await delBtn.hover();
    await delBtn.click();
    
    // Wait for the navigation away from the detail page
    await page.waitForURL('/app/protocols', { timeout: 10_000 });

    // 4. Verify it's gone from "Current" (active) filter
    await page.click('button:has-text("Current")');
    await expect(page.getByText(name)).not.toBeVisible();

    // 5. Check "All" filter - it should be there as "Archived"
    await page.click('button:has-text("All")');
    await expect(page.locator('[data-protocol-name="' + name + '"]').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('archived', { exact: true })).toBeVisible();
  });
});
