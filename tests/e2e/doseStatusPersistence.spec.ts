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

// Best-effort teardown: this suite creates PersistTest/RemoveTest/OfflineTest
// protocols on a SHARED test account every run. Without cleanup they pile up,
// growing the boot pull until later tests flake on hydration timeouts. Delete
// (or archive) them via the store so the account stays lean.
async function cleanupTestProtocols(page: Page) {
  // Fire the deletes but never block on the outbox draining — waiting here can
  // hang the hook. The deletes sync in the background; combined with periodic
  // account purges this keeps accumulation bounded without risking the run.
  try {
    await page.evaluate(() => {
      const store = (window as unknown as {
        __medremindStore?: {
          getState(): {
            protocols: { id: string; name: string; isTemplate?: boolean }[];
            deleteProtocol(id: string): unknown;
          };
        };
      }).__medremindStore;
      if (!store) return;
      const state = store.getState();
      state.protocols
        .filter(p => !p.isTemplate && /^(PersistTest|RemoveTest|OfflineTest) /.test(p.name))
        .forEach(p => { try { state.deleteProtocol(p.id); } catch { /* keep going */ } });
    });
    await page.waitForTimeout(1_500);
  } catch {
    // Teardown must never fail a passing test.
  }
}

test.describe('dose status persistence', () => {
  test.afterEach(async ({ page }) => {
    await cleanupTestProtocols(page);
  });

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

    // Activation sync is fire-and-forget; wait for it to land before the
    // full-reload navigation re-pulls state from the cloud.
    await waitForSyncFlushed(page);
    await page.waitForTimeout(1_000);

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

    // Activation sync is fire-and-forget; wait for it to land before the
    // full-reload navigation re-pulls state from the cloud.
    await waitForSyncFlushed(page);
    await page.waitForTimeout(1_000);

    await page.goto('/app');
    await expect(page.getByRole('button', { name: 'Mark as taken' }).first()).toBeVisible({ timeout: 20_000 });
    // Remove the earliest pending dose of THIS test's protocol (scoped by the
    // "Remove Med" item name) and capture its exact id. Asserting that this
    // specific id does not resurrect is the true invariant — robust to other
    // protocols' doses and to rolling-horizon regeneration, which a raw
    // total-count comparison is not.
    const removedId = await page.evaluate(() => {
      const store = (window as unknown as { __medremindStore: { getState(): { scheduledDoses: { id: string; scheduledDate: string; status: string; protocolItem?: { name?: string } }[]; removeDose(id: string): void } } }).__medremindStore;
      const state = store.getState();
      const dose = state.scheduledDoses
        .filter(d => d.status === 'pending' && d.protocolItem?.name === 'Remove Med')
        .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))[0];
      if (!dose) return null;
      store.getState().removeDose(dose.id);
      return dose.id;
    });
    expect(removedId).not.toBeNull();
    await waitForSyncFlushed(page);
    await page.waitForTimeout(2_000);
    await page.reload();
    await page.waitForURL(/\/app/, { timeout: 30_000 });
    // Wait for the boot pull to hydrate the store (future days 2-3 remain).
    await page.waitForFunction(() => {
      const store = (window as unknown as { __medremindStore?: { getState(): { scheduledDoses: unknown[] } } }).__medremindStore;
      return (store?.getState().scheduledDoses.length ?? 0) > 0;
    }, { timeout: 30_000 });
    const resurrected = await page.evaluate((id: string) =>
      (window as unknown as { __medremindStore: { getState(): { scheduledDoses: { id: string }[] } } })
        .__medremindStore.getState().scheduledDoses.some(d => d.id === id),
    removedId!);
    expect(resurrected).toBe(false);
  });

  test('offline take survives reload once back online', async ({ page, context }) => {
    await ensureAuthenticated(page);

    // Create & activate a protocol with one daily med so today has a dose.
    const name = `OfflineTest ${Date.now()}`;
    await page.goto('/app/protocols/new');
    await page.getByLabel('Protocol name').fill(name);
    await page.getByRole('button', { name: /Fixed/i }).click();
    await page.getByLabel('Number of days').fill('3');
    await page.getByRole('button', { name: 'Next →' }).click();
    await page.getByLabel('Name').fill('Offline Med');
    await page.getByRole('button', { name: '+ Add item' }).click();
    await page.getByRole('button', { name: 'Review →' }).click();
    await page.getByRole('button', { name: 'Create & Activate' }).click();
    await page.waitForURL('/app/protocols');

    // Activation sync is fire-and-forget; wait for it to land before the
    // navigation that re-pulls state from the cloud.
    await waitForSyncFlushed(page);
    await page.waitForTimeout(1_000);

    // Go to today's doses.
    await page.goto('/app');
    const takeButton = page.getByRole('button', { name: 'Mark as taken' }).first();
    await expect(takeButton).toBeVisible({ timeout: 20_000 });

    // Go offline and take the dose (the operation queues in the outbox).
    await context.setOffline(true);
    await takeButton.click();
    await expect(page.getByRole('button', { name: 'Already marked as taken' }).first()).toBeVisible({ timeout: 10_000 });

    // Come back online and reload. The boot sequence should drain the outbox
    // BEFORE pulling from the cloud, so the offline-taken status persists.
    await context.setOffline(false);
    await page.reload();
    await page.waitForURL(/\/app/, { timeout: 30_000 });
    await expect(
      page.getByRole('button', { name: 'Already marked as taken' }).first(),
    ).toBeVisible({ timeout: 30_000 });
  });
});
