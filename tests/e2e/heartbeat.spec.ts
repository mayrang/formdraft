import { test, expect } from '@playwright/test';

test.describe('createHeartbeatDetector', () => {
  test('transitions online → offline → online as the probe endpoint becomes reachable/unreachable', async ({
    page,
  }) => {
    let online = true;
    // Intercept the heartbeat probe so we can toggle reachability deterministically.
    // Same-origin loopback connections to the dev server aren't always intercepted
    // by `context.setOffline(true)`, so we toggle via route().
    await page.route('**/__heartbeat__', async (route) => {
      if (online) {
        await route.fulfill({ status: 200, body: '' });
      } else {
        await route.abort('failed');
      }
    });

    await page.goto('/#/heartbeat');
    await page.waitForSelector('[data-testid="heartbeat-online-value"]');

    // First successful beat (after ~1s) confirms online.
    await expect
      .poll(() => page.locator('[data-testid="heartbeat-online-value"]').textContent(), {
        timeout: 4000,
      })
      .toBe('true');

    // Flip the probe to "unreachable" — next beat should timeout.
    online = false;
    await expect
      .poll(() => page.locator('[data-testid="heartbeat-online-value"]').textContent(), {
        timeout: 5000,
      })
      .toBe('false');

    // Flip back — detector should observe success on the next beat.
    online = true;
    await expect
      .poll(() => page.locator('[data-testid="heartbeat-online-value"]').textContent(), {
        timeout: 4000,
      })
      .toBe('true');

    const transitions = parseInt(
      (await page.locator('[data-testid="transitions-count"]').textContent()) ?? '0',
      10,
    );
    expect(transitions).toBeGreaterThanOrEqual(2);
  });
});
