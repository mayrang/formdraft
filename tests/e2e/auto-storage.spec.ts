import { test, expect, type Page } from '@playwright/test';

const KEY = 'formdraft:auto-storage-demo';

async function freshPage(page: Page): Promise<void> {
  await page.goto('/#/auto-storage');
  await page.evaluate(() => {
    localStorage.clear();
    return new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('formdraft');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  });
  await page.reload();
  await page.waitForSelector('[data-testid="note"]');
}

test.describe('autoAdapter', () => {
  test('small payload writes to localStorage; bloat migrates to IndexedDB', async ({ page }) => {
    await freshPage(page);

    // Small write — should land in localStorage.
    await page.locator('[data-testid="note"]').fill('hello');
    await page.waitForTimeout(300);
    const lsBefore = await page.evaluate((k) => localStorage.getItem(k), KEY);
    expect(lsBefore).not.toBeNull();
    const beforeParsed = JSON.parse(lsBefore!) as { values: { note: string } };
    expect(beforeParsed.values.note).toBe('hello');

    // Push past threshold (5000 chars).
    await page.locator('[data-testid="bloat"]').click();
    await page.waitForTimeout(500);

    // localStorage should be cleared for this key; the data should now live in IndexedDB.
    await expect.poll(async () => page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();

    // Migration logged.
    await expect(page.locator('[data-testid="migration-count"]')).toContainText('1');

    // Reload — data should restore from IndexedDB.
    await page.reload();
    await page.waitForSelector('[data-testid="note"]');
    await expect(page.locator('[data-testid="note"]')).toHaveValue('hello');
    await expect(page.locator('[data-testid="padding-size"]')).toContainText('10000');
  });

  test('discard clears both storages', async ({ page }) => {
    await freshPage(page);

    await page.locator('[data-testid="note"]').fill('to be discarded');
    await page.locator('[data-testid="bloat"]').click();
    await page.waitForTimeout(500);

    await page.locator('[data-testid="discard"]').click();
    await page.waitForTimeout(300);

    const ls = await page.evaluate((k) => localStorage.getItem(k), KEY);
    expect(ls).toBeNull();
    // IndexedDB shouldn't have it either; on reload values revert to defaults.
    await page.reload();
    await page.waitForSelector('[data-testid="note"]');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="note"]')).toHaveValue('');
  });
});
