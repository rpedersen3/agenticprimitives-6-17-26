// Role-agnostic connect screen (spec 252 design spec §15a/§15b, reworked per direct UX feedback).
// Connecting is now ONE simple action — there is no GCO/KC choice here. The member sees a short
// role-agnostic grant disclosure + a name field, then launches the PERSON site-login. The role
// (offer expertise / set up an org) is chosen AFTER connecting, from inside the intranet (the RoleHub).
//
// Continue launches the SAME plain site-login ceremony OnboardPanel uses, via `startConnect('kc', name)`
// — the person/site-login path that returns `tok.delegation` (person → Switchboard grant). It does NOT
// touch the connect-client or the App's connect-return handler. There is no `mode:'gco'` at connect.
//
// §15b.1 caveat: scope copy says "intended Switchboard program scope" — record-level enforcement is
// owner-keyed today (spec 248 C-2), so we never claim cryptographic record-type isolation.

import { useState } from 'react';
import { GS } from '../lib/gs-brand';
import { personalHome, toAgentName } from '../lib/domain';
import { startConnect, LAST_NAME_KEY } from '../lib/connect-launch';
import { Banner, Card, Pill, Spinner, TextField } from './ui';
import { HandoffBridge } from './HandoffBridge';

export function ConnectScreen({ onBack }: {
  /** Back to the landing. */
  onBack: () => void;
}) {
  const [name, setName] = useState<string>(() => {
    try { return localStorage.getItem(LAST_NAME_KEY) ?? ''; } catch { return ''; }
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Spec 255 W2 — show the method-agnostic handoff bridge BEFORE firing startConnect (its PKCE stash +
  // redirect must not run until the user confirms on the bridge, or cancels back to the form).
  const [showBridge, setShowBridge] = useState(false);
  const trimmed = name.trim();

  function cont() {
    if (!trimmed) { setErr(`Choose your ${GS.community} name (e.g. rich-pedersen).`); return; }
    setErr(null);
    setShowBridge(true);
  }

  // The bridge's "continue" actually launches the ceremony (stashes PKCE + redirects; same flow as
  // OnboardPanel). It does NOT touch the connect-client or the App's connect-return handler.
  async function launch() {
    setShowBridge(false);
    setBusy(true); setErr(null);
    try {
      // Role-agnostic: everyone connects as a PERSON. The role is chosen in the hub afterwards.
      await startConnect(trimmed);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (showBridge) {
    // METHOD-AGNOSTIC variant: the connect entry hasn't chosen passkey vs Google yet (the method is
    // picked at the Impact home), so the bridge carries domain reassurance only — no passkey jargon.
    return <HandoffBridge variant="new-user" onContinue={() => void launch()} onCancel={() => setShowBridge(false)} />;
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
        <label style={{ fontSize: '.78rem', fontWeight: 800, color: 'var(--c-g700)', letterSpacing: '.02em' }}>Your {GS.community} name</label>
        <TextField
          value={name} placeholder="e.g. rich-pedersen" mono disabled={busy}
          onChange={(v) => setName(v.toLowerCase().replace(/[^a-z0-9.-]/g, ''))}
          onEnter={() => void cont()}
          style={{ padding: '.7rem .9rem', fontSize: '1rem' }}
        />
        {trimmed && (
          <div style={{ fontSize: '.75rem', color: 'var(--c-g500)', fontFamily: "'SF Mono','Roboto Mono',monospace" }}>
            {toAgentName(trimmed)} · home at {personalHome(trimmed)}
          </div>
        )}
        <button className="btn-sso" onClick={() => void cont()} disabled={!trimmed || busy} title={GS.ssoCta}>
          <span className="btn-sso-glyph" aria-hidden="true">{busy ? <Spinner /> : '🌐'}</span>
          {busy ? 'Opening your home…' : GS.ssoCta}
        </button>
        {err && <Banner tone="err">{err}</Banner>}
        <div style={{ fontSize: '.82rem', color: 'var(--c-primary)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <button onClick={onBack} style={linkBtn}>← Back</button>
        </div>
        {/* Spec 255 W1.3 — set the tap-count expectation. This entry can't tell new vs returning, so we
            use the new-user copy (two confirmations: create the key, then approve the setup). */}
        <span className="soon" style={{ background: 'var(--c-g50)', borderColor: 'var(--c-g200)', color: 'var(--c-g600)' }}>
          At your Impact home you&rsquo;ll confirm twice — once to create your key (one time, forever), then
          once to approve your setup. Then you&rsquo;ll come back here.
        </span>
      </div>
    </Card>
  );
}

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--c-primary)', cursor: 'pointer', fontSize: '.82rem', fontWeight: 600, padding: 0, textDecoration: 'underline',
};
