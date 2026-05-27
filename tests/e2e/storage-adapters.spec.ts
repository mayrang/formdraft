import { test, expect, type Page } from '@playwright/test';

async function freshSessionPage(page: Page): Promise<void> {
  await page.goto('/#/session-storage');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-testid="note"]');
}

async function freshIDBPage(page: Page): Promise<void> {
  await page.goto('/#/indexeddb');
  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('formdraft');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  });
  await page.reload();
  await page.waitForSelector('[data-testid="note"]');
}

test.describe('sessionStorageAdapter', () => {
  test('persists across reload within the same tab', async ({ page }) => {
    await freshSessionPage(page);
    await page.locator('[data-testid="note"]').fill('session-only draft');
    await page.waitForTimeout(300);
    await page.reload();
    await page.waitForSelector('[data-testid="note"]');
    await expect(page.locator('[data-testid="note"]')).toHaveValue('session-only draft');
  });

  test('does not leak into localStorage', async ({ page }) => {
    await freshSessionPage(page);
    await page.locator('[data-testid="note"]').fill('session-only draft');
    await page.waitForTimeout(300);
    const lsKeys = await page.evaluate(() => Object.keys(localStorage));
    expect(lsKeys.find((k) => k.includes('session-storage-demo'))).toBeUndefined();
  });
});

test.describe('indexedDBAdapter', () => {
  test('persists across reload', async ({ page }) => {
    await freshIDBPage(page);
    await page.locator('[data-testid="note"]').fill('idb draft');
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForSelector('[data-testid="note"]');
    await expect(page.locator('[data-testid="note"]')).toHaveValue('idb draft');
  });

  test('does not leak into localStorage', async ({ page }) => {
    await freshIDBPage(page);
    await page.locator('[data-testid="note"]').fill('idb draft');
    await page.waitForTimeout(500);
    const lsKeys = await page.evaluate(() => Object.keys(localStorage));
    expect(lsKeys.find((k) => k.includes('indexeddb-demo'))).toBeUndefined();
  });
});
