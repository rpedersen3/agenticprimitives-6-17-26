import { useState } from 'react';
import { JP } from './lib/brand';

// Public-facing capability site for the Joshua Project Adopt-a-People-Group pilot (spec 236).
// PUBLIC UX ONLY for now — the "Continue to Impact" handoff (connect → create org → add data →
// sign MOU/WEA → return to the adopter/facilitator intranet) is wired in the next phase.

const WEA_AFFIRMATIONS = [
  'The Holy Scriptures as originally given by God, divinely inspired, infallible, entirely trustworthy; and the supreme authority in all matters of faith and conduct.',
  'One God, eternally existent in three persons, Father, Son and Holy Spirit.',
  'Our Lord Jesus Christ, God manifest in the flesh, His virgin birth, His sinless human life, His divine miracles, His vicarious and atoning death, His bodily resurrection, His ascension, His mediatorial work, and His personal return in power and glory.',
  'The Salvation of lost and sinful man through the shed blood of the Lord Jesus Christ by faith apart from works, and regeneration by the Holy Spirit.',
  'The Holy Spirit by whose indwelling the believer is enabled to live a holy life, to witness and work for the Lord Jesus Christ.',
  'The Unity of the Spirit of all true believers, the Church, the Body of Christ.',
  'The Resurrection of both the saved and the lost; they that are saved unto the resurrection of life, they that are lost unto the resurrection of damnation.',
];

type Modal = null | { kind: 'adopter' | 'facilitator' } | { kind: 'wea' };

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function App() {
  const [modal, setModal] = useState<Modal>(null);

  return (
    <>
      <header className="topbar">
        <div className="wrap">
          <div className="brand">
            <span className="brand-glyph" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
              </svg>
            </span>
            <div>
              {JP.appName}<small>{JP.org} · Frontier People Groups</small>
            </div>
          </div>
          <span className="powered">Powered by <b>{JP.impactName}</b></span>
        </div>
      </header>

      {/* Hero + stats */}
      <section className="hero">
        <div className="wrap">
          <div className="eyebrow">{JP.hero.eyebrow}</div>
          <h1 style={{ marginTop: '.6rem' }}>{JP.hero.title}</h1>
          <p className="hero-sub">{JP.hero.sub}</p>
          <p className="hero-note">{JP.hero.note}</p>
          <div className="hero-cta">
            <button className="btn btn-primary btn-lg" onClick={() => setModal({ kind: 'adopter' })}>{JP.paths.adopter.cta}</button>
            <button className="btn btn-ghost btn-lg" onClick={() => setModal({ kind: 'facilitator' })}>{JP.paths.facilitator.cta}</button>
          </div>
          <div className="stats">
            {JP.stats.map((s) => (
              <div className="stat" key={s.label}>
                <div className="stat-v">{s.value}{'of' in s && s.of ? <span className="of"> / {s.of}</span> : null}</div>
                <div className="stat-l">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Five movements */}
      <section className="section wrap">
        <div className="sec-head">
          <div className="eyebrow">The five movements</div>
          <h2>Adoption is a journey, not a form</h2>
          <p>Adopting a Frontier People Group means walking the ADOPT path — and you don’t walk it alone.</p>
        </div>
        <div className="movements">
          {JP.movements.map((m) => (
            <div className="move" key={m.k}>
              <div className="move-k" aria-hidden="true">{m.k}</div>
              <h3>{m.title}</h3>
              <p>{m.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Two paths */}
      <section className="section wrap" style={{ paddingTop: 0 }}>
        <div className="sec-head"><h2>Two ways to take part</h2></div>
        <div className="paths">
          {(['adopter', 'facilitator'] as const).map((k) => {
            const p = JP.paths[k];
            return (
              <div className={`path${k === 'adopter' ? ' accent' : ''}`} key={k}>
                <h3>{p.title}</h3>
                <div className="path-who">{p.who}</div>
                <p className="path-body">{p.body}</p>
                <ol>{p.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                <button className={`btn ${k === 'adopter' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setModal({ kind: k })}>{p.cta}</button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Trust model — JP runs the program; Impact Community is the data custodian/vault. */}
      <section className="section wrap" style={{ paddingTop: 0 }}>
        <div className="trust">
          <div className="eyebrow" style={{ color: 'var(--c-primary-mid)' }}>Self-sovereign by design</div>
          <h2>{JP.trust.title}</h2>
          <div className="trust-grid">
            {JP.trust.points.map((pt, i) => (
              <div className="trust-pt" key={i}><CheckIcon /><span>{pt}</span></div>
            ))}
          </div>
        </div>
      </section>

      {/* Agreements */}
      <section className="section wrap" style={{ paddingTop: 0 }}>
        <div className="sec-head">
          <div className="eyebrow">Accountability</div>
          <h2>What you agree to</h2>
          <p>Both are signed inside your {JP.impactName} vault and held with you. JP receives the attestation that you signed — not the document itself.</p>
        </div>
        <div className="agreements">
          <div className="agreement">
            <h3>{JP.mou.name}</h3>
            <p>{JP.mou.blurb}</p>
          </div>
          <div className="agreement">
            <h3>{JP.wea.name}</h3>
            <p>{JP.wea.blurb}</p>
            <button onClick={() => setModal({ kind: 'wea' })}>Read the statement →</button>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <span>{JP.org} · Adopt-a-People-Group pilot — JP runs the program.</span>
          <span>Identity + data vault: <b style={{ color: 'var(--c-primary)' }}>{JP.impactName}</b>. You stay in control.</span>
        </div>
      </footer>

      {modal && (modal.kind === 'adopter' || modal.kind === 'facilitator') && (
        <OnboardPanel kind={modal.kind} onClose={() => setModal(null)} />
      )}
      {modal && modal.kind === 'wea' && <WeaModal onClose={() => setModal(null)} />}
    </>
  );
}

function OnboardPanel({ kind, onClose }: { kind: 'adopter' | 'facilitator'; onClose: () => void }) {
  const p = JP.paths[kind];
  return (
    <div className="scrim" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <button className="panel-x" onClick={onClose} aria-label="Close">×</button>
        <h2>{p.cta}</h2>
        <div className="who">{p.who}</div>
        <p style={{ color: 'var(--c-g600)', marginTop: '.75rem' }}>{p.body}</p>
        <p style={{ marginTop: '1rem', fontWeight: 700, color: 'var(--c-g800)' }}>Here’s the flow:</p>
        <ol>{p.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        <p style={{ marginTop: '1rem', fontSize: '.85rem', color: 'var(--c-g600)' }}>
          {JP.org} runs the adoption program. {JP.impactName} is your private identity + data vault — JP only
          sees what you grant, and you can revoke it any time.
        </p>
        <div className="panel-foot" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '.6rem' }}>
          <button className="btn-sso" disabled title="Wired in the next phase">
            <span className="btn-sso-glyph" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
              </svg>
            </span>
            {JP.ssoCta}
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: '.72rem', fontWeight: 600, color: 'var(--c-g400)' }}>SSO + your vault</span>
          </button>
          <span className="soon">{JP.ssoCta} is wired in the next phase — this is the public preview.</span>
        </div>
      </div>
    </div>
  );
}

function WeaModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="scrim" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <button className="panel-x" onClick={onClose} aria-label="Close">×</button>
        <h2>{JP.wea.name}</h2>
        <p style={{ color: 'var(--c-g600)', margin: '.5rem 0 1rem' }}>We believe in:</p>
        <ul className="wea-text">{WEA_AFFIRMATIONS.map((a, i) => <li key={i}>{a}</li>)}</ul>
        <div className="panel-foot">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <span className="soon">You’ll affirm this inside your {JP.impactName} home during onboarding.</span>
        </div>
      </div>
    </div>
  );
}
