// Role-agnostic, credential-first connect screen (spec 257 Phase 1 Wave 2; spec 252 §15a/§15b).
// Connecting is ONE simple action — no GCO/KC choice here; the role is chosen AFTER connecting from
// inside the intranet (the RoleHub).
//
// Wave 2 swap: Continue now opens the Connect ceremony in a POPUP over the (dimmed) site (greenfield
// 02→07) and finishes IN PLACE — no page load. The name is OPTIONAL: an empty name lets the broker show
// its W1 credential-first entry (the token `sub` binds the PROVEN credential, never a client name). The
// audit-hardened launcher (`lib/central-auth.ts`) pins the resolved Connect origin (e.origin /
// e.source / m.state checks). On popup-BLOCKED we render the co-branded interstitial (greenfield 11)
// then fall back to the full-page redirect `startConnect` — an EXPLICIT fallback, never a silent reflow
// (ADR-0013). On cancel we return to the form.
//
// §15b.1 caveat: scope copy says "intended Switchboard program scope" — record-level enforcement is
// owner-keyed today (spec 248 C-2), so we never claim cryptographic record-type isolation.

import { useState } from 'react';
import { GS } from '../lib/gs-brand';
import { personalHome, toAgentName } from '../lib/domain';
import { startConnect, startConnectPopup, LAST_NAME_KEY, type ConnectPopupSuccess } from '../lib/connect-launch';
import { Banner, Btn, Card, Pill, Spinner, TextField } from './ui';
import { HandoffBridge } from './HandoffBridge';

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
  // Driven by the popup `AC_PROGRESS` messages (greenfield 02 "Opening secure connect…"); shown on the
  // CTA while the popup is open. Falls back to a default opener label.
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Spec 255 W2 — show the method-agnostic handoff bridge BEFORE firing the popup (its PKCE + ceremony
  // must not run until the user confirms on the bridge, or cancels back to the form).
  const [showBridge, setShowBridge] = useState(false);
  // greenfield 11 — popups blocked → co-branded "Global.Church → Impact" interstitial, then the redirect.
  const [blocked, setBlocked] = useState(false);
  const trimmed = name.trim();

  function cont() {
    // Name is OPTIONAL (credential-first): no empty-name guard. The broker shows its W1 entry.
    setErr(null);
    setShowBridge(true);
  }

  // The bridge's "continue" launches the POPUP ceremony. On success the App finishes in place; on blocked
  // we segue to the co-branded interstitial; on cancel we return to the form.
  async function launch() {
    setShowBridge(false);
    setBusy(true); setErr(null);
    setProgress('Opening secure connect…'); // greenfield 02 — segue label until the broker posts progress
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
        setBusy(false); setProgress(null); // back to the form
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

  if (showBridge) {
    // METHOD-AGNOSTIC variant: the connect entry hasn't chosen passkey vs Google yet (the method is
    // picked at the Impact home), so the bridge carries domain reassurance only — no passkey jargon.
    return <HandoffBridge variant="new-user" onContinue={() => void launch()} onCancel={() => setShowBridge(false)} />;
  }

  if (blocked) {
    // greenfield 11 — co-branded "Global.Church → Impact" interstitial; the load-bearing trust element is
    // the co-brand pill. Continue → the full-page redirect to the home.
    return <PopupBlocked onContinue={() => void redirectFallback()} onCancel={() => { setBlocked(false); setBusy(false); }} busy={busy} />;
  }

  return (
    <Card style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="eyebrow">Connect</div>
      <h2 style={{ fontSize: '1.5rem', marginTop: '.35rem' }}>{GS.ssoCta}</h2>
      <p style={{ fontSize: '.9rem', color: 'var(--c-g700)', marginTop: '.6rem', lineHeight: 1.55 }}>
        Connect your {GS.community} identity. {GS.org} reads only what you grant; your contact stays
        private until you accept a connection. You&rsquo;ll pick what you want to do — offer your expertise,
        or set up an organization to post needs — once you&rsquo;re inside.
      </p>

      <div style={{ marginTop: '1rem' }}><Pill tone="ok">One identity · roles are workspaces</Pill></div>

      <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
        <label style={{ fontSize: '.78rem', fontWeight: 800, color: 'var(--c-g700)', letterSpacing: '.02em' }}>
          Your {GS.community} name <span style={{ fontWeight: 600, color: 'var(--c-g400)' }}>(optional)</span>
        </label>
        <TextField
          value={name} placeholder="e.g. rich-pedersen — or leave blank" mono disabled={busy}
          onChange={(v) => setName(v.toLowerCase().replace(/[^a-z0-9.-]/g, ''))}
          onEnter={() => void cont()}
          style={{ padding: '.7rem .9rem', fontSize: '1rem' }}
        />
        {trimmed && (
          <div style={{ fontSize: '.75rem', color: 'var(--c-g500)', fontFamily: "'SF Mono','Roboto Mono',monospace" }}>
            {toAgentName(trimmed)} · home at {personalHome(trimmed)}
          </div>
        )}
        <button className="btn-sso" onClick={() => void cont()} disabled={busy} title={GS.ssoCta}>
          <span className="btn-sso-glyph" aria-hidden="true">{busy ? <Spinner /> : '🌐'}</span>
          {busy ? (progress ?? 'Opening secure connect…') : GS.ssoCta}
        </button>
        {err && <Banner tone="err">{err}</Banner>}
        <div style={{ fontSize: '.82rem', color: 'var(--c-primary)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <button onClick={onBack} style={linkBtn} disabled={busy}>← Back</button>
        </div>
        {/* Credential-first: the Connect ceremony opens in a focused window OVER this page; sign in with
            your device, Google, or wallet — your name is just a public handle, not a login. */}
        <span className="soon" style={{ background: 'var(--c-g50)', borderColor: 'var(--c-g200)', color: 'var(--c-g600)' }}>
          A focused {GS.community} window opens over this page — sign in with your device, Google, or wallet.
          Your name is a public handle others use to find you, not something you need to remember to get back in.
        </span>
      </div>
    </Card>
  );
}

// greenfield 11 — the popup-blocked, co-branded "Global.Church → Impact" interstitial. The co-brand pill
// is the load-bearing trust element; Continue runs the full-page redirect fallback (ADR-0013, explicit).
function PopupBlocked({ onContinue, onCancel, busy }: { onContinue: () => void; onCancel: () => void; busy: boolean }) {
  return (
    <Card style={{ maxWidth: 540, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '.9rem' }}>
        <Pill tone="ok">{GS.community} → Impact</Pill>
      </div>
      <h2 style={{ fontSize: '1.4rem', textAlign: 'center', marginTop: 0 }}>One tap to your secure home</h2>
      <p style={{ fontSize: '.92rem', color: 'var(--c-g700)', textAlign: 'center', marginTop: '.6rem', lineHeight: 1.55 }}>
        Your browser blocked the popup, so we&rsquo;ll take you to your {GS.community} home and bring you right back.
      </p>
      <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.6rem' }}>
        <Btn variant="primary" onClick={onContinue} busy={busy}>Continue to your home</Btn>
        <button onClick={onCancel} style={linkBtn} disabled={busy}>Cancel</button>
        <span style={{ fontSize: '.74rem', color: 'var(--c-g400)', textAlign: 'center' }}>
          The page will name your secure home — that&rsquo;s you, not a new site.
        </span>
      </div>
    </Card>
  );
}

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--c-primary)', cursor: 'pointer', fontSize: '.82rem', fontWeight: 600, padding: 0, textDecoration: 'underline',
};
