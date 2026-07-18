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

test.describe('offline PWA shell (requires E2E_EMAIL and E2E_PASSWORD)', () => {
  test.skip(!hasAuthCreds, 'Set E2E_EMAIL and E2E_PASSWORD to run the offline shell E2E.');

  test('app shell is cached in the versioned service-worker cache', async ({ page }) => {
    await login(page);
    await finishOnboardingIfNeeded(page);
    await page.waitForURL('/app', { timeout: 30_000 });

    // Prove the SW took control and the shell landed in the versioned cache.
    await page.waitForFunction(async () => {
      if (!('serviceWorker' in navigator)) return false;
      if (!navigator.serviceWorker.controller) return false;
      const keys = await caches.keys();
      const shellKey = keys.find((key) => key.startsWith('medremind-shell-'));
      if (!shellKey) return false;
      const cache = await caches.open(shellKey);
      return Boolean(await cache.match('/app'));
    }, undefined, { timeout: 30_000 });
  });

  test.fixme(
    'app shell renders from cache when offline reload is supported by browser emulation',
    async ({ page, context }) => {
      await login(page);
      await finishOnboardingIfNeeded(page);
      await page.waitForURL('/app', { timeout: 30_000 });

      await page.waitForFunction(async () => {
        if (!('serviceWorker' in navigator)) return false;
        if (!navigator.serviceWorker.controller) return false;
        const keys = await caches.keys();
        const shellKey = keys.find((key) => key.startsWith('medremind-shell-'));
        if (!shellKey) return false;
        const cache = await caches.open(shellKey);
        return Boolean(await cache.match('/app'));
      }, undefined, { timeout: 30_000 });

      // Chromium can detach the active page during service-worker offline reload
      // emulation; keep the cache proof above as the stable required assertion.
      await context.setOffline(true);
      try {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.getByText("Today's progress")).toBeVisible({ timeout: 30_000 });
      } finally {
        await context.setOffline(false);
      }
    },
  );
});
