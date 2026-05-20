/**
 * Spec 04 — Read profile via agent (Demo step 3).
 *
 * Full Step 3 round trip:
 *   - Browser already signed in (Step 1) + delegation packaged (Step 2)
 *   - User clicks "Read my profile":
 *       POST /a2a/tools/get_profile {sessionId}
 *       → a2a resolves session → mints DelegationToken (sessionKey signs canonical claims)
 *       → POST /tools/get_profile on demo-mcp with the token
 *       → mcp-runtime.withDelegation verifies:
 *           session-key sig recovery (==claims.sessionKeyAddress)
 *           audience match
 *           expiration not past
 *           on-chain isRevoked (tolerated if call reverts)
 *           ERC-1271 isValidSignature (skipped if account undeployed)
 *           caveat eval — fail-closed (timestamp + mcp-tool-scope)
 *           JTI replay tracking
 *       → handler runs with {principal=delegator} and returns PII
 *   - UI renders the profile JSON
 *
 * Failure modes this catches:
 *   - canonicalJSON drift between mint side + verify side
 *   - EIP-712 hash mismatch between web (sign) + a2a/mcp (verify)
 *   - audience or caveat mismatch
 *   - JTI store regression (replay would re-allow)
 *   - mcp-runtime.withDelegation wiring (error mapping, principal threading)
 *
 * Each test independent. <15s once stack is up.
 */
import { test, expect } from '@playwright/test';

async function signInAndAuthorize(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  // Step 1
  const step1 = page.locator('.step').filter({
    has: page.locator('h3', { hasText: /^Step 1 — Sign in/ }),
  });
  await step1.locator('button', { hasText: 'Sign in with EOA' }).click();
  await expect(step1).toContainText('Signed in.', { timeout: 15_000 });

  // Step 1.5 — paymaster deploy. EOA path requires the account to be
  // deployed before Step 2 can run.
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

  // Step 2
  const step2 = page.locator('.step').filter({
    has: page.locator('h3', { hasText: /^Step 2 — Authorize agent/ }),
  });
  await step2.locator('button', { hasText: 'Authorize agent' }).click();
  await expect(step2).toContainText('Session active:', { timeout: 15_000 });
}

test.describe('Read profile via agent (Step 3)', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.clearCookies();
    await page.addInitScript(() => {
      try { localStorage.clear(); } catch {}
    });
  });

  test('Read button is disabled until Step 2 completes', async ({ page }) => {
    await page.goto('/');
    const step3 = page.locator('.step', { hasText: 'Step 3 — Read profile via agent' });
    const btn = step3.locator('button', { hasText: 'Read my profile' });
    await expect(btn).toBeDisabled();
  });

  test('After Step 2, clicking Read renders the profile JSON', async ({ page }) => {
    // Diagnostics — show the full a2a → mcp round trip.
    page.on('response', async (res) => {
      if (res.url().includes('/a2a/tools/') || res.url().includes('/tools/get_profile')) {
        const body = await res.text().catch(() => '<unreadable>');
        console.log(`[response] ${res.status()} ${res.url()} :: ${body.slice(0, 500)}`);
      }
    });

    await signInAndAuthorize(page);

    const step3 = page.locator('.step', { hasText: 'Step 3 — Read profile via agent' });
    const btn = step3.locator('button', { hasText: 'Read my profile' });
    await expect(btn).toBeEnabled();
    await btn.click();

    // The profile JSON appears in the <pre> block of step 3.
    const pre = step3.locator('pre');
    await expect(pre).not.toContainText('(no profile loaded)', { timeout: 15_000 });

    const text = await pre.innerText();
    // Profile includes owner_address (lowercased smart account)
    expect(text).toMatch(/"owner_address":\s*"0x[0-9a-f]{40}"/);
    // …and the demo's deterministic email pattern (8 hex chars taken from address; viem preserves checksum case)
    expect(text).toMatch(/"email":\s*"[0-9a-fA-F]{8}@demo\.agenticprimitives\.local"/);
    // …and a non-empty full_name
    expect(text).toMatch(/"full_name":\s*"Demo User \([^)]+\)"/);

    // Log carries the success line
    const log = page.locator('.step', { hasText: 'Log' }).locator('pre');
    await expect(log).toContainText('[3] ✓ Profile received.');
  });

  test('Re-clicking Read returns the SAME profile (deterministic seed + JTI handles)', async ({ page }) => {
    await signInAndAuthorize(page);
    const step3 = page.locator('.step', { hasText: 'Step 3 — Read profile via agent' });
    const btn = step3.locator('button', { hasText: 'Read my profile' });

    await btn.click();
    const pre = step3.locator('pre');
    await expect(pre).not.toContainText('(no profile loaded)', { timeout: 15_000 });
    const first = await pre.innerText();

    // Each click mints a NEW token (different jti). The MCP verifies a fresh
    // jti each time — no replay collision. The profile content is stable
    // (seeded once for the principal).
    await btn.click();
    // Profile JSON in the panel should be identical
    await expect(pre).toContainText('"owner_address"');
    const second = await pre.innerText();
    expect(second).toBe(first);
  });
});
