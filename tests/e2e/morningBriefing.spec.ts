import { expect, test, type Page } from '@playwright/test';
import { format } from 'date-fns';

const e2eEmail = process.env.E2E_EMAIL;
const e2ePassword = process.env.E2E_PASSWORD;
const hasAuthCreds = Boolean(e2eEmail && e2ePassword);

test.skip(!hasAuthCreds, 'E2E credentials not configured');

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

async function setBriefingToggle(page: Page, enabled: boolean) {
  await page.goto('/app/settings');
  const toggleRow = page
    .getByText('Утренний брифинг', { exact: true })
    .locator('xpath=ancestor::div[contains(@class, "flex")][1]');
  const toggle = toggleRow.locator('button').first();
  const isOn = (await toggle.getAttribute('class'))?.includes('bg-[#3B82F6]') ?? false;
  if (isOn !== enabled) await toggle.click();
  await page.getByRole('button', { name: 'Save Notifications' }).click();
}

test('morning briefing card renders from stubbed summary and dismisses for the day', async ({ page }) => {
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  await page.addInitScript(() => {
    localStorage.removeItem('medremind-briefing-dismissed-v1');
  });
  await page.route('**/api/health/oura/summary*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(summaryStub(todayStr)) }),
  );

  await login(page);
  await setBriefingToggle(page, true);
  try {
    await page.goto('/app');

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
    await setBriefingToggle(page, false);
  }
});
