// The session-less workspace fallback for a new/returning member (mirrors demo-jp's OnboardPanel).
// Spec 258: credential-first + name-deferred. This panel is CONTENT-ONLY — it explains the role's
// flow and then routes to the SAME credential-first ConnectScreen via `onConnect`. It NO LONGER
// takes a Global.Church name or calls `startConnect` directly: a missing session must never gate the
// user behind a name-required, redirect-only second sign-in mechanism (ADR-0013 "one mechanism";
// product-analysis A7/A8). The name is a PUBLIC HANDLE chosen (optionally) on the connect card, not a
// login key.
// Wave 2 (spec 252): members come ONLY from a real Connect sign-in — there is NO sample identity. A
// sample identity has no SA and cannot sign a delegation, so it could never write its own vault.
// Once connected the view becomes the member intranet (driven by the session in `lib/session.ts`).

import { GS, type OnboardKind } from '../lib/gs-brand';
import { Card } from './ui';

// Stash key + shape live in `lib/connect-launch` (shared with ConnectScreen); re-exported here for
// any consumer that still imports them from OnboardPanel (harmless — the canonical source is
// `lib/connect-launch`).
export { CONNECT_KEY, type ConnectStash } from '../lib/connect-launch';

// Both roles first enroll the PERSON via the shared credential-first connect. A KC then acts as that
// individual; a GCO signatory creates the org that holds the GCO role as a SECOND step from inside
// the intranet (org-create needs an existing person — exactly demo-jp's Adopter two-step).
export function OnboardPanel({ kind, onConnect }: { kind: OnboardKind; onConnect: () => void }) {
  const p = GS.paths[kind];

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
        {kind === 'gco' && (
          <p style={{ fontSize: '.76rem', color: 'var(--c-g500)', margin: 0 }}>
            You&rsquo;ll name + create the organization that takes the GCO role right after you connect.
          </p>
        )}
        <button className="btn-sso" onClick={onConnect} title={GS.ssoCta}>
          <span className="btn-sso-glyph" aria-hidden="true">🌐</span>
          {GS.ssoCta}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: '.72rem', fontWeight: 600, color: 'var(--c-g400)' }}>SSO + your vault</span>
        </button>
        <span className="soon" style={{ background: 'var(--c-primary-subtle)', borderColor: 'var(--c-primary-border)', color: 'var(--c-primary-active)' }}>
          You&rsquo;ll confirm at your {GS.community} home, then come back here to continue. Your name is a
          public handle — you don&rsquo;t need one to sign in.
        </span>
      </div>
    </Card>
  );
}
