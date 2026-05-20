/**
 * Spec 01 — Demo user.
 *
 * The smallest possible test: a fresh browser loads the demo, gets a
 * mnemonic-derived EOA address in localStorage, and renders it. No
 * chain, no a2a calls.
 *
 * Failure modes this catches:
 *   - Vite build / React render broken
 *   - test-user.ts mnemonic generation regressed
 *   - localStorage persistence broken
 *
 * Runs in <2s. Safe to run alone:
 *   pnpm test -- 01-demo-user
 */
import { test, expect } from '@playwright/test';

test.describe('demo user', () => {
  test.beforeEach(async ({ context }) => {
    // Start each test from a fresh localStorage so the mnemonic generator runs.
    await context.clearCookies();
  });

  test('generates and renders an EOA on first load', async ({ page }) => {
    await page.goto('/');

    // The mnemonic is generated lazily on first render. Wait until the
    // address appears in the "Demo user (EOA)" panel.
    // Step 0 ("Choose signer") shows the EOA address when the
    // default 'eoa' radio is selected.
    const addressPanel = page.locator('.step', { hasText: 'Step 0 — Choose signer' });
    await expect(addressPanel).toBeVisible();
    const code = addressPanel.locator('code').first();
    await expect(code).toBeVisible();
    const text = await code.innerText();
    expect(text).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  test('persists the same EOA across page reloads', async ({ page }) => {
    await page.goto('/');
    const code = page.locator('.step', { hasText: 'Step 0 — Choose signer' }).locator('code').first();
    await expect(code).toBeVisible();
    const first = await code.innerText();

    await page.reload();
    await expect(code).toBeVisible();
    const second = await code.innerText();

    expect(second).toBe(first);
  });

  test('reset button generates a different EOA', async ({ page }) => {
    await page.goto('/');
    const code = page.locator('.step', { hasText: 'Step 0 — Choose signer' }).locator('code').first();
    await expect(code).toBeVisible();
    const first = await code.innerText();

    // Reset reloads the page, so we listen for the reload before clicking.
    await Promise.all([
      page.waitForURL('**'),
      page.locator('button', { hasText: 'Reset all state' }).click(),
    ]);

    await expect(code).toBeVisible();
    const second = await code.innerText();
    expect(second).not.toBe(first);
    expect(second).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
