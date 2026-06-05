// Relying-site connect screen (spec 257 credential-first spine; spec 258 connect-UX; spec 259 relying ⇄
// IdP responsibility split; MUI, mirrors demo-gs). The relying site answers ONLY: why am I connecting,
// what access is this app asking for, what happens after, and launch / cancel / popup-blocked / retry. It
// NEVER asks for an Impact name — credential choice, account discovery, the account chooser, name
// lookup/claim, recovery, and delegation consent ALL belong to the Impact home (demo-sso). This mirrors
// mature SSO (Google "Continue with", Apple, Clerk, Privy, WorkOS): the relying app trusts the returned
// subject (`id_token.sub` = the Smart Account CAIP-10 address); the name is a public handle/profile facet,
// never the login key. A NEW passkey may still need a handle — collected INSIDE the home popup (its
// WebAuthn RP ID is domain-bound), never here. See ADR-0029 + spec 259.
//
// Spec 258: ONE card, ONE primary CTA. "Connect via Impact Community" launches the Connect ceremony in a
// POPUP over the (dimmed) site DIRECTLY. The popup finishes IN PLACE. JP is more sensitive than a plain
// marketplace, so we keep a SHORT two-line "what you're approving" disclosure here; the FULL scope +
// consent (and the spec 248 record-scope caveat) live at the home's consent step, not on the relying app.
//
// The audit-hardened launcher (`lib/central-auth.ts`) pins the resolved Connect origin. On popup-BLOCKED
// we render the co-branded interstitial then fall back to the full-page redirect `startConnect` — an
// EXPLICIT fallback, never a silent reflow (ADR-0013). On cancel we show a soft warn banner; on error we
// surface it and let the user retry ("Try again").

import { useEffect, useRef, useState } from 'react';
import {
  Box, Button, Card, CardContent, Chip, CircularProgress, Stack, Typography,
} from '@mui/material';
import { chooseSignIn } from '@agenticprimitives/browser-identity';
import { JP } from '../lib/brand';
import { startConnect, startConnectPopup, type ConnectPopupSuccess, type ConnectPopupResult } from '../lib/connect-launch';

export function ConnectScreen({ onBack, onConnected }: {
  /** Back to the landing. */
  onBack: () => void;
  /** POPUP success → finish the connect IN PLACE (the App exchanges the code, sets the session, routes).
   *  Returns true on success; on a surfaced error we return to the form. */
  onConnected: (r: ConnectPopupSuccess) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  // Driven by the popup `AC_PROGRESS` messages; shown on the CTA while the popup is open. Falls back to a
  // default opener label.
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // spec 258 — soft "sign-in was cancelled" banner; cleared on the next cont().
  const [cancelled, setCancelled] = useState(false);
  // popups blocked → co-branded "Impact Community → JP" interstitial, then the redirect.
  const [blocked, setBlocked] = useState(false);

  const ctaRef = useRef<HTMLButtonElement>(null);
  // The in-flight popup's AbortController — the parent-side Cancel signals it (the only reliable cancel
  // under COOP; there is no popup.closed poll). Cleared when launch finishes/returns.
  const abortRef = useRef<AbortController | null>(null);

  // Focus the primary CTA on mount (spec 258 §9 focus management).
  useEffect(() => { ctaRef.current?.focus(); }, []);

  // ONE action: launch the credential-first connect. NEVER carries a name — the home owns credential
  // choice and (if a new passkey needs one) name entry.
  function cont() {
    setErr(null);
    setCancelled(false);
    void launch();
  }

  // Launch the POPUP ceremony directly (no bridge). On success the App finishes in place; on blocked we
  // segue to the co-branded interstitial; on cancel we show the soft warn banner; on error we surface it.
  async function launch() {
    setBusy(true); setErr(null);
    setProgress(`Opening your ${JP.impactName} home…`); // spec 258 — segue label until the broker posts progress
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      // spec 264 Phase 0 — the browser-integration adapter SEAM. Today only the `fallback` runs (the
      // spec-259 home popup), so behaviour is identical; Phase 1 injects the FedCM RP path here.
      // FedCM-first, not FedCM-only (ADR-0031).
      const res = await chooseSignIn<ConnectPopupResult>({
        fallback: () => startConnectPopup(undefined, (msg) => setProgress(msg), ac.signal),
      });
      if (res.status === 'success') {
        // Hand the CODE (only) to the App; it exchanges at /token + sets the session in place.
        const ok = await onConnected(res);
        if (!ok) { setBusy(false); setProgress(null); } // error surfaced by the App; let the user retry
        return;
      }
      if (res.status === 'blocked') {
        // EXPLICIT fallback (ADR-0013) — show the co-branded interstitial, then the full-page redirect.
        setProgress(null);
        setBlocked(true);
        return;
      }
      if (res.status === 'cancelled') {
        // Parent-side Cancel (or the 2-min abandon backstop) — soft warn banner, return to the form.
        setBusy(false); setProgress(null);
        setCancelled(true); // soft warn banner — try again below
        return;
      }
      setErr(res.error);
      setBusy(false); setProgress(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false); setProgress(null);
    } finally {
      abortRef.current = null;
    }
  }

  // Parent-side Cancel: abort the in-flight popup. The launcher resolves `cancelled`, which clears busy
  // and shows the soft banner above. We also clear busy defensively so the spinner never sticks.
  function cancelInFlight() {
    abortRef.current?.abort();
    setBusy(false); setProgress(null);
  }

  // The popup-blocked redirect fallback: the same `startConnect` ceremony, full-page (stashes PKCE +
  // navigates to the home, returns with ?code&state to the App's redirect-return handler). Nameless.
  async function redirectFallback() {
    setBusy(true); setErr(null);
    try {
      await startConnect(undefined);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
      setBlocked(false);
    }
  }

  if (blocked) {
    // co-branded "Impact Community → JP" interstitial; the load-bearing trust element is the co-brand
    // chip. Continue → the full-page redirect to the home.
    return <PopupBlocked onContinue={() => void redirectFallback()} onCancel={() => { setBlocked(false); setBusy(false); }} busy={busy} />;
  }

  return (
    <>
      {/* spec 258 §3c — dim the page behind the card while the popup is in flight. Cosmetic only (not a
          modal; does not trap focus). The card lifts above it via position/z-index. */}
      {busy && (
        <Box aria-hidden="true" sx={{ position: 'fixed', inset: 0, bgcolor: 'rgba(11, 19, 36, 0.52)', zIndex: 10, pointerEvents: 'none' }} />
      )}
      <Card sx={{ maxWidth: 560, mx: 'auto', ...(busy ? { position: 'relative', zIndex: 20 } : {}) }}>
        <CardContent sx={{ p: { xs: 2.5, sm: 3.5 } }}>
          {cancelled && (
            <Box role="status" sx={{ mb: 1.5, p: 1.25, bgcolor: '#fffbeb', border: '1px solid #fde68a', borderRadius: 1.5, color: '#92400e', fontSize: '.85rem' }}>
              Sign-in was cancelled — you can try again below.
            </Box>
          )}
          {err && (
            <Box role="alert" sx={{ mb: 1.5, p: 1.25, bgcolor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 1.5, color: '#991b1b', fontSize: '.85rem' }}>
              {err}
            </Box>
          )}

          <Typography variant="overline" sx={{ color: 'primary.main', fontWeight: 800, letterSpacing: '.12em' }}>
            Connect
          </Typography>
          <Typography variant="h5" sx={{ mt: 0.5, fontWeight: 800 }}>Connect with {JP.impactName}</Typography>
          <Typography sx={{ mt: 1, color: 'text.secondary', lineHeight: 1.6, fontSize: '.92rem' }}>
            Sign in through your {JP.impactName} home. {JP.org} only receives the access you approve, and
            your contact details stay private until you choose to share them.
          </Typography>

          <Box sx={{ mt: 1.5 }}>
            <Chip size="small" color="primary" variant="outlined" label="One identity · roles are just views" />
          </Box>

          {/* Short access-intent disclosure — JP is more sensitive than a plain marketplace, so we set
              expectations at the level of "what is this app asking for" + "you stay in control". The FULL
              scope + the spec 248 record-scope caveat live at the home's consent step, not here. */}
          <Box sx={{ mt: 2.5, p: 2, bgcolor: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: 2 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '.9rem', color: '#115e59' }}>
              What you&rsquo;re approving
            </Typography>
            <Typography sx={{ mt: 0.75, fontSize: '.84rem', color: 'text.secondary', lineHeight: 1.55 }}>
              {JP.org} can read and write your {JP.org}-program records through your {JP.impactName} home.
            </Typography>
            <Typography sx={{ mt: 0.75, fontSize: '.84rem', color: 'text.secondary', lineHeight: 1.55 }}>
              Revoke access anytime from your {JP.impactName} home — {JP.org}&rsquo;s visibility goes to zero.
            </Typography>
          </Box>

          <Stack spacing={1.25} sx={{ mt: 3 }} aria-busy={busy}>
            {/* The ONE primary CTA — always credential-first / nameless. Impact handles Google / passkey /
                wallet in the popup, shows the account chooser, and (only for a new passkey home) collects
                a name there — never here. */}
            <Button
              ref={ctaRef}
              variant="contained"
              color="primary"
              size="large"
              disabled={busy}
              onClick={() => cont()}
              startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <span aria-hidden>🌍</span>}
            >
              <span aria-live="polite">
                {busy ? (progress ?? `Opening your ${JP.impactName} home…`) : err ? 'Try again' : JP.ssoCta}
              </span>
            </Button>

            {/* Parent-side Cancel — visible only while the popup is in flight. The only reliable way to
                abort under COOP (no popup.closed poll). Sits directly under the busy CTA, above the dim. */}
            {busy && (
              <Button
                onClick={cancelInFlight}
                size="small"
                sx={{ alignSelf: 'center', color: 'primary.main', textTransform: 'none', minHeight: 44, px: 2 }}
              >
                Cancel
              </Button>
            )}

            {!busy && (
              <Button onClick={onBack} size="small" sx={{ alignSelf: 'flex-start', color: 'primary.main', textTransform: 'none', minHeight: 44 }}>
                ← Back
              </Button>
            )}
          </Stack>
        </CardContent>
      </Card>
    </>
  );
}

// The popup-blocked, co-branded "Impact Community → JP" interstitial. The co-brand chip is the
// load-bearing trust element; Continue runs the full-page redirect fallback (ADR-0013, explicit).
function PopupBlocked({ onContinue, onCancel, busy }: { onContinue: () => void; onCancel: () => void; busy: boolean }) {
  const ctaRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { ctaRef.current?.focus(); }, []);
  return (
    <Card sx={{ maxWidth: 560, mx: 'auto' }}>
      <CardContent sx={{ p: { xs: 2.5, sm: 3.5 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1.5 }}>
          <Chip size="small" color="primary" variant="outlined" label={`${JP.impactName} → ${JP.org}`} />
        </Box>
        <Typography variant="h6" sx={{ textAlign: 'center', fontWeight: 800 }}>Blocked by your browser</Typography>
        <Typography sx={{ mt: 1, color: 'text.secondary', textAlign: 'center', lineHeight: 1.6, fontSize: '.92rem' }}>
          Your browser blocked the secure sign-in window. We can take you to your {JP.impactName} home in
          this tab and bring you back to {JP.org} after you confirm.
        </Typography>
        <Stack spacing={1} alignItems="center" sx={{ mt: 3 }}>
          <Button ref={ctaRef} variant="contained" color="primary" onClick={onContinue} disabled={busy}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
            Continue in this tab
          </Button>
          <Button onClick={onCancel} disabled={busy} size="small" sx={{ color: 'primary.main', textTransform: 'none' }}>
            Cancel
          </Button>
          <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center' }}>
            The page that opens will say impact-agent.me — that is your home, not a new site.
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}
