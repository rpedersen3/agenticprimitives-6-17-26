// Phase 1 — connect a real person via the shared Global.Church identity (demo-sso), exactly
// like demo-jp's Adopter/Facilitator. A KC connects as an INDIVIDUAL (their person SA); a GCO
// signatory connects AND creates an ORG that holds the GCO role (the home deploys the org SA
// custodied by their ROOT credential). This is the Switchboard pilot's Phase-2 "one-tap, arrives
// pre-identified" arrival: no local account, the identity comes from <name>.impact-agent.me.

import { useState } from 'react';
import { startOrgCreation, startSiteEnrollment } from '../connect-client';
import { Banner, Btn, Card, SectionHead, inputStyle } from './ui';

/** sessionStorage key for the in-flight Connect redirect (read back by the App on return). */
export const CONNECT_KEY = 'agenticprimitives:demo-gs:connect';

export interface ConnectStash {
  mode: 'kc' | 'gco';
  name: string;
  orgName?: string;
  state: string;
  authOrigin: string;
  codeVerifier: string;
}

export function ConnectPanel({ mode }: { mode: 'kc' | 'gco' }) {
  const [name, setName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function connect() {
    if (!name.trim()) { setErr('Enter your Global.Church name (e.g. maria).'); return; }
    if (mode === 'gco' && !orgName.trim()) { setErr('Enter the GCO organization name.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = mode === 'kc'
        ? await startSiteEnrollment(name.trim())
        : await startOrgCreation(name.trim(), orgName.trim());
      const stash: ConnectStash = { mode, name: name.trim(), orgName: orgName.trim(), state: r.state, authOrigin: r.authOrigin, codeVerifier: r.codeVerifier };
      sessionStorage.setItem(CONNECT_KEY, JSON.stringify(stash));
      window.location.href = r.url; // → the person's secure home; returns with ?code&state
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Card style={{ borderColor: 'var(--c-accent-border)', background: 'var(--c-accent-subtle)' }}>
      <SectionHead
        eyebrow="Phase 1 · shared identity"
        title={mode === 'kc' ? 'Connect as a KC expert' : 'Connect + create a GCO organization'}
        sub={mode === 'kc'
          ? 'Sign in with your Global.Church identity — you arrive pre-identified as your person agent (the KC individual). No second account; the identity comes from your secure home.'
          : 'Sign in with your Global.Church identity, then create an organization that takes the GCO role. The org SA is deployed + custodied by YOUR credential at your home — Global Switchboard is never a custodian.'}
      />
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Your Global.Church name (e.g. maria)" value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, flex: '1 1 200px' }} />
        {mode === 'gco' && (
          <input placeholder="GCO org name (e.g. Hope Church Missions Team)" value={orgName} onChange={(e) => setOrgName(e.target.value)} style={{ ...inputStyle, flex: '1 1 240px' }} />
        )}
        <Btn busy={busy} onClick={connect}>Connect via Global.Church ↗</Btn>
      </div>
      {err && <div style={{ marginTop: '.6rem' }}><Banner tone="err">{err}</Banner></div>}
      <p style={{ fontSize: '.74rem', color: 'var(--c-g500)', marginTop: '.5rem' }}>
        Or keep using the local demo identities above (no sign-in). Phase 1 wires the real shared identity.
      </p>
    </Card>
  );
}
