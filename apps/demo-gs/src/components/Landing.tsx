// Signed-out landing (spec 252 design spec §8/§15a). Hero (demand vs supply value) + role CTAs that
// preserve intent into the role-aware connect path, the public skill-gap signal as an acquisition
// surface (computed from the deterministic public bridged demand — pure, no network), and trust cards.
// The header `Connect` opens a chooser; the CTAs here pre-select a role into the grant-review entry.

import { useMemo } from 'react';
import type { OnboardKind } from '../lib/gs-brand';
import { GS } from '../lib/gs-brand';
import { computeSignal } from '../lib/signal';
import { publicNeeds, publicOfferings } from '../lib/public-data';
import { Card } from './ui';

export function Landing({ onChoose }: { onChoose: (kind: OnboardKind) => void }) {
  // The public skill-gap signal — the same dataset the public /api/signal serves (no member data).
  const signal = useMemo(() => computeSignal(publicNeeds(), publicOfferings()), []);
  const topSkills = signal.bySkill.slice(0, 6);
  const max = topSkills[0]?.n ?? 1;

  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, lineHeight: 1.15 }}>
          Find the Kingdom expertise you need —<br />
          <span style={{ color: 'var(--c-primary)' }}>or offer yours.</span>
        </h1>
        <p style={{ fontSize: '1rem', color: 'var(--c-g600)', marginTop: '.75rem', maxWidth: 680 }}>
          {GS.community} holds your identity + data. {GS.org} brokers explainable matches and explains
          every one. You grant scoped access at sign-in and revoke it any time.
        </p>
        <div style={{ display: 'flex', gap: '.75rem', marginTop: '1.25rem', flexWrap: 'wrap' }}>
          <button className="btn-primary" onClick={() => onChoose('gco')} style={cta}>Post a need (GCO →)</button>
          <button className="btn-ghost" onClick={() => onChoose('kc')} style={cta}>Offer a skill (KC →)</button>
        </div>
      </div>

      <Card>
        <div className="eyebrow">Public skill-gap signal · /api/signal</div>
        <h2 style={{ fontSize: '1.2rem', marginTop: '.35rem' }}>Open skill gaps right now</h2>
        <p style={{ fontSize: '.84rem', color: 'var(--c-g500)', marginTop: '.3rem' }}>
          {signal.openCount} open need{signal.openCount === 1 ? '' : 's'} in the public demand feed. Counts only —
          never a specific match.
        </p>
        <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          {topSkills.length === 0 && <p style={{ fontSize: '.84rem', color: 'var(--c-g400)' }}>No open needs in the public feed right now.</p>}
          {topSkills.map((s) => (
            <div key={s.uri} style={{ display: 'flex', alignItems: 'center', gap: '.7rem' }}>
              <span style={{ width: 130, fontSize: '.84rem', color: 'var(--c-g700)' }}>{s.label}</span>
              <div style={{ flex: 1, height: 9, borderRadius: 999, background: 'var(--c-g100)' }}>
                <div style={{ width: `${Math.max(8, (s.n / max) * 100)}%`, height: '100%', borderRadius: 999, background: 'var(--c-primary)' }} />
              </div>
              <strong style={{ fontSize: '.84rem', minWidth: 18, textAlign: 'right' }}>{s.n}</strong>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
        {GS.trust.points.slice(0, 3).map((t, i) => (
          <Card key={i}>
            <div style={{ display: 'inline-block', background: 'var(--c-primary-subtle)', border: '1px solid var(--c-primary-border)', borderRadius: 999, padding: '.15rem .6rem', fontSize: '.66rem', fontWeight: 800, color: 'var(--c-primary-active)', letterSpacing: '.04em' }}>
              {['DATA', 'BROKER', 'ISSUER'][i]}
            </div>
            <p style={{ fontSize: '.86rem', color: 'var(--c-g700)', marginTop: '.7rem' }}>{t}</p>
          </Card>
        ))}
      </div>

      <p style={{ fontSize: '.82rem', color: 'var(--c-g500)' }}>
        Three steps: Connect via {GS.community} → choose your role → work from your secure workspace.
      </p>
    </div>
  );
}

const cta: React.CSSProperties = {
  borderRadius: 10, padding: '.7rem 1.3rem', fontWeight: 700, fontSize: '.92rem', cursor: 'pointer', border: 'none',
};
