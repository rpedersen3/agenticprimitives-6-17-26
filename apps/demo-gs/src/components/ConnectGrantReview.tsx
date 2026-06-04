// Role-aware connect + grant review (spec 252 design spec §8/§15a/§15b). Shown BEFORE the Global.Church
// handoff so the member sees the access review (owner · scope · purpose · limit) and can switch path.
// Continue launches the SAME site-login ceremony OnboardPanel uses via the shared `startConnect` helper
// — it does NOT touch the connect-client or the App's connect-return handler. The org-create second step
// (GCO) still happens after return, from inside the intranet (unchanged).
//
// §15b.1 caveat: scope copy says "intended Switchboard program scope" — record-level enforcement is
// owner-keyed today (spec 248 C-2), so we never claim cryptographic record-type isolation.

import { useState } from 'react';
import { GS, type OnboardKind } from '../lib/gs-brand';
import { personalHome, toAgentName } from '../lib/domain';
import { startConnect, LAST_NAME_KEY } from '../lib/connect-launch';
import { Banner, Card, inputStyle, Pill } from './ui';

/** Per-path disclosure copy (§15a content model + §15b owner/scope/purpose/limit). */
const REVIEW: Record<OnboardKind, {
  selected: string;
  doesLines: string[];
  owner: string;
  scope: string;
  purpose: string;
  limit: string;
}> = {
  gco: {
    selected: 'GCO Organization',
    doesLines: [
      'Connect your Global.Church home (your identity + private vault).',
      'Create an organization, deployed + custodied by YOUR credential, that takes the GCO role.',
      'Mint a scoped grant so Switchboard can read that org’s needs — then you post a need.',
    ],
    owner: 'your GCO org Smart Agent',
    scope: 'posted needs + match status (intended Switchboard program scope)',
    purpose: 'broker explainable matches against KC offerings',
    limit: 'revocable any time at your Global.Church home',
  },
  kc: {
    selected: 'KC Expert',
    doesLines: [
      'Connect your Global.Church home (your identity + private vault).',
      'Grant Switchboard scoped access to read the expertise offering you publish.',
      'No organization to create — you act as your own person agent.',
    ],
    owner: 'your person Smart Agent',
    scope: 'published offering + match status (intended Switchboard program scope)',
    purpose: 'introduce reason-coded matches from GCOs whose needs overlap your skills',
    limit: 'revocable any time at your Global.Church home',
  },
};

export function ConnectGrantReview({ kind, onSwitchPath, onBack }: {
  kind: OnboardKind;
  /** Switch to the other role’s review without leaving the screen. */
  onSwitchPath: (next: OnboardKind) => void;
  /** Back to the landing (help-me-choose). */
  onBack: () => void;
}) {
  const r = REVIEW[kind];
  const other: OnboardKind = kind === 'gco' ? 'kc' : 'gco';
  const [name, setName] = useState<string>(() => {
    try { return localStorage.getItem(LAST_NAME_KEY) ?? ''; } catch { return ''; }
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const trimmed = name.trim();

  async function cont() {
    if (!trimmed) { setErr(`Choose your ${GS.community} name (e.g. rich-pedersen).`); return; }
    setBusy(true); setErr(null);
    try {
      await startConnect(kind, trimmed); // stashes PKCE + redirects; same flow as OnboardPanel
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Card style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="eyebrow">Before you connect</div>
      <h2 style={{ fontSize: '1.5rem', marginTop: '.35rem' }}>{GS.ssoCta}</h2>
      <div style={{ marginTop: '.5rem' }}><Pill tone="ok">Selected: {r.selected}</Pill></div>

      <h3 style={{ fontSize: '.95rem', marginTop: '1.25rem', color: 'var(--c-g800)' }}>What {GS.community} will do</h3>
      <ul style={{ paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '.35rem', marginTop: '.4rem' }}>
        {r.doesLines.map((l, i) => <li key={i} style={{ fontSize: '.86rem', color: 'var(--c-g700)' }}>{l}</li>)}
      </ul>

      <h3 style={{ fontSize: '.95rem', marginTop: '1.1rem', color: 'var(--c-g800)' }}>What Switchboard will receive</h3>
      <div style={{ marginTop: '.5rem', background: 'var(--c-primary-subtle)', border: '1.5px solid var(--c-primary-border)', borderRadius: 12, padding: '.8rem 1rem', display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
        <Line k="Owner" v={r.owner} bold />
        <Line k="Scope" v={r.scope} />
        <Line k="Purpose" v={r.purpose} />
        <Line k="Limit" v={r.limit} />
        <span style={{ fontSize: '.78rem', color: 'var(--c-primary-active)', marginTop: '.2rem' }}>
          Your contact is released only when a connection is accepted.
        </span>
      </div>

      <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
        <label style={{ fontSize: '.78rem', fontWeight: 800, color: 'var(--c-g700)', letterSpacing: '.02em' }}>Your {GS.community} name</label>
        <input
          type="text" value={name} placeholder="e.g. rich-pedersen" autoCapitalize="none" spellCheck={false} disabled={busy}
          onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter') void cont(); }}
          style={{ ...inputStyle, padding: '.7rem .9rem', fontSize: '1rem', fontFamily: "'SF Mono','Roboto Mono',monospace" }}
        />
        {trimmed && (
          <div style={{ fontSize: '.75rem', color: 'var(--c-g500)', fontFamily: "'SF Mono','Roboto Mono',monospace" }}>
            {toAgentName(trimmed)} · home at {personalHome(trimmed)}
          </div>
        )}
        <button className="btn-sso" onClick={() => void cont()} disabled={!trimmed || busy} title={GS.ssoCta}>
          <span className="btn-sso-glyph" aria-hidden="true">🌐</span>
          {busy ? 'Opening your home…' : `Continue to ${GS.community}`}
        </button>
        {err && <Banner tone="err">{err}</Banner>}
        <div style={{ fontSize: '.82rem', color: 'var(--c-primary)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <button onClick={() => onSwitchPath(other)} style={linkBtn}>
            Switch path: {other === 'gco' ? 'GCO Organization' : 'KC expert'}
          </button>
          <button onClick={onBack} style={linkBtn}>Help me choose</button>
        </div>
        <span className="soon" style={{ background: 'var(--c-g50)', borderColor: 'var(--c-g200)', color: 'var(--c-g600)' }}>
          You&rsquo;ll confirm with your device at <b>{personalHome(trimmed || 'your-name')}</b>, then come back here.
        </span>
      </div>
    </Card>
  );
}

function Line({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <span style={{ fontSize: '.84rem', color: 'var(--c-primary-active)', fontWeight: bold ? 700 : 400 }}>
      <b style={{ fontWeight: 800 }}>{k}:</b> {v}
    </span>
  );
}

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--c-primary)', cursor: 'pointer', fontSize: '.82rem', fontWeight: 600, padding: 0, textDecoration: 'underline',
};
