import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import { App } from './App';
import { jpTheme } from './theme';
import { RELAY_CHANNEL } from './lib/central-auth';

// spec 257 — popup OAuth relay. A Google sign-in INSIDE the connect popup severs window.opener
// (Google sets COOP), so the broker can't postMessage the auth code back and instead redirects
// THIS popup to demo-jp with `?code&state&ac_relay=1`. We are that popup: hand {code,state} to the
// opener window over a same-origin BroadcastChannel (only demo-jp windows can read it — the opener
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

// The user chose Material UI for demo-jp. Mount the MUI ThemeProvider (a light corporate teal theme) at
// the root so the NEW shell / connect-entry / discovery / hub components render natively. We deliberately
// do NOT mount CssBaseline: the legacy dashboards still rely on the global CSS + design tokens in
// index.html, and CssBaseline would reset body/typography out from under them. MUI components style
// themselves via emotion regardless, so the theme applies without a global reset.
if (!relayPopupCodeIfNeeded()) {
  createRoot(document.getElementById('root')!).render(
    <ThemeProvider theme={jpTheme}>
      <App />
    </ThemeProvider>,
  );
}
