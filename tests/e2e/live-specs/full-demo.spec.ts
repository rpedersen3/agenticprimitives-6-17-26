/**
 * Live demo recording — walks the FULL flow against the deployed
 * agenticprimitives demo at https://agenticprimitives-demo.pages.dev.
 *
 * Path A → SIWE (Step 1)
 * Step 1.5 → paymaster-sponsored smart-account deploy
 * Step 2 → authorize agent (delegation)
 * Step 3 → read profile via agent → mcp resource auth → returns PII
 *
 * Each run mints a FRESH demo EOA (localStorage cleared in beforeEach),
 * which means each run also triggers a real on-chain deploy through
 * the SmartAgentPaymaster. Cost per run: ~0.00003 ETH from the
 * paymaster's deposit (negligible — testnet only).
 */
import { test, expect } from '@playwright/test';

test.describe('Live demo — full flow', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.clearCookies();
    await page.addInitScript(() => {
      try {
        localStorage.clear();
      } catch {}
    });
  });

  test('end-to-end: SIWE → deploy → authorize → read profile', async ({ page }) => {
    // Diagnostics — log key HTTP responses so the trace tells the story.
    page.on('response', async (res) => {
      const url = res.url();
      if (
        url.includes('/a2a/session/deploy') ||
        url.includes('/a2a/session/init') ||
        url.includes('/a2a/session/package') ||
        url.includes('/a2a/auth/siwe-verify') ||
        url.includes('/a2a/tools/')
      ) {
        const body = await res.text().catch(() => '<unreadable>');
        console.log(`[response] ${res.status()} ${url} :: ${body.slice(0, 240)}`);
      }
    });

    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('agenticprimitives demo');

    // ── Step 1: SIWE login
    const step1 = page.locator('.step', { hasText: 'Step 1 — Sign in (SIWE)' });
    await step1.locator('button', { hasText: 'Sign in with EOA' }).click();
    await expect(step1).toContainText('Signed in.', { timeout: 30_000 });

    // ── Step 1.5: paymaster-sponsored smart-account deploy
    // The UI renders Step 1.5 only when (a) signed in + (b) paymaster
    // available + (c) !isDeployed. Wait for the button to show.
    const step15 = page.locator('.step', { hasText: 'Step 1.5 — Deploy smart account' });
    await expect(step15).toBeVisible({ timeout: 10_000 });
    const deployBtn = step15.locator('button', { hasText: 'Deploy smart account' });
    await expect(deployBtn).toBeEnabled();
    await deployBtn.click();
    // Deploy is the longest step — UserOp build, paymaster sponsorship API
    // round trip, KMS sign, EntryPoint.handleOps, block confirmation. Up to 60s.
    await expect(step15).toContainText('Smart account deployed on-chain', { timeout: 60_000 });

    // ── Step 2: authorize agent (issue delegation)
    const step2 = page.locator('.step', { hasText: 'Step 2 — Authorize agent' });
    const authorizeBtn = step2.locator('button', { hasText: 'Authorize agent' });
    await expect(authorizeBtn).toBeEnabled();
    await authorizeBtn.click();
    await expect(step2).toContainText('Session active:', { timeout: 30_000 });

    // ── Step 3: read profile via agent (full delegation chain → mcp)
    const step3 = page.locator('.step', { hasText: 'Step 3 — Read profile via agent' });
    const readBtn = step3.locator('button', { hasText: 'Read my profile' });
    await expect(readBtn).toBeEnabled();
    await readBtn.click();
    const profilePre = step3.locator('pre');
    await expect(profilePre).not.toContainText('(no profile loaded)', { timeout: 30_000 });

    const profileText = await profilePre.innerText();
    expect(profileText).toMatch(/"owner_address":\s*"0x[0-9a-f]{40}"/);
    expect(profileText).toMatch(/"email":\s*"[0-9a-fA-F]{8}@demo\.agenticprimitives\.local"/);

    // Log shows the full path
    const log = page.locator('.step', { hasText: 'Log' }).locator('pre');
    await expect(log).toContainText('[1] ✓ Signed in.');
    await expect(log).toContainText('[1.5] ✓ Deployed at');
    await expect(log).toContainText('[2] ✓ Session packaged.');
    await expect(log).toContainText('[3] ✓ Profile received.');

    // Linger 2s at the end so the final state is visible in the recording.
    await page.waitForTimeout(2000);
  });
});
