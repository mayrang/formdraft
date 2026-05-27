import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT_DIR = './docs/assets';
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 900, height: 700 },
  recordVideo: { dir: OUT_DIR, size: { width: 900, height: 700 } },
});
const page = await context.newPage();

async function pause(ms) { await page.waitForTimeout(ms); }
async function slowType(selector, text) {
  await page.locator(selector).first().fill('');
  for (const ch of text) {
    await page.locator(selector).first().pressSequentially(ch, { delay: 60 });
  }
}

// Clear any leftover localStorage from earlier runs
await page.goto('http://localhost:5173');
await page.evaluate(() => localStorage.clear());
await page.reload();
await pause(500);

// ── Step 1: Account ────────────────────────────────────────
await slowType('input[type="email"]', 'demo@formdraft.dev');
await pause(300);
await slowType('input[type="password"]', 'secret123');
await pause(600);
await page.locator('button:has-text("Next")').click();
await pause(400);

// ── Step 2: Profile ────────────────────────────────────────
await slowType('input[placeholder="Your name"]', 'Donghyun');
await pause(300);
await slowType('textarea', 'Building OSS to demonstrate form resilience.');
await pause(800);
await page.locator('button:has-text("Next")').click();
await pause(400);

// ── Step 3: Preferences ────────────────────────────────────
await page.locator('label:has-text("Send me product updates")').click();
await pause(300);
await page.locator('label.radio-option:has-text("dark")').click();
await pause(800);

// ── THE MOMENT: refresh ────────────────────────────────────
await pause(600);
await page.reload();
await pause(2000);  // Hold to show restored state

// Go to step 4 then step 5 to show confirm with masked password
await page.locator('button:has-text("Next")').click();
await pause(500);
await page.locator('button:has-text("Next")').click();
await pause(1800);

await context.close();
await browser.close();
console.log('Done.');
