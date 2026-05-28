import { test, expect, type Page } from '@playwright/test';

// Headline scenarios from the Round 2 audit. Each exercises a README claim
// against a real browser engine — Chromium, Firefox, and WebKit (iOS Safari
// surrogate) — so JSDOM-only blind spots don't slip through again.

const STORAGE_KEY = 'formdraft:signup-wizard';

async function freshPage(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('input[type="email"]');
}

async function fillStep1(page: Page, email: string, password: string): Promise<void> {
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
}

async function fillStep2(page: Page, name: string, bio: string): Promise<void> {
  await page.locator('input[placeholder="Your name"]').fill(name);
  await page.locator('textarea').fill(bio);
}

test.describe('formdraft headline scenarios', () => {
  test('S1: persist + restore golden path survives refresh', async ({ page }) => {
    await freshPage(page);
    await fillStep1(page, 'demo@formdraft.dev', 'secret123');
    await page.locator('button:has-text("Next")').click();
    await fillStep2(page, 'Donghyun', 'Building OSS to demonstrate form resilience.');
    await page.waitForTimeout(300); // let debounce + sync settle

    await page.reload();
    // Restore is async. The example persists `step` too, so the form lands
    // back on step 2 after restore. Click Back to inspect step 1's values.
    await page.waitForSelector('input[placeholder="Your name"]', { timeout: 3000 });
    await expect(page.locator('input[placeholder="Your name"]')).toHaveValue('Donghyun');
    await page.locator('button:has-text("← Back")').click();
    await expect(page.locator('input[type="email"]')).toHaveValue('demo@formdraft.dev');
  });

  test('S2: excludeFields strips password from storage', async ({ page }) => {
    await freshPage(page);
    await fillStep1(page, 'bob@x.com', 'topsecret');
    await page.waitForTimeout(300);

    const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!) as { values: Record<string, unknown> };
    expect(parsed.values.email).toBe('bob@x.com');
    expect(parsed.values.password).toBeUndefined();
  });

  test('S3: discard() is not resurrected by stale debounce', async ({ page }) => {
    await freshPage(page);
    await page.locator('input[type="email"]').fill('about-to-discard@x.com');
    // Click Discard immediately while persist debounce (50ms) is still pending.
    await page.locator('button:has-text("Discard")').click();
    await page.waitForTimeout(1000);
    const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    expect(stored).toBeNull();
  });

  test('S5: offline queue flushes on online', async ({ page, context }) => {
    await freshPage(page);

    const syncLogs: unknown[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.startsWith('[sync]')) syncLogs.push(text);
    });

    await context.setOffline(true);
    await fillStep1(page, 'offline@x.com', 'pwd');
    await page.waitForTimeout(2500); // long enough for syncDebounceMs (1500ms in example)
    expect(syncLogs.length).toBe(0);

    await context.setOffline(false);
    // Wait for queue to flush after online event
    await expect.poll(() => syncLogs.length, { timeout: 5000 }).toBeGreaterThan(0);
  });

  test('S6: rapid set + discard + set persists only the final value', async ({ page }) => {
    await freshPage(page);
    await page.locator('input[type="email"]').fill('a@x.com');
    await page.locator('button:has-text("Discard")').click();
    await page.locator('input[type="email"]').fill('b@x.com');
    await page.waitForTimeout(500);

    const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!) as { values: { email: string } };
    expect(parsed.values.email).toBe('b@x.com');
  });

  test('S7: submit clears storage and resets form', async ({ page }) => {
    await freshPage(page);
    await fillStep1(page, 'submitter@x.com', 'pwd');

    // Navigate to step 5 via Next x4
    for (let i = 0; i < 4; i++) {
      await page.locator('button:has-text("Next")').click();
    }

    page.once('dialog', (d) => d.accept());
    await page.locator('button:has-text("Submit")').click();
    await page.waitForTimeout(500);

    const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    expect(stored).toBeNull();
  });

  test('multi-tab: submit in tab A clears tab B', async ({ browser }) => {
    // Multi-tab requires shared origin in the same browser context.
    const context = await browser.newContext();
    const a = await context.newPage();
    const b = await context.newPage();

    await a.goto('/');
    await a.evaluate(() => localStorage.clear());
    await a.reload();
    await a.waitForSelector('input[type="email"]');

    await b.goto('/');
    await b.waitForSelector('input[type="email"]');

    // Tab A fills + submits
    await a.locator('input[type="email"]').fill('a@multi.com');
    await a.locator('input[type="password"]').fill('pwd');
    for (let i = 0; i < 4; i++) {
      await a.locator('button:has-text("Next")').click();
    }
    a.once('dialog', (d) => d.accept());
    await a.locator('button:has-text("Submit")').click();

    // Tab B should see the submit broadcast and reset to defaults
    await expect.poll(
      async () => a.evaluate((k) => localStorage.getItem(k), STORAGE_KEY),
      { timeout: 3000 },
    ).toBeNull();
    await expect(b.locator('input[type="email"]')).toHaveValue('', { timeout: 3000 });

    await context.close();
  });

  test('S8: reentry banner appears for excluded password after refresh', async ({ page }) => {
    await freshPage(page);
    await fillStep1(page, 'reentry@x.com', 'mypassword');
    await page.locator('button:has-text("Next")').click();
    await fillStep2(page, 'User', 'Some bio');
    await page.waitForTimeout(300);

    // No banner yet — we haven't refreshed, the form is in-session
    await expect(page.locator('[data-testid="reentry-banner"]')).toHaveCount(0);

    // Refresh: password is excluded from storage, so its value is gone
    // but the rest of the wizard state survives. The banner should appear.
    await page.reload();
    await page.waitForSelector('input[placeholder="Your name"]');
    await expect(page.locator('[data-testid="reentry-banner"]')).toBeVisible();
    await expect(page.locator('input[placeholder="Your name"]')).toHaveValue('User');

    // Go back to step 1 and re-enter the password — banner clears.
    await page.locator('button:has-text("← Back")').click();
    await expect(page.locator('input[type="email"]')).toHaveValue('reentry@x.com');
    await expect(page.locator('input[type="password"]')).toHaveValue('');
    await page.locator('input[type="password"]').fill('mypassword');
    await expect(page.locator('[data-testid="reentry-banner"]')).toHaveCount(0);
  });
});
