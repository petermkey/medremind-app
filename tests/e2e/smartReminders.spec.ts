import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const e2eEmail = process.env.E2E_EMAIL;
const e2ePassword = process.env.E2E_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const hasAuthCreds = Boolean(e2eEmail && e2ePassword && supabaseUrl && supabaseAnonKey);
const e2ePort = Number(process.env.E2E_PORT ?? 3200);
const e2eBaseUrl = process.env.E2E_BASE_URL ?? `http://localhost:${e2ePort}`;
const supabaseProjectRef = supabaseUrl ? new URL(supabaseUrl).hostname.split('.')[0] : '';
const authStorageKey = `sb-${supabaseProjectRef}-auth-token`;
const cookieChunkSize = 3180;

function cookieChunks(name: string, value: string): { name: string; value: string }[] {
  if (value.length < cookieChunkSize) return [{ name, value }];
  const chunks: { name: string; value: string }[] = [];
  for (let offset = 0; offset < value.length; offset += cookieChunkSize) {
    chunks.push({ name: `${name}.${chunks.length}`, value: value.slice(offset, offset + cookieChunkSize) });
  }
  return chunks;
}

function encodeCookieSession(session: unknown): string {
  return `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
}

async function installAuthenticatedSession(page: Page) {
  const supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: e2eEmail!,
    password: e2ePassword!,
  });
  if (error || !data.session) {
    throw new Error(`Unable to authenticate E2E browser session: ${error?.message ?? 'missing session'}`);
  }

  const cookieValue = encodeCookieSession(data.session);
  await page.context().addCookies(
    cookieChunks(authStorageKey, cookieValue).map(cookie => ({
      ...cookie,
      url: e2eBaseUrl,
      sameSite: 'Lax' as const,
      httpOnly: false,
      secure: e2eBaseUrl.startsWith('https://'),
    })),
  );
  await page.addInitScript(
    ({ key, session }) => {
      window.localStorage.setItem(key, JSON.stringify(session));
    },
    { key: authStorageKey, session: data.session },
  );
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

async function setSmartTimingStoreFlag(page: Page, enabled: boolean) {
  await page.waitForFunction(() => Boolean((window as unknown as {
    __medremindStore?: { getState(): { profile?: { onboarded?: boolean } | null } };
  }).__medremindStore?.getState().profile?.onboarded));
  await page.evaluate((nextEnabled) => {
    (window as unknown as {
      __medremindStore?: { getState(): { updateNotificationSettings(patch: { smartFoodTiming: boolean }): void } };
    }).__medremindStore?.getState().updateNotificationSettings({
      smartFoodTiming: nextEnabled,
    });
  }, enabled);
}

async function setTestProfileTimezone(page: Page, timezone: string) {
  await page.evaluate((nextTimezone) => {
    (window as unknown as {
      __medremindStore?: { getState(): { updateProfile(patch: { timezone: string }): void } };
    }).__medremindStore?.getState().updateProfile({ timezone: nextTimezone });
  }, timezone);
}

async function cleanupSeed(page: Page) {
  try {
    await page.evaluate(() => {
      const med = (window as unknown as {
        __medremindStore?: { getState(): {
          protocols: { id: string; name: string; isTemplate?: boolean }[];
          deleteProtocol(id: string): unknown;
          updateNotificationSettings(patch: Record<string, unknown>): void;
        } };
      }).__medremindStore;
      if (med) {
        const state = med.getState();
        state.protocols
          .filter(p => !p.isTemplate && /^SmartTest /.test(p.name))
          .forEach(p => { try { state.deleteProtocol(p.id); } catch { /* keep going */ } });
      }
      const food = (window as unknown as {
        __medremindFoodStore?: { getState(): {
          entries: { id: string; title: string }[];
          deleteFoodEntry(id: string): void;
        } };
      }).__medremindFoodStore;
      if (food) {
        const state = food.getState();
        state.entries
          .filter(entry => entry.title === 'SmartTest meal')
          .forEach(entry => { try { state.deleteFoodEntry(entry.id); } catch { /* keep going */ } });
      }
      med?.getState().updateNotificationSettings({ smartFoodTiming: false });
    });
    await page.waitForTimeout(1_500);
  } catch {
    // Teardown must never fail a passing test.
  }
}

test.describe('smart food-timed reminders (requires E2E_EMAIL and E2E_PASSWORD)', () => {
  test.skip(!hasAuthCreds, 'Set E2E_EMAIL, E2E_PASSWORD, NEXT_PUBLIC_SUPABASE_URL, and NEXT_PUBLIC_SUPABASE_ANON_KEY to run smart-reminder E2E.');
  test.describe.configure({ mode: 'serial' });

  test.afterEach(async ({ page }) => {
    await cleanupSeed(page);
  });

  test('settings toggle enables the schedule hint with seeded data', async ({ page }) => {
    const seedName = `SmartTest EmptyStomach ${Date.now()}`;
    await installAuthenticatedSession(page);

    // 1. Turn the toggle on via Settings UI and save.
    await page.goto('/app/settings');
    await cleanupSeed(page);
    const toggle = page.getByRole('button', { name: 'Smart reminder timing' });
    if (await toggle.getAttribute('aria-pressed') === 'true') {
      await toggle.click();
      await page.getByRole('button', { name: 'Save Notifications' }).click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    }
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Save Notifications' }).click();
    // Keep the local test state deterministic while the cloud save settles.
    await setTestProfileTimezone(page, 'UTC');
    await setSmartTimingStoreFlag(page, true);

    // 2. Schedule page: seed 8 days of meals (09:00 + 20:00) and an
    // empty-stomach 09:30 dose after the app boot pull has completed, so the
    // deterministic local seed cannot be overwritten by a migration-gated
    // settings round-trip.
    await page.goto('/app');
    await expect(page.getByText(/Synced/)).toBeVisible({ timeout: 30_000 });
    await setTestProfileTimezone(page, 'UTC');
    await setSmartTimingStoreFlag(page, true);
    await page.evaluate((itemName) => {
      const medStore = (window as unknown as {
        __medremindStore: { getState(): {
          profile: { id: string; timezone: string } | null;
          createCustomProtocol(p: Record<string, unknown>): { id: string };
          addProtocolItem(protocolId: string, item: Record<string, unknown>): void;
          activateProtocol(protocolId: string, startDate: string): unknown;
          updateProfile(patch: { timezone: string }): void;
        } };
      }).__medremindStore;
      const foodStore = (window as unknown as {
        __medremindFoodStore: { getState(): {
          saveDraftAsEntry(params: Record<string, unknown>): unknown;
        } };
      }).__medremindFoodStore;

      const med = medStore.getState();
      const food = foodStore.getState();
      const profile = med.profile;
      if (!profile) throw new Error('no profile');
      med.updateProfile({ timezone: 'UTC' });

      const [year, month, day] = new Date().toISOString().slice(0, 10).split('-').map(Number);
      const isoForUtcDayTime = (dayOffset: number, hour: number, minute: number) =>
        new Date(Date.UTC(year, month - 1, day - dayOffset, hour, minute, 0, 0)).toISOString();

      const draft = (label: string) => ({
        title: 'SmartTest meal', summary: 'e2e seed', mealLabel: label,
        components: [], nutrients: { caloriesKcal: 400 }, uncertainties: [],
        estimationConfidence: 0.9, model: 'e2e-seed', schemaVersion: 'food-analysis-v1',
      });
      for (let dayOffset = 1; dayOffset <= 8; dayOffset += 1) {
        food.saveDraftAsEntry({ userId: profile.id, timezone: 'UTC', draft: draft('breakfast'), consumedAt: isoForUtcDayTime(dayOffset, 9, 0), source: 'text_ai' });
        food.saveDraftAsEntry({ userId: profile.id, timezone: 'UTC', draft: draft('dinner'), consumedAt: isoForUtcDayTime(dayOffset, 20, 0), source: 'text_ai' });
      }

      const protocol = med.createCustomProtocol({
        name: `SmartTest ${Date.now()}`, description: 'e2e seed', category: 'custom',
        durationDays: 3, isArchived: false, items: [],
      });
      med.addProtocolItem(protocol.id, {
        itemType: 'medication', name: itemName, doseAmount: 1, doseUnit: 'mg',
        frequencyType: 'daily', times: ['09:30'], withFood: 'no', startDay: 1, sortOrder: 0,
      });
      med.activateProtocol(protocol.id, new Date().toISOString().slice(0, 10));
    }, seedName);
    await setTestProfileTimezone(page, 'UTC');
    await setSmartTimingStoreFlag(page, true);

    // 3. Schedule page: 09:30 empty-stomach dose inside the 09:00–20:00 eating
    // window → hint "⏱ 8:30 AM · adjusted" (median first meal 09:00 - 30 min - no
    // cap issues). The dose row itself still shows the ORIGINAL 09:30 slot —
    // planned occurrences are never modified.
    await page.waitForFunction((expectedName) => {
      const med = (window as unknown as {
        __medremindStore?: { getState(): {
          scheduledDoses?: Array<{ protocolItem?: { name?: string } }>;
        } };
      }).__medremindStore?.getState();
      const food = (window as unknown as {
        __medremindFoodStore?: { getState(): {
          entries?: Array<{ title: string }>;
        } };
      }).__medremindFoodStore?.getState();
      const seededFoodCount = food?.entries?.filter(entry => entry.title === 'SmartTest meal').length ?? 0;
      const hasSeededDose = med?.scheduledDoses?.some(dose => dose.protocolItem?.name === expectedName) ?? false;
      return seededFoodCount >= 16 && hasSeededDose;
    }, seedName);
    await page.waitForFunction(() => {
      const state = (window as unknown as {
        __medremindStore?: { getState(): {
          profile?: { timezone?: string } | null;
          notificationSettings?: { smartFoodTiming?: boolean };
        } };
      }).__medremindStore?.getState();
      return state?.profile?.timezone === 'UTC' && state.notificationSettings?.smartFoodTiming === true;
    });

    const doseCard = page.locator('[data-dose-id]', { hasText: seedName }).first();
    await expect(doseCard).toBeVisible({ timeout: 30_000 });
    await expect(doseCard.getByText(/· adjusted/)).toBeVisible();
    await expect(doseCard.getByText(/9:30 AM/)).toBeVisible();
    await waitForSyncFlushed(page);
  });
});
