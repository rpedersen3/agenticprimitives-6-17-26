import { createRoot } from 'react-dom/client';
import { App } from './App';
import { runStorageCleanup } from './lib/storage-cleanup';
import { RELAY_CHANNEL } from './lib/central-auth';

// spec 257 — popup OAuth relay. A Google sign-in INSIDE the connect popup severs window.opener
// (Google sets COOP), so the broker can't postMessage the auth code back and instead redirects
// THIS popup to demo-gs with `?code&state&ac_relay=1`. We are that popup: hand {code,state} to the
// opener window over a same-origin BroadcastChannel (only demo-gs windows can read it — the opener
// holds the PKCE verifier and finishes the /token exchange), then close. Runs BEFORE React so there
// is no UI flash and we never try to finish the connect in the popup (which has no verifier).
function relayPopupCodeIfNeeded(): boolean {
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.get('ac_relay') !== '1') return false;
    const code = u.searchParams.get('code');
    const state = u.searchParams.get('state');
    if (code && state && typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(RELAY_CHANNEL);
      ch.postMessage({ kind: 'ac-relay', code, state });
      // Let the message flush before we tear down + close.
      setTimeout(() => { try { ch.close(); } catch { /* ignore */ } try { window.close(); } catch { /* ignore */ } }, 150);
    } else {
      setTimeout(() => { try { window.close(); } catch { /* ignore */ } }, 150);
    }
    return true; // we're a relay popup — do NOT mount the app
  } catch {
    return false;
  }
}

if (!relayPopupCodeIfNeeded()) {
  // One-time sweep of obsolete fixture-era storage blobs before the app mounts (see lib/storage-cleanup.ts
  // + docs/storage-ledger.md). Idempotent + safe on refresh; never touches active session/redirect/role
  // state. Operational source-of-truth lives in MCP vaults, not the browser.
  runStorageCleanup();

  createRoot(document.getElementById('root')!).render(<App />);
}
