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

async function waitForSyncFlushed(page: Page) {
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

async function cleanupTestProtocols(page: Page) {
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
        .filter(p => !p.isTemplate && /^StackGuardTest /.test(p.name))
        .forEach(p => { try { state.deleteProtocol(p.id); } catch { /* keep going */ } });
    });
    await page.waitForTimeout(1_500);
  } catch {
    // Teardown must never fail a passing test.
  }
}

test.describe('stack guard (requires E2E_EMAIL and E2E_PASSWORD)', () => {
  test.skip(!hasAuthCreds, 'Set E2E_EMAIL and E2E_PASSWORD to run stack-guard E2E.');
  test.describe.configure({ mode: 'serial' });

  test.afterEach(async ({ page }) => {
    await cleanupTestProtocols(page);
  });

  test('seeded iron+calcium stack renders caution findings on the Meds page', async ({ page }) => {
    await login(page);

    await page.evaluate(() => {
      const store = (window as unknown as {
        __medremindStore: {
          getState(): {
            createCustomProtocol(p: Record<string, unknown>): { id: string };
            addProtocolItem(protocolId: string, item: Record<string, unknown>): void;
            activateProtocol(protocolId: string, startDate: string): unknown;
          };
        };
      }).__medremindStore;
      const state = store.getState();
      const protocol = state.createCustomProtocol({
        name: `StackGuardTest ${Date.now()}`,
        description: 'e2e seed',
        category: 'custom',
        durationDays: 3,
        isArchived: false,
        items: [],
      });
      state.addProtocolItem(protocol.id, {
        itemType: 'medication', name: 'Iron bisglycinate 25mg', doseAmount: 25, doseUnit: 'mg',
        frequencyType: 'daily', times: ['08:00'], withFood: 'no', startDay: 1, sortOrder: 0,
      });
      state.addProtocolItem(protocol.id, {
        itemType: 'medication', name: 'Calcium citrate 600mg', doseAmount: 600, doseUnit: 'mg',
        frequencyType: 'daily', times: ['08:00'], withFood: 'any', startDay: 1, sortOrder: 1,
      });
      state.activateProtocol(protocol.id, new Date().toLocaleDateString('en-CA'));
    });

    await waitForSyncFlushed(page);

    await page.goto('/app/meds');
    const card = page.getByTestId('stack-guard-card');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByText('Железо и кальций в один приём')).toBeVisible();

    await card.getByText('Железо и кальций в один приём').click();
    await expect(card.getByText(/Кальций снижает всасывание железа/)).toBeVisible();
    await expect(card.getByText(/Это не медицинская рекомендация/)).toBeVisible();
  });
});
