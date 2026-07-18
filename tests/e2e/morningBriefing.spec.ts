import { expect, test, type Page } from '@playwright/test';
import { format } from 'date-fns';

const e2eEmail = process.env.E2E_EMAIL;
const e2ePassword = process.env.E2E_PASSWORD;
const hasAuthCreds = Boolean(e2eEmail && e2ePassword);

test.skip(!hasAuthCreds, 'E2E credentials not configured');

declare global {
  interface Window {
    __medremindStore?: {
      getState: () => {
        profile?: { onboarded?: boolean; timezone?: string } | null;
        updateNotificationSettings: (patch: { morningBriefingEnabled: boolean }) => void;
      };
    };
  }
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(e2eEmail!);
  await page.getByLabel('Password').fill(e2ePassword!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(app|onboarding)(\/|$)/, { timeout: 30_000 });
}

function summaryStub(todayStr: string) {
  const days = [];
  for (let offset = 10; offset >= 1; offset -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    days.push({
      localDate: format(date, 'yyyy-MM-dd'),
      readinessScore: 75,
      sleepScore: 70,
      sleepAvgHrv: 60,
      temperatureDeviation: 0,
    });
  }
  days.push({
    localDate: todayStr,
    readinessScore: 88,
    sleepScore: 82,
    sleepAvgHrv: 66,
    temperatureDeviation: 0.1,
  });
  return { connected: true, lastSyncAt: new Date().toISOString(), battery: null, days };
}

async function setBriefingStoreFlag(page: Page, enabled: boolean) {
  await page.waitForFunction(() => Boolean(window.__medremindStore?.getState().profile?.onboarded));
  await page.evaluate((nextEnabled) => {
    window.__medremindStore?.getState().updateNotificationSettings({
      morningBriefingEnabled: nextEnabled,
    });
  }, enabled);
}

test('morning briefing card renders from stubbed summary and dismisses for the day', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('medremind-briefing-dismissed-v1');
  });

  await login(page);
  await page.goto('/app');
  await expect(page.getByText("Today's progress")).toBeVisible();
  const todayStr = await page.evaluate(() => {
    const timeZone = window.__medremindStore?.getState().profile?.timezone ?? 'UTC';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const map = new Map(parts.map((part) => [part.type, part.value]));
    return `${map.get('year')}-${map.get('month')}-${map.get('day')}`;
  });
  await page.route('**/api/health/oura/summary*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(summaryStub(todayStr)) }),
  );
  await setBriefingStoreFlag(page, true);
  try {
    const card = page.getByTestId('morning-briefing-card');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText('Утренний брифинг: отличная готовность');
    await expect(card).toContainText('Готовность 88 · сон 82.');
    await expect(card).toContainText('HRV 66 мс — +10% к 30-дневной норме.');

    await card.getByRole('button', { name: 'Скрыть брифинг' }).click();
    await expect(card).toBeHidden();

    await page.reload();
    await expect(page.getByTestId('morning-briefing-card')).toBeHidden();
  } finally {
    await setBriefingStoreFlag(page, false);
  }
});
