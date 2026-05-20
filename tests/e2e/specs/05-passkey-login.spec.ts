/**
 * Spec 05 — Passkey login (WebAuthn + SIWE-1271/6492).
 *
 * Exercises the full passkey path on the running demo stack:
 *   1. Step 0: select "Passkey (WebAuthn / P-256)" radio
 *   2. Register a passkey via the virtual authenticator (CDP)
 *   3. Step 1: sign in
 *      - demo-web computes the smart-account address via
 *        factory.getAddressForPasskey
 *      - builds a SIWE message with that address
 *      - signs the EIP-191 digest via WebAuthn (virtual auth signs P-256)
 *      - wraps the signature with ERC-6492 (account counterfactual)
 *      - POSTs to /a2a/auth/siwe-verify with addressIsSmartAccount: true
 *   4. demo-a2a's `verifyUserSignature` hits the on-chain
 *      UniversalSignatureValidator which (a) sees the 6492 magic, (b)
 *      deploys the passkey-owned account via the factory inside an
 *      eth_call simulation, (c) calls isValidSignature on the
 *      (now-deployed-in-sim) account, (d) AgentAccount routes to
 *      _verifyWebAuthn which validates the P-256 sig against the
 *      stored (x, y).
 *   5. Browser receives the smart-account address + JWT cookie.
 *
 * Failure modes this catches:
 *   - WebAuthn ceremony bytes (CBOR / DER / clientDataJSON) drift
 *   - on-chain WebAuthn dispatch (`_validateSig` first-byte routing)
 *   - ERC-6492 wrapping / universal validator counterfactual deploy
 *   - factory.getAddressForPasskey ↔ initializeWithPasskey address binding
 *   - demo-a2a fails to pass the validator address as a var
 *
 * Steps 1.5 / 2 / 3 are intentionally NOT exercised here — passkey-driven
 * UserOp + delegation signing is Phase 4b. This spec validates the
 * end-to-end auth path which is the unit Phase 5 delivers.
 */
import { test, expect } from '@playwright/test';
import { attachVirtualAuthenticator } from '../helpers/virtual-authenticator';

test.describe('Passkey login', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.clearCookies();
    await page.addInitScript(() => {
      try {
        localStorage.clear();
      } catch {
        // ignore
      }
    });
  });

  test('full passkey flow: register → sign in → smart account rendered', async ({ page }) => {
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

    // Attach virtual authenticator BEFORE any WebAuthn API call.
    const auth = await attachVirtualAuthenticator(page);

    try {
      await page.goto('/');

      // Step 0 — toggle to Passkey signer.
      const step0 = page.locator('.step', { hasText: 'Step 0 — Choose signer' });
      const passkeyRadio = step0.locator('input[type=radio]', { hasText: '' }).nth(1);
      // The hasText selector on radios is unreliable in some Playwright
      // versions; grab by label text instead.
      const passkeyLabel = step0.locator('label', { hasText: 'Passkey (WebAuthn / P-256)' });
      await passkeyLabel.click();
      // Verify the radio is now checked (sanity).
      await expect(passkeyRadio).toBeChecked();

      // Step 0 — register passkey. The virtual authenticator auto-accepts.
      const registerBtn = step0.locator('button', { hasText: 'Register passkey' });
      await expect(registerBtn).toBeEnabled();
      await registerBtn.click();

      const log = page.locator('.step', { hasText: 'Log' }).locator('pre');
      await expect(log).toContainText('Passkey registered.', { timeout: 15_000 });

      // Step 1 — sign in via passkey. Use a heading-specific locator to
      // disambiguate from the "Step 1.5" panel which also contains
      // "Step 1" as a substring.
      const step1 = page.locator('.step').filter({
        has: page.locator('h3', { hasText: /^Step 1 — Sign in/ }),
      });
      await expect(step1).toContainText('Not signed in.');
      const signInBtn = step1.locator('button', { hasText: 'Sign in with passkey' });
      await expect(signInBtn).toBeEnabled();
      await signInBtn.click();

      // After verifyOnchain → UniversalSignatureValidator → 6492 deploy
      // → ERC-1271 (which dispatches to _verifyWebAuthn) → success,
      // demo-web renders the smart-account address.
      await expect(step1).toContainText('Signed in. Smart account:', { timeout: 30_000 });
      const smartAccountCode = step1.locator('code').first();
      await expect(smartAccountCode).toBeVisible();
      const text = await smartAccountCode.innerText();
      expect(text).toMatch(/^0x[0-9a-fA-F]{40}$/);

      await expect(log).toContainText('Signed in (passkey).');
      await expect(log).toContainText('smartAccount=0x');
    } finally {
      await auth.tearDown();
    }
  });

  test('a2a sets the agentic-session cookie after passkey verify', async ({ page, context }) => {
    const auth = await attachVirtualAuthenticator(page);
    try {
      await page.goto('/');
      const step0 = page.locator('.step', { hasText: 'Step 0 — Choose signer' });
      await step0.locator('label', { hasText: 'Passkey (WebAuthn / P-256)' }).click();
      await step0.locator('button', { hasText: 'Register passkey' }).click();
      const log = page.locator('.step', { hasText: 'Log' }).locator('pre');
      await expect(log).toContainText('Passkey registered.', { timeout: 15_000 });
      const step1 = page.locator('.step').filter({
        has: page.locator('h3', { hasText: /^Step 1 — Sign in/ }),
      });
      await step1.locator('button', { hasText: 'Sign in with passkey' }).click();
      await expect(step1).toContainText('Signed in.', { timeout: 30_000 });
      const cookies = await context.cookies();
      const session = cookies.find((c) => c.name === 'agentic-session');
      expect(session).toBeDefined();
      expect(session!.value.split('.')).toHaveLength(3); // JWT shape
      expect(session!.httpOnly).toBe(true);
    } finally {
      await auth.tearDown();
    }
  });
});
