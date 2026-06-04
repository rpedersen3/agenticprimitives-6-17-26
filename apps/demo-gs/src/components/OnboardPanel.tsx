// The onboarding landing for a new member (mirrors demo-jp's OnboardPanel). Shows the flow steps,
// takes a Global.Church name, previews <name>.impact-agent.me, and connects via the shared identity
// (KC = individual person login; GCO = person login + create the org that holds the GCO role).
// Wave 2 (spec 252): members come ONLY from a real Connect sign-in — there is NO sample identity. A
// sample identity has no SA and cannot sign a delegation, so it could never write its own vault.
// Once connected the view becomes the member intranet (driven by the session in `lib/session.ts`).

import { useState } from 'react';
import { GS, type OnboardKind } from '../lib/gs-brand';
import { personalHome, toAgentName } from '../lib/domain';
import { LAST_NAME_KEY, startConnect } from '../lib/connect-launch';
import { Banner, Card, inputStyle } from './ui';

// Stash key + shape now live in `lib/connect-launch` (shared with ConnectScreen); re-exported here
// for the App's connect-return handler, which still imports them from OnboardPanel.
export { CONNECT_KEY, type ConnectStash } from '../lib/connect-launch';

// Both roles first enroll the PERSON via the shared identity (site-login). A KC then acts as that
// individual; a GCO signatory creates the org that holds the GCO role as a SECOND step from inside
// the intranet (org-create needs an existing person — exactly demo-jp's Adopter two-step).
export function OnboardPanel({ kind }: { kind: OnboardKind }) {
  const p = GS.paths[kind];
  const [name, setName] = useState<string>(() => {
    try { return localStorage.getItem(LAST_NAME_KEY) ?? ''; } catch { return ''; }
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const trimmed = name.trim();

  async function connect() {
    if (!trimmed) { setErr(`Choose your ${GS.community} name (e.g. rich-pedersen).`); return; }
    setBusy(true); setErr(null);
    try {
      await startConnect(trimmed); // role-agnostic person login; stashes PKCE + redirects to the home
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Card style={{ maxWidth: 720 }}>
      <div className="eyebrow">{kind === 'gco' ? 'GCO Organization · demand' : 'KC Expert · supply'}</div>
      <h2 style={{ fontSize: '1.5rem', marginTop: '.35rem' }}>{p.title}</h2>
      <div style={{ color: 'var(--c-primary)', fontWeight: 700, fontSize: '.8rem', textTransform: 'uppercase', letterSpacing: '.04em', marginTop: '.25rem' }}>{p.who}</div>
      <p style={{ color: 'var(--c-g600)', marginTop: '.75rem' }}>{p.body}</p>

      <p style={{ marginTop: '1rem', fontWeight: 700, color: 'var(--c-g800)' }}>Here&rsquo;s the flow:</p>
      <ol style={{ paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '.4rem', marginTop: '.4rem' }}>
        {p.steps.map((s, i) => <li key={i} style={{ fontSize: '.9rem', color: 'var(--c-g700)' }}>{s}</li>)}
      </ol>
      <p style={{ marginTop: '1rem', fontSize: '.85rem', color: 'var(--c-g600)' }}>
        {GS.org} runs the marketplace. {GS.community} is your private identity + data vault — Switchboard only
        sees what you grant, and you can revoke it any time.
      </p>

      <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '.6rem', maxWidth: 460 }}>
        <label style={{ fontSize: '.78rem', fontWeight: 800, color: 'var(--c-g700)', letterSpacing: '.02em' }}>Your {GS.community} name</label>
        <input
          type="text" value={name} placeholder="e.g. rich-pedersen" autoCapitalize="none" spellCheck={false} disabled={busy}
          onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter') void connect(); }}
          style={{ ...inputStyle, padding: '.7rem .9rem', fontSize: '1rem', fontFamily: "'SF Mono','Roboto Mono',monospace" }}
        />
        {kind === 'gco' && (
          <p style={{ fontSize: '.76rem', color: 'var(--c-g500)', margin: 0 }}>
            You&rsquo;ll name + create the organization that takes the GCO role right after you connect.
          </p>
        )}
        {trimmed && (
          <div style={{ fontSize: '.75rem', color: 'var(--c-g500)', fontFamily: "'SF Mono','Roboto Mono',monospace" }}>
            {toAgentName(trimmed)} · home at {personalHome(trimmed)}
          </div>
        )}
        <button className="btn-sso" onClick={connect} disabled={!trimmed || busy} title={GS.ssoCta}>
          <span className="btn-sso-glyph" aria-hidden="true">🌐</span>
          {busy ? 'Opening your home…' : GS.ssoCta}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: '.72rem', fontWeight: 600, color: 'var(--c-g400)' }}>SSO + your vault</span>
        </button>
        {err && <Banner tone="err">{err}</Banner>}
        <span className="soon" style={{ background: 'var(--c-primary-subtle)', borderColor: 'var(--c-primary-border)', color: 'var(--c-primary-active)' }}>
          You&rsquo;ll confirm with your device at <b>{personalHome(trimmed || 'your-name')}</b>, then come back here to continue.
        </span>
      </div>
    </Card>
  );
}
