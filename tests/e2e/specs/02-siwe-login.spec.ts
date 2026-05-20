/**
 * Spec 02 — SIWE login.
 *
 * Full SIWE round trip through the running demo stack:
 *   - browser builds + signs an EIP-4361 message with the user's mnemonic-EOA
 *   - POSTs to demo-a2a /auth/siwe-verify (proxied via Vite /a2a/*)
 *   - demo-a2a verifies the signature, derives the smart account address
 *     via @agenticprimitives/agent-account.getAddress (which calls the
 *     deployed factory on Anvil), and sets a JWT cookie
 *   - browser receives the smart account address and renders it
 *
 * Failure modes this catches:
 *   - SIWE message format drift between web and a2a
 *   - identity-auth signature recovery broken
 *   - factory.getAddress() ABI changed
 *   - JWT cookie not set / wrong shape
 *   - Anvil + contracts not deployed
 *
 * Runs in <8s once the stack is up. Safe alone:
 *   pnpm test -- 02-siwe-login
 */
import { test, expect } from '@playwright/test';

test.describe('SIWE login', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.clearCookies();
    // Clear localStorage so each test gets a fresh mnemonic
    await page.addInitScript(() => {
      try {
        localStorage.clear();
      } catch {
        // ignore (cross-origin restrictions in some environments)
      }
    });
  });

  test('Sign in button populates a smart account address', async ({ page }) => {
    // Diagnostic plumbing.
    page.on('console', (msg) => console.log(`[browser ${msg.type()}]`, msg.text()));
    page.on('pageerror', (err) => console.log(`[pageerror]`, err.message));
    page.on('requestfailed', (req) =>
      console.log(`[reqfail]`, req.url(), req.failure()?.errorText),
    );
    page.on('response', async (res) => {
      if (res.url().includes('/a2a/')) {
        const body = await res.text().catch(() => '<unreadable>');
        console.log(`[response] ${res.status()} ${res.url()} :: ${body.slice(0, 400)}`);
      }
    });

    await page.goto('/');

    // Step 1 panel starts in "Not signed in" state
    // Use a heading-specific locator to disambiguate from Step 1.5.
    const step1 = page.locator('.step').filter({
      has: page.locator('h3', { hasText: /^Step 1 — Sign in/ }),
    });
    await expect(step1).toContainText('Not signed in.');

    const signInButton = step1.locator('button', { hasText: 'Sign in with EOA' });
    await expect(signInButton).toBeEnabled();
    await signInButton.click();

    // After SIWE round-trip succeeds, the panel shows the smart account.
    // demo-a2a derives via factory.getAddress() on Anvil.
    await expect(step1).toContainText('Signed in. Smart account:', { timeout: 15_000 });
    const smartAccountCode = step1.locator('code');
    await expect(smartAccountCode).toBeVisible();
    const text = await smartAccountCode.innerText();
    expect(text).toMatch(/^0x[0-9a-fA-F]{40}$/);

    // The log line at the bottom reports the wallet + smart account
    const log = page.locator('.step', { hasText: 'Log' }).locator('pre');
    await expect(log).toContainText('[1] ✓ Signed in (EOA).');
    await expect(log).toContainText('wallet=0x');
    await expect(log).toContainText('smartAccount=0x');
  });

  test('Sign in button is disabled after a successful login', async ({ page }) => {
    await page.goto('/');
    // Use a heading-specific locator to disambiguate from Step 1.5.
    const step1 = page.locator('.step').filter({
      has: page.locator('h3', { hasText: /^Step 1 — Sign in/ }),
    });
    await step1.locator('button', { hasText: 'Sign in with EOA' }).click();
    await expect(step1).toContainText('Signed in. Smart account:', { timeout: 15_000 });
    await expect(step1.locator('button', { hasText: 'Sign in with EOA' })).toBeDisabled();
  });

  test('a2a sets the agentic-session cookie after SIWE verify', async ({ page, context }) => {
    await page.goto('/');
    const step1 = page.locator('.step').filter({
      has: page.locator('h3', { hasText: /^Step 1 — Sign in/ }),
    });
    await step1.locator('button', { hasText: 'Sign in with EOA' }).click();
    await expect(step1).toContainText('Signed in.', { timeout: 15_000 });
    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === 'agentic-session');
    expect(session).toBeDefined();
    expect(session!.value.split('.')).toHaveLength(3); // JWT shape
    expect(session!.httpOnly).toBe(true);
  });
});
