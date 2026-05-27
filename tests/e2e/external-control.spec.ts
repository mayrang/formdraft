import { test, expect, type Page } from '@playwright/test';

const KEY = 'formdraft:external-control-demo';

async function freshPage(page: Page): Promise<void> {
  await page.goto('/#/external-control');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-testid="subject"]');
}

test.describe('External control (getFormDraft + useFormDraftStatus)', () => {
  test('useFormDraftStatus reflects status transitions in a sibling', async ({ page }) => {
    await freshPage(page);

    await expect(page.locator('[data-testid="reader-status-value"]')).toHaveText('idle');

    await page.locator('[data-testid="subject"]').fill('hi');
    // Status should leave idle (saving) and end at saved.
    await expect
      .poll(() => page.locator('[data-testid="reader-status-value"]').textContent(), { timeout: 3000 })
      .toBe('saved');
    await expect(page.locator('[data-testid="reader-saved-at"]')).not.toHaveText('null');
  });

  test('external getValues() returns current draft state', async ({ page }) => {
    await freshPage(page);
    await page.locator('[data-testid="subject"]').fill('SubA');
    await page.locator('[data-testid="message"]').fill('MsgA');
    await page.locator('[data-testid="external-read"]').click();
    await expect(page.locator('[data-testid="last-values"]')).toContainText('"subject":"SubA"');
    await expect(page.locator('[data-testid="last-values"]')).toContainText('"message":"MsgA"');
  });

  test('external discard() clears storage and resets the form', async ({ page }) => {
    await freshPage(page);
    await page.locator('[data-testid="subject"]').fill('to-discard');
    await page.waitForTimeout(300);

    await page.locator('[data-testid="external-discard"]').click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid="subject"]')).toHaveValue('');
    const stored = await page.evaluate((k) => localStorage.getItem(k), KEY);
    expect(stored).toBeNull();
  });

  test('external save() triggers a sync (status transitions saving → saved)', async ({ page }) => {
    await freshPage(page);
    await page.locator('[data-testid="subject"]').fill('manual-save');

    // Click external save while there's a pending change.
    await page.locator('[data-testid="external-save"]').click();

    // Should pass through saving → saved.
    await expect
      .poll(() => page.locator('[data-testid="reader-status-value"]').textContent(), { timeout: 3000 })
      .toBe('saved');
  });
});
