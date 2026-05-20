/**
 * Playwright virtual-authenticator helper.
 *
 * Drives the Chrome DevTools Protocol's WebAuthn domain to expose a
 * software P-256 authenticator the page can use via
 * `navigator.credentials.create/get` without any biometric prompt.
 *
 * Pattern (per the spec at https://chromedevtools.github.io/devtools-protocol/tot/WebAuthn/):
 *   1. WebAuthn.enable
 *   2. WebAuthn.addVirtualAuthenticator with { protocol: 'ctap2',
 *      transport: 'internal', hasResidentKey: true, hasUserVerification: true,
 *      isUserVerified: true }
 *
 * Returns a tearDown function the caller invokes (typically in
 * afterEach) to detach the authenticator.
 */

import type { Page } from '@playwright/test';

export interface VirtualAuthenticatorHandle {
  authenticatorId: string;
  tearDown: () => Promise<void>;
}

export async function attachVirtualAuthenticator(
  page: Page,
): Promise<VirtualAuthenticatorHandle> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { authenticatorId } = (await cdp.send('WebAuthn.addVirtualAuthenticator' as any, {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)) as { authenticatorId: string };

  return {
    authenticatorId,
    tearDown: async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await cdp.send('WebAuthn.removeVirtualAuthenticator' as any, {
          authenticatorId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
      } catch {
        // tear-down errors are non-fatal — the session may have already closed
      }
      await cdp.detach().catch(() => {});
    },
  };
}
