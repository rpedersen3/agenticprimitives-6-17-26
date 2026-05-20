/**
 * Spec 03 — Authorize agent (issue Delegation).
 *
 * Full Step 2 round trip:
 *   - Browser fetches /a2a/deployments (delegationManager + enforcer addrs)
 *   - User clicks Sign in (Step 1; reused from spec 02)
 *   - User clicks Authorize agent:
 *       - POST /a2a/session/init → sessionId + sessionKeyAddress
 *       - browser uses DelegationClient + viem account.signTypedData to
 *         build + sign an EIP-712 Delegation
 *       - POST /a2a/session/package → demo-a2a re-encrypts the session
 *         with delegation bound, marks active, returns delegationHash
 *   - UI renders "Session active" with the sessionId
 *
 * Failure modes this catches:
 *   - DelegationClient hash drift (EIP-712 domain / types)
 *   - viem account.signTypedData call shape changed
 *   - a2a /session/init or /session/package wiring broken
 *   - SessionManager AAD bind / chainId persistence regressed
 *   - hashDelegation mismatched between web (sign-side) and a2a (verify-side)
 *
 * Each test independent. <10s once stack is up.
 */
import { test, expect } from '@playwright/test';

async function signInAndCaptureSmartAccount(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/');
  const step1 = page.locator('.step').filter({
    has: page.locator('h3', { hasText: /^Step 1 — Sign in/ }),
  });
  await step1.locator('button', { hasText: 'Sign in with EOA' }).click();
  await expect(step1).toContainText('Signed in. Smart account:', { timeout: 15_000 });
  const code = step1.locator('code').first();
  await expect(code).toBeVisible();
  const smartAccount = await code.innerText();

  // Step 1.5 — deploy via paymaster-sponsored UserOp. Required for the EOA
  // path before Step 2 (the Authorize button is disabled until isDeployed).
  // Skipped when no paymaster is configured; the button won't appear.
  const step15 = page.locator('.step').filter({
    has: page.locator('h3', { hasText: /^Step 1\.5 — Deploy smart account/ }),
  });
  if (await step15.count() > 0) {
    const deployBtn = step15.locator('button', { hasText: 'Deploy smart account' });
    if (await deployBtn.count() > 0 && await deployBtn.isEnabled()) {
      await deployBtn.click();
      await expect(step15).toContainText('Smart account deployed on-chain.', {
        timeout: 60_000,
      });
    }
  }
  return smartAccount;
}

test.describe('Authorize agent (Step 2)', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.clearCookies();
    await page.addInitScript(() => {
      try { localStorage.clear(); } catch {}
    });
  });

  test('Authorize button is disabled until SIWE login completes', async ({ page }) => {
    await page.goto('/');
    const step2 = page.locator('.step', { hasText: 'Step 2 — Authorize agent' });
    const btn = step2.locator('button', { hasText: 'Authorize agent' });
    await expect(btn).toBeDisabled();
  });

  test('After SIWE, clicking Authorize packages a session and renders sessionId', async ({ page }) => {
    // Diagnostics — attached BEFORE any navigation so they cover the whole flow.
    page.on('console', (msg) => console.log(`[browser ${msg.type()}]`, msg.text()));
    page.on('pageerror', (err) => console.log(`[pageerror]`, err.message, err.stack?.split('\n')[1]));
    page.on('request', (req) => {
      if (req.url().includes('/a2a/')) console.log(`[req] ${req.method()} ${req.url()}`);
    });
    page.on('response', async (res) => {
      if (res.url().includes('/a2a/')) {
        const body = await res.text().catch(() => '<unreadable>');
        console.log(`[response] ${res.status()} ${res.url()} :: ${body.slice(0, 500)}`);
      }
    });

    const smartAccount = await signInAndCaptureSmartAccount(page);
    expect(smartAccount).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const step2 = page.locator('.step', { hasText: 'Step 2 — Authorize agent' });
    const btn = step2.locator('button', { hasText: 'Authorize agent' });
    await expect(btn).toBeEnabled();
    await btn.click();

    // After /session/package returns ok, Step 2 panel renders "Session active: sa_…"
    await expect(step2).toContainText('Session active:', { timeout: 15_000 });
    const sessionCode = step2.locator('code');
    await expect(sessionCode).toBeVisible();
    const sessionId = await sessionCode.innerText();
    expect(sessionId).toMatch(/^sa_[0-9a-f]+$/);

    // Log carries delegationHash and ERC-1271 verification status
    const log = page.locator('.step', { hasText: 'Log' }).locator('pre');
    await expect(log).toContainText('[2] ✓ Session packaged.');
    await expect(log).toContainText('delegationHash=0x');
  });

  test('Authorize button is disabled after success (idempotency)', async ({ page }) => {
    await signInAndCaptureSmartAccount(page);
    const step2 = page.locator('.step', { hasText: 'Step 2 — Authorize agent' });
    const btn = step2.locator('button', { hasText: 'Authorize agent' });
    await btn.click();
    await expect(step2).toContainText('Session active:', { timeout: 15_000 });
    await expect(btn).toBeDisabled();
  });
});
