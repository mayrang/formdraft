import { test, expect, type Page } from '@playwright/test';

async function freshPage(page: Page, route: string, key: string): Promise<void> {
  await page.goto(`/#/${route}`);
  await page.evaluate((k) => localStorage.removeItem(k), key);
  await page.reload();
  await page.waitForSelector('[data-testid="discard"]');
}

test.describe('Form-library adapters', () => {
  test('RHF adapter: typing persists, reload restores', async ({ page }) => {
    await freshPage(page, 'rhf', 'formdraft:rhf-demo');

    await page.locator('[data-testid="username"]').fill('alice');
    await page.locator('[data-testid="email"]').fill('alice@example.com');
    await page.waitForTimeout(400);

    await page.reload();
    await page.waitForSelector('[data-testid="username"]');
    await expect(page.locator('[data-testid="username"]')).toHaveValue('alice');
    await expect(page.locator('[data-testid="email"]')).toHaveValue('alice@example.com');
  });

  test('RHF adapter: discard clears storage and the form', async ({ page }) => {
    await freshPage(page, 'rhf', 'formdraft:rhf-demo');
    await page.locator('[data-testid="username"]').fill('bob');
    await page.waitForTimeout(300);
    await page.locator('[data-testid="discard"]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="username"]')).toHaveValue('');
    const stored = await page.evaluate(() => localStorage.getItem('formdraft:rhf-demo'));
    expect(stored).toBeNull();
  });

  test('Formik adapter: typing persists, reload restores', async ({ page }) => {
    await freshPage(page, 'formik', 'formdraft:formik-demo');

    await page.locator('[data-testid="fullName"]').fill('Carol');
    await page.locator('[data-testid="company"]').fill('Acme');
    await page.waitForTimeout(400);

    await page.reload();
    await page.waitForSelector('[data-testid="fullName"]');
    await expect(page.locator('[data-testid="fullName"]')).toHaveValue('Carol');
    await expect(page.locator('[data-testid="company"]')).toHaveValue('Acme');
  });

  test('Formik adapter: discard clears storage and the form', async ({ page }) => {
    await freshPage(page, 'formik', 'formdraft:formik-demo');
    await page.locator('[data-testid="fullName"]').fill('Dave');
    await page.waitForTimeout(300);
    await page.locator('[data-testid="discard"]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="fullName"]')).toHaveValue('');
    const stored = await page.evaluate(() => localStorage.getItem('formdraft:formik-demo'));
    expect(stored).toBeNull();
  });

  test('TanStack Form adapter: typing persists, reload restores', async ({ page }) => {
    await freshPage(page, 'tanstack', 'formdraft:tanstack-demo');

    await page.locator('[data-testid="fullName"]').fill('Eve');
    await page.locator('[data-testid="role"]').fill('Engineer');
    await page.waitForTimeout(400);

    await page.reload();
    await page.waitForSelector('[data-testid="fullName"]');
    await expect(page.locator('[data-testid="fullName"]')).toHaveValue('Eve');
    await expect(page.locator('[data-testid="role"]')).toHaveValue('Engineer');
  });

  test('TanStack Form adapter: discard clears storage and the form', async ({ page }) => {
    await freshPage(page, 'tanstack', 'formdraft:tanstack-demo');
    await page.locator('[data-testid="fullName"]').fill('Frank');
    await page.waitForTimeout(300);
    await page.locator('[data-testid="discard"]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="fullName"]')).toHaveValue('');
    const stored = await page.evaluate(() => localStorage.getItem('formdraft:tanstack-demo'));
    expect(stored).toBeNull();
  });
});
