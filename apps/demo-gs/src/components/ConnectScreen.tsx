// Relying-site connect screen (spec 257 credential-first spine; spec 258 connect-UX; spec 259 relying ⇄
// IdP responsibility split). The relying site answers ONLY: why am I connecting, what access is this app
// asking for, what happens after, and launch / cancel / popup-blocked / retry. It NEVER asks for an
// Impact name — credential choice, account discovery, the account chooser, name lookup/claim, recovery,
// and delegation consent ALL belong to the Global.Church home (demo-sso). This mirrors how mature SSO
// works (Google "Continue with", Apple, Clerk, Privy, WorkOS): the relying app trusts the returned
// subject (`id_token.sub` = the Smart Account CAIP-10 address); the name is a public handle/profile
// facet, never the login key. A NEW passkey may still need a handle — but that is collected INSIDE the
// home popup (the WebAuthn RP ID is domain-bound), never here. See ADR-0029 + spec 259.
//
// Spec 258: ONE card, ONE primary CTA. "Continue with Global.Church" launches the Connect ceremony in a
// POPUP over the (dimmed) site DIRECTLY — no pre-popup interstitial. The popup finishes IN PLACE.
//
// The audit-hardened launcher (`lib/central-auth.ts`) pins the resolved Connect origin. On popup-BLOCKED
// we render the co-branded interstitial then fall back to the full-page redirect `startConnect` — an
// EXPLICIT fallback, never a silent reflow (ADR-0013). On cancel we show a soft warn banner; on error we
// surface it and let the user retry ("Try again").
//
// §15b.1 caveat: scope copy says "the access you approve" — record-level enforcement is owner-keyed today
// (spec 248 C-2), so we never claim cryptographic record-type isolation. The full scope + consent is
// shown at the home's consent step, not here.

import { useEffect, useRef, useState } from 'react';
import { chooseSignIn } from '@agenticprimitives/browser-identity';
import { GS } from '../lib/gs-brand';
import {
  startConnect, startConnectPopup, startConnectFedcm, fedcmAvailable,
  type ConnectPopupSuccess, type ConnectFedcmSuccess, type ConnectPopupResult,
} from '../lib/connect-launch';
import { Banner, Btn, Card, Pill, Spinner } from './ui';

export function ConnectScreen({ onBack, onConnected }: {
  /** Back to the landing. */
  onBack: () => void;
  /** Connect success → finish IN PLACE. Popup success carries a CODE the App exchanges at /token; FedCM
   *  success carries the id_token + delegation directly. Returns true on success; on error → back to form. */
  onConnected: (r: ConnectPopupSuccess | ConnectFedcmSuccess) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  // Driven by the popup `AC_PROGRESS` messages; shown on the CTA while the popup is open. Falls back to a
  // default opener label.
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // spec 258 — soft "sign-in was cancelled" banner; cleared on the next cont().
  const [cancelled, setCancelled] = useState(false);
  // popups blocked → co-branded "Global.Church → Impact" interstitial, then the redirect.
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
    setProgress(`Opening your ${GS.community} home…`); // spec 258 — segue label until the broker posts progress
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      // spec 264 — the browser-integration adapter seam. FedCM-first, not FedCM-only (ADR-0031): when the
      // browser supports FedCM we run the FedCM RP ceremony; on ANY failure (dismissed / errored / no
      // grant) it falls through to the GUARANTEED spec-259 popup. Non-FedCM browsers use the popup directly.
      const popup = () => startConnectPopup(undefined, (msg) => setProgress(msg), ac.signal);
      const res = await chooseSignIn<ConnectPopupResult>({
        fedcm: fedcmAvailable()
          ? async () => {
              try {
                return await startConnectFedcm((msg) => setProgress(msg));
              } catch {
                // FedCM consumed the user gesture (or the user isn't signed into their home yet), so a
                // popup would be BLOCKED. Fall back to the full-page REDIRECT — it needs no gesture and
                // takes the user to their home to sign in, then returns with ?code. Never a blocked-popup
                // dead-end.
                setProgress('Opening your Global.Church home…');
                await startConnect(undefined);
                return { status: 'cancelled' as const }; // navigation happens first; unreachable
              }
            }
          : undefined,
        fallback: popup,
      });
      if (res.status === 'success' || res.status === 'fedcm-success') {
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
    // co-branded "Global.Church → Impact" interstitial; the load-bearing trust element is the co-brand
    // pill. Continue → the full-page redirect to the home.
    return <PopupBlocked onContinue={() => void redirectFallback()} onCancel={() => { setBlocked(false); setBusy(false); }} busy={busy} />;
  }

  return (
    <>
      {/* spec 258 §3c — dim the page behind the card while the popup is in flight. Cosmetic only (not a
          modal; does not trap focus). The card lifts above it via position/z-index. */}
      {busy && (
        <div aria-hidden="true" style={{ position: 'fixed', inset: 0, background: 'rgba(11, 19, 36, 0.52)', zIndex: 10, pointerEvents: 'none' }} />
      )}
      <Card style={{ maxWidth: 520, margin: '0 auto', ...(busy ? { position: 'relative', zIndex: 20 } : {}) }}>
        {cancelled && <Banner tone="warn">Sign-in was cancelled — you can try again below.</Banner>}
        {err && <Banner tone="err">{err}</Banner>}

        <div className="eyebrow" style={{ marginTop: cancelled || err ? '.9rem' : 0 }}>Connect</div>
        <h2 style={{ fontSize: '1.5rem', marginTop: '.35rem' }}>Connect with {GS.community}</h2>
        <p style={{ fontSize: '.92rem', color: 'var(--c-g700)', marginTop: '.6rem', lineHeight: 1.55 }}>
          Sign in through your {GS.community} home. Switchboard only receives the access you approve, and
          your contact details stay private until you accept a connection.
        </p>

        <div style={{ marginTop: '1rem' }}><Pill tone="ok">One identity · roles are just views</Pill></div>

        <div aria-busy={busy} style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
          {/* The ONE primary CTA — always credential-first / nameless. Global.Church handles Google /
              passkey / wallet in the popup, shows the account chooser, and (only for a new passkey home)
              collects a name there — never here. */}
          <button ref={ctaRef} className="btn-sso" onClick={() => cont()} disabled={busy} title={`Continue with ${GS.community}`}>
            <span className="btn-sso-glyph" aria-hidden="true">{busy ? <Spinner /> : '🌐'}</span>
            <span aria-live="polite">
              {busy ? (progress ?? `Opening your ${GS.community} home…`) : err ? 'Try again' : `Continue with ${GS.community}`}
            </span>
          </button>

          {/* Parent-side Cancel — visible only while the popup is in flight. The only reliable way to
              abort under COOP (no popup.closed poll). Sits directly under the busy CTA, above the dim. */}
          {busy && (
            <button onClick={cancelInFlight} style={{ ...linkBtn, textAlign: 'center', alignSelf: 'center', padding: '.4rem .8rem' }}>
              Cancel
            </button>
          )}

          <div style={{ fontSize: '.82rem', color: 'var(--c-primary)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            {!busy && <button onClick={onBack} style={{ ...linkBtn, padding: '.4rem .2rem' }}>&larr; Back</button>}
          </div>
        </div>
      </Card>
    </>
  );
}

// The popup-blocked, co-branded "Global.Church → Impact" interstitial. The co-brand pill is the
// load-bearing trust element; Continue runs the full-page redirect fallback (ADR-0013, explicit).
function PopupBlocked({ onContinue, onCancel, busy }: { onContinue: () => void; onCancel: () => void; busy: boolean }) {
  const ctaRef = useRef<HTMLDivElement>(null);
  useEffect(() => { ctaRef.current?.querySelector('button')?.focus(); }, []);
  return (
    <Card style={{ maxWidth: 540, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '.9rem' }}>
        <Pill tone="ok">{GS.community} → Impact</Pill>
      </div>
      <h2 style={{ fontSize: '1.4rem', textAlign: 'center', marginTop: 0 }}>Blocked by your browser</h2>
      <p style={{ fontSize: '.92rem', color: 'var(--c-g700)', textAlign: 'center', marginTop: '.6rem', lineHeight: 1.55 }}>
        Your browser blocked the secure sign-in window. We can take you to your {GS.community} home in this
        tab and bring you back to Switchboard after you confirm.
      </p>
      <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.6rem' }}>
        <div ref={ctaRef}><Btn variant="primary" onClick={onContinue} busy={busy}>Continue in this tab</Btn></div>
        <button onClick={onCancel} style={{ ...linkBtn, padding: '.4rem .8rem' }} disabled={busy}>Cancel</button>
        <span style={{ fontSize: '.74rem', color: 'var(--c-g500)', textAlign: 'center' }}>
          The page that opens will say impact-agent.me &mdash; that is your home, not a new site.
        </span>
      </div>
    </Card>
  );
}

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--c-primary)', cursor: 'pointer', fontSize: '.82rem', fontWeight: 600, padding: 0, textDecoration: 'underline', textAlign: 'left',
};
