// Role-agnostic, credential-first connect screen (spec 257 credential-first spine; spec 258 connect-UX
// redesign). Connecting is ONE simple action — no GCO/KC choice here; the role is chosen AFTER connecting
// from inside the intranet (the RoleHub).
//
// Spec 258: ONE card, ONE primary CTA. "Continue with Global.Church" launches the Connect ceremony in a
// POPUP over the (dimmed) site DIRECTLY — there is NO pre-popup handoff-bridge interstitial anymore. The
// name is a SECONDARY disclosure ("Use my Impact name instead"): a public handle, not a login key. An
// empty name lets the broker show its W1 credential-first entry (the token `sub` binds the PROVEN
// credential, never a client name). The popup finishes IN PLACE — no page load.
//
// The audit-hardened launcher (`lib/central-auth.ts`) pins the resolved Connect origin. On popup-BLOCKED
// we render the co-branded interstitial then fall back to the full-page redirect `startConnect` — an
// EXPLICIT fallback, never a silent reflow (ADR-0013). On cancel we show a soft warn banner; on error we
// surface it and let the user retry ("Try again").
//
// §15b.1 caveat: scope copy says "intended Switchboard program scope" — record-level enforcement is
// owner-keyed today (spec 248 C-2), so we never claim cryptographic record-type isolation.

import { useEffect, useRef, useState } from 'react';
import { GS } from '../lib/gs-brand';
import { personalHome, toAgentName } from '../lib/domain';
import { startConnect, startConnectPopup, LAST_NAME_KEY, type ConnectPopupSuccess } from '../lib/connect-launch';
import { Banner, Btn, Card, Pill, Spinner, TextField } from './ui';

export function ConnectScreen({ onBack, onConnected }: {
  /** Back to the landing. */
  onBack: () => void;
  /** POPUP success → finish the connect IN PLACE (the App exchanges the code, sets the session, toasts).
   *  Returns true on success; on a surfaced error we return to the form. */
  onConnected: (r: ConnectPopupSuccess) => Promise<boolean>;
}) {
  const [name, setName] = useState<string>(() => {
    try { return localStorage.getItem(LAST_NAME_KEY) ?? ''; } catch { return ''; }
  });
  const [busy, setBusy] = useState(false);
  // Driven by the popup `AC_PROGRESS` messages; shown on the CTA while the popup is open. Falls back to a
  // default opener label.
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // spec 258 — the secondary "Use my Impact name instead" disclosure (collapsed by default).
  const [showNamePanel, setShowNamePanel] = useState(false);
  // spec 258 — soft "sign-in was cancelled" banner; cleared on the next cont().
  const [cancelled, setCancelled] = useState(false);
  // popups blocked → co-branded "Global.Church → Impact" interstitial, then the redirect.
  const [blocked, setBlocked] = useState(false);
  const trimmed = name.trim();

  const ctaRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Focus the primary CTA on mount (spec 258 §9 focus management).
  useEffect(() => { ctaRef.current?.focus(); }, []);
  // When the name panel expands, move focus into the field (spec 258 §9).
  useEffect(() => { if (showNamePanel) nameRef.current?.focus(); }, [showNamePanel]);

  function cont() {
    // Name is OPTIONAL (credential-first): no empty-name guard. The broker shows its W1 entry.
    setErr(null);
    setCancelled(false);
    void launch();
  }

  // Launch the POPUP ceremony directly (no bridge). On success the App finishes in place; on blocked we
  // segue to the co-branded interstitial; on cancel we show the soft warn banner; on error we surface it.
  async function launch() {
    setBusy(true); setErr(null);
    setProgress('Opening your Impact home…'); // spec 258 — segue label until the broker posts progress
    try {
      const res = await startConnectPopup(trimmed || undefined, (msg) => setProgress(msg));
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
        setBusy(false); setProgress(null);
        setCancelled(true); // soft warn banner — try again below
        return;
      }
      setErr(res.error);
      setBusy(false); setProgress(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false); setProgress(null);
    }
  }

  // The popup-blocked redirect fallback: the same `startConnect` ceremony, full-page (stashes PKCE +
  // navigates to the home, returns with ?code&state to the App's redirect-return handler).
  async function redirectFallback() {
    setBusy(true); setErr(null);
    try {
      await startConnect(trimmed || undefined);
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
      <Card style={{ maxWidth: 560, margin: '0 auto', ...(busy ? { position: 'relative', zIndex: 20 } : {}) }}>
        {cancelled && <Banner tone="warn">Sign-in was cancelled — you can try again below.</Banner>}
        {err && <Banner tone="err">{err}</Banner>}

        <div className="eyebrow" style={{ marginTop: cancelled || err ? '.9rem' : 0 }}>Connect</div>
        <h2 style={{ fontSize: '1.5rem', marginTop: '.35rem' }}>Connect with {GS.community}</h2>
        <p style={{ fontSize: '.9rem', color: 'var(--c-g700)', marginTop: '.6rem', lineHeight: 1.55 }}>
          Use your {GS.community} identity to enter Switchboard. You can offer your expertise or set up an
          organization after you connect. Switchboard only receives the access you approve, and your
          contact details stay private until you accept a connection.
        </p>

        <div style={{ marginTop: '1rem' }}><Pill tone="ok">One identity · roles are workspaces</Pill></div>

        <div aria-busy={busy} style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
          {/* Primary CTA — always visible. */}
          <button ref={ctaRef} className="btn-sso" onClick={() => void cont()} disabled={busy} title={GS.ssoCta}>
            <span className="btn-sso-glyph" aria-hidden="true">{busy ? <Spinner /> : '🌐'}</span>
            <span aria-live="polite">
              {busy ? (progress ?? 'Opening your Impact home…') : (err ? 'Try again' : `Continue with ${GS.community}`)}
            </span>
          </button>

          {/* Secondary disclosure — collapsed by default. */}
          {!showNamePanel && (
            <>
              <button onClick={() => setShowNamePanel(true)} style={linkBtn} disabled={busy}>
                Use my Impact name instead
              </button>
              <p style={{ fontSize: '.82rem', color: 'var(--c-g500)', margin: 0 }}>
                Your Impact name is a public handle people can use to find your agent. You do not need it to
                sign back in.
              </p>
            </>
          )}

          {/* Name panel — expanded inline (no new screen). */}
          {showNamePanel && (
            <div style={{ borderTop: '1px solid var(--c-g200)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              <label style={{ fontSize: '.72rem', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--c-g500)' }}>
                Your Impact name
              </label>
              <p style={{ fontSize: '.82rem', color: 'var(--c-g600)', margin: 0 }}>
                Your public handle — people can find your agent by this name.
              </p>
              <TextField
                inputRef={nameRef}
                value={name} placeholder="e.g. rich-pedersen" mono disabled={busy}
                onChange={(v) => setName(v.toLowerCase().replace(/[^a-z0-9.-]/g, ''))}
                onEnter={() => void cont()}
                style={{ padding: '.7rem .9rem', fontSize: '1rem' }}
              />
              {trimmed && (
                <output style={{ fontSize: '.75rem', color: 'var(--c-g500)', fontFamily: "'SF Mono','Roboto Mono',monospace" }}>
                  {toAgentName(trimmed)} · home at {personalHome(trimmed)}
                </output>
              )}
              <p style={{ fontSize: '.78rem', color: 'var(--c-g500)', margin: 0 }}>
                You do not need a name to sign back in — it is a public handle, not a password.
              </p>
              <button onClick={() => setShowNamePanel(false)} style={linkBtn} disabled={busy}>
                Hide — use Google or passkey without a name
              </button>
            </div>
          )}

          <div style={{ fontSize: '.82rem', color: 'var(--c-primary)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <button onClick={onBack} style={linkBtn} disabled={busy}>&larr; Back</button>
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
        Your browser blocked the secure sign-in window. We can take you to your Impact home in this tab and
        bring you back to Switchboard after you confirm.
      </p>
      <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.6rem' }}>
        <div ref={ctaRef}><Btn variant="primary" onClick={onContinue} busy={busy}>Continue in this tab</Btn></div>
        <button onClick={onCancel} style={linkBtn} disabled={busy}>Cancel</button>
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
