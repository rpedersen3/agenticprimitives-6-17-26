import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Address } from '@agenticprimitives/types';
import { JP, GATEWAY } from './lib/brand';
import { startSiteEnrollment, exchangeCode, verifyIdToken } from './connect-client';
import { toAgentName as fullName, personalHome, personalAuthOrigin, nameLabel } from './lib/domain';
import {
  type AdopterStep, type AdopterType, type ImpactProfile, type JpAdopterRecord,
  adopterSteps, isAdopterOnboardingComplete, loadImpactProfile, loadJpAdopterRecord,
  nextAdopterStep, projectForJp, requiresWea, saveJpAdopterRecord,
} from './lib/vault';
import { MOU_DOC_ID, MOU_TEXT, attestDocConsentBound } from './lib/mou';
import { FPG_SEED, findPeopleGroup, formatPopulation, type PeopleGroup } from './lib/people-groups';

// JP-Adopt is a RELYING APP (spec 236). JP runs the program; the member's Impact Community
// home holds the data + delegates scoped access. Onboarding is a JOINT flow — Impact already
// holds the profile + community-wide attestations (WEA), JP only runs the JP-specific
// ceremonies (the ADOPT MOU + the public adoption declaration). The adopter dashboard mirrors
// that split: passive "✓ on file" checks where Impact owns the data, interactive panels where
// JP runs the ceremony.

const WEA_AFFIRMATIONS = [
  'The Holy Scriptures as originally given by God, divinely inspired, infallible, entirely trustworthy; and the supreme authority in all matters of faith and conduct.',
  'One God, eternally existent in three persons, Father, Son and Holy Spirit.',
  'Our Lord Jesus Christ, God manifest in the flesh, His virgin birth, His sinless human life, His divine miracles, His vicarious and atoning death, His bodily resurrection, His ascension, His mediatorial work, and His personal return in power and glory.',
  'The Salvation of lost and sinful man through the shed blood of the Lord Jesus Christ by faith apart from works, and regeneration by the Holy Spirit.',
  'The Holy Spirit by whose indwelling the believer is enabled to live a holy life, to witness and work for the Lord Jesus Christ.',
  'The Unity of the Spirit of all true believers, the Church, the Body of Christ.',
  'The Resurrection of both the saved and the lost; they that are saved unto the resurrection of life, they that are lost unto the resurrection of damnation.',
];

type Kind = 'adopter' | 'facilitator';
type Modal = null | { kind: Kind } | { kind: 'wea' };

const SESSION_KEY = 'agenticprimitives:demo-jp:session';
const ENROLL_KEY = 'agenticprimitives:demo-jp:enroll';

interface Session {
  token: string;
  name: string;
  address: Address;
  kind: Kind;
  fresh: boolean;
}

interface EnrollStash {
  state?: string;
  name?: string;
  authOrigin?: string;
  codeVerifier?: string;
  nonce?: string;
  kind?: Kind;
}

function decodeToken(token: string): { sub?: string; exp?: number } | null {
  try {
    const seg = token.split('.')[1] ?? '';
    const json = atob(seg.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((2 - (seg.length & 3)) & 3));
    return JSON.parse(json) as { sub?: string; exp?: number };
  } catch {
    return null;
  }
}

function addrFromSub(sub?: string): Address | null {
  const m = sub?.match(/0x[0-9a-fA-F]{40}$/);
  return (m?.[0] as Address) ?? null;
}

function restoreSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { token?: string; name?: string; kind?: Kind };
    if (!s.token || !s.name || (s.kind !== 'adopter' && s.kind !== 'facilitator')) return null;
    const dec = decodeToken(s.token);
    const addr = addrFromSub(dec?.sub);
    if (!addr || !dec?.exp || dec.exp * 1000 <= Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return { token: s.token, name: s.name, address: addr, kind: s.kind, fresh: false };
  } catch {
    return null;
  }
}

// ── Icons ───────────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function GlobeGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

// ── App ─────────────────────────────────────────────────────────────────────

export function App() {
  const [session, setSession] = useState<Session | null>(restoreSession);
  const [modal, setModal] = useState<Modal>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const openSession = useCallback((token: string, name: string, kind: Kind, fresh: boolean) => {
    const addr = addrFromSub(decodeToken(token)?.sub);
    if (!addr) {
      setError("We couldn't read your agent address from the session token.");
      return;
    }
    setSession({ token, name, address: addr, kind, fresh });
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ token, name, kind }));
    } catch {
      /* ignore */
    }
  }, []);

  const signOut = useCallback(() => {
    setSession(null);
    setError(null);
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }, []);

  // OIDC return-path handler (demo-org / spec 230 pattern).
  useEffect(() => {
    const u = new URL(window.location.href);
    const code = u.searchParams.get('code');
    const retState = u.searchParams.get('state');
    const err = u.searchParams.get('enroll_error');
    if (!code && !err) return;
    for (const k of ['code', 'state', 'enroll_error']) u.searchParams.delete(k);
    window.history.replaceState({}, '', u.toString());
    if (err) { setError(`Sign-in was not completed (${err}).`); return; }

    let stash: EnrollStash = {};
    try { stash = JSON.parse(sessionStorage.getItem(ENROLL_KEY) ?? '{}') as EnrollStash; } catch { /* ignore */ }
    if (!stash.state || !retState || stash.state !== retState) {
      setError("We couldn't verify that response. Please try again.");
      return;
    }
    sessionStorage.removeItem(ENROLL_KEY);
    if (!code || !stash.authOrigin || !stash.codeVerifier || !stash.kind) {
      setError('Sign-in response was incomplete. Please try again.');
      return;
    }
    void (async () => {
      try {
        const tok = await exchangeCode(stash.authOrigin!, code, stash.codeVerifier!);
        const claims = await verifyIdToken(stash.authOrigin!, tok.idToken, stash.nonce ?? '');
        const name = claims.agent_name ?? stash.name ?? '';
        openSession(tok.idToken, name, stash.kind!, true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'sign-in failed');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const beginConnect = useCallback(async (name: string, kind: Kind) => {
    setError(null);
    try {
      setBusy('Opening your secure home…');
      const { url, state, authOrigin, codeVerifier, nonce } = await startSiteEnrollment(name);
      const stash: EnrollStash = { state, name, authOrigin, codeVerifier, nonce, kind };
      sessionStorage.setItem(ENROLL_KEY, JSON.stringify(stash));
      window.location.href = url;
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : "Couldn't start sign-in.");
    }
  }, []);

  if (session) {
    if (session.kind === 'adopter') {
      return <AdopterIntranet session={session} onSignOut={signOut} onOpenWea={() => setModal({ kind: 'wea' })} />;
    }
    return <FacilitatorIntranet session={session} onSignOut={signOut} onOpenWea={() => setModal({ kind: 'wea' })} />;
  }

  // ── Signed-out marketing page (unchanged from the user-approved version) ────
  return (
    <>
      <header className="topbar">
        <div className="wrap">
          <div className="brand">
            <span className="brand-glyph" aria-hidden="true"><GlobeGlyph /></span>
            <div>{JP.appName}<small>{JP.org} · Frontier People Groups</small></div>
          </div>
          <span className="powered">Powered by <b>{GATEWAY.community}</b></span>
        </div>
      </header>

      {error && (
        <div role="alert" style={{ background: '#fef2f2', borderBottom: '1px solid #fecaca', color: '#991b1b', padding: '.75rem 1.25rem', textAlign: 'center', fontSize: '.875rem' }}>{error}</div>
      )}

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
        <OnboardPanel
          kind={modal.kind}
          busy={busy}
          onClose={() => { setModal(null); setBusy(null); }}
          onConnect={(name) => beginConnect(name, modal.kind as Kind)}
        />
      )}
      {modal && modal.kind === 'wea' && <WeaModal onClose={() => setModal(null)} />}
    </>
  );
}

// ── Onboarding-entry panel (unchanged) ──────────────────────────────────────

function OnboardPanel({ kind, busy, onClose, onConnect }: {
  kind: Kind; busy: string | null; onClose: () => void; onConnect: (name: string) => void;
}) {
  const p = JP.paths[kind];
  const [name, setName] = useState<string>(() => {
    try { return localStorage.getItem('agenticprimitives:demo-jp:last-name') ?? ''; } catch { return ''; }
  });
  const trimmed = name.trim();
  const submit = () => {
    if (!trimmed || busy) return;
    try { localStorage.setItem('agenticprimitives:demo-jp:last-name', trimmed); } catch { /* ignore */ }
    onConnect(trimmed);
  };
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
          {JP.org} runs the adoption program. {JP.impactName} is your private identity + data
          vault — JP only sees what you grant, and you can revoke it any time.
        </p>
        <div className="panel-foot" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '.6rem' }}>
          <label htmlFor="jp-impact-name" style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--c-g700)', letterSpacing: '.02em' }}>
            Your {JP.impactName} name
          </label>
          <input
            id="jp-impact-name" type="text" value={name}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="e.g. rich-pedersen" autoComplete="username" autoCapitalize="none"
            spellCheck={false} disabled={!!busy}
            style={{ padding: '.75rem .9rem', fontSize: '1rem', borderRadius: 10, border: '1.5px solid var(--c-g300)', background: '#fff', width: '100%', fontFamily: "'SF Mono','Roboto Mono',monospace" }}
          />
          {trimmed && (
            <div style={{ fontSize: '.75rem', color: 'var(--c-g500)', fontFamily: "'SF Mono','Roboto Mono',monospace" }}>
              {fullName(trimmed)} · home at {personalHome(trimmed)}
            </div>
          )}
          <button className="btn-sso" onClick={submit} disabled={!trimmed || !!busy} title="Connect via Impact Community">
            <span className="btn-sso-glyph" aria-hidden="true"><GlobeGlyph size={16} /></span>
            {busy ?? JP.ssoCta}
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: '.72rem', fontWeight: 600, color: 'var(--c-g400)' }}>SSO + your vault</span>
          </button>
          <span className="soon" style={{ background: 'var(--c-primary-subtle)', borderColor: 'var(--c-primary-border)', color: 'var(--c-primary-active)' }}>
            You’ll confirm with your device at <b>{personalHome(trimmed || 'your-name')}</b>, then come back here to continue with JP.
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Adopter Intranet ────────────────────────────────────────────────────────
// The dashboard for an adopter. Loads the member's Impact profile (passive — JP
// observes via the delegation) + the JP adopter record (interactive — JP runs
// these ceremonies). Steps that Impact already satisfies show as "✓ on file";
// JP-specific steps expand into inline forms when active.

function AdopterIntranet({ session, onSignOut, onOpenWea }: {
  session: Session; onSignOut: () => void; onOpenWea: () => void;
}) {
  const [impact] = useState<ImpactProfile>(() => loadImpactProfile(session.address, session.name));
  const [record, setRecord] = useState<JpAdopterRecord>(() => loadJpAdopterRecord(session.address));
  const update = useCallback((next: JpAdopterRecord) => { saveJpAdopterRecord(session.address, next); setRecord(next); }, [session.address]);

  const steps = useMemo(() => adopterSteps(impact, record), [impact, record]);
  const activeStep = useMemo(() => nextAdopterStep(impact, record), [impact, record]);
  const complete = useMemo(() => isAdopterOnboardingComplete(impact, record), [impact, record]);
  const homeUrl = personalAuthOrigin(nameLabel(session.name));

  return (
    <>
      <IntranetTopbar session={session} subtitle="Adopter dashboard" onSignOut={onSignOut} />

      {session.fresh && (
        <div style={{ background: 'var(--c-primary-subtle)', borderBottom: '1px solid var(--c-primary-border)', padding: '.75rem 1.25rem', textAlign: 'center', fontSize: '.9rem', color: 'var(--c-primary-active)' }}>
          ✓ Connected via {JP.impactName} — welcome, <b>{session.name}</b>. Your home + vault are at{' '}
          <a href={homeUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c-primary)' }}>{homeUrl}</a>.
        </div>
      )}

      {complete ? (
        <AdoptionSummary session={session} record={record} impact={impact} />
      ) : (
        <>
          <section className="hero" style={{ padding: '3rem 0 2rem' }}>
            <div className="wrap">
              <div className="eyebrow">{JP.paths.adopter.who}</div>
              <h1 style={{ marginTop: '.5rem', fontSize: 'clamp(1.6rem, 4vw, 2.4rem)' }}>{JP.paths.adopter.title}</h1>
              <p className="hero-sub" style={{ fontSize: '1rem' }}>
                {JP.org} runs the program; {JP.impactName} holds the data. We’re only asking you for what JP needs that
                isn’t already on file with your home.
              </p>
            </div>
          </section>

          <section className="section wrap" style={{ paddingTop: 0 }}>
            <div className="sec-head">
              <div className="eyebrow">Adopter onboarding</div>
              <h2>Just the JP-specific steps — your profile is already on file</h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.875rem', marginTop: '1.5rem' }}>
              {steps.map((s, i) => (
                <StepCard
                  key={s.step}
                  n={i + 1}
                  step={s.step}
                  ownedBy={s.ownedBy}
                  active={s.step === activeStep}
                  satisfied={s.satisfied}
                  impact={impact}
                  record={record}
                  session={session}
                  onUpdate={update}
                  onOpenWea={onOpenWea}
                />
              ))}
            </div>
          </section>

          <JpProjectionPanel impact={impact} record={record} session={session} />
        </>
      )}

      <IntranetFooter />
    </>
  );
}

function IntranetTopbar({ session, subtitle, onSignOut }: { session: Session; subtitle: string; onSignOut: () => void }) {
  const short = `${session.address.slice(0, 6)}…${session.address.slice(-4)}`;
  return (
    <header className="topbar">
      <div className="wrap">
        <div className="brand">
          <span className="brand-glyph" aria-hidden="true"><GlobeGlyph /></span>
          <div>{JP.appName}<small>{JP.org} · {subtitle}</small></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
          <span className="powered" title={session.address}>{session.name} · {short}</span>
          <button className="btn btn-ghost" style={{ padding: '.5rem 1rem', fontSize: '.85rem' }} onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    </header>
  );
}

function IntranetFooter() {
  return (
    <footer>
      <div className="wrap">
        <span>{JP.org} · Adopt-a-People-Group pilot — JP runs the program.</span>
        <span>Identity + data vault: <b style={{ color: 'var(--c-primary)' }}>{JP.impactName}</b>. You stay in control.</span>
      </div>
    </footer>
  );
}

// ── Step orchestration ──────────────────────────────────────────────────────

function StepCard({
  n, step, ownedBy, active, satisfied, impact, record, session, onUpdate, onOpenWea,
}: {
  n: number; step: AdopterStep; ownedBy: 'impact' | 'jp'; active: boolean; satisfied: boolean;
  impact: ImpactProfile; record: JpAdopterRecord; session: Session;
  onUpdate: (next: JpAdopterRecord) => void; onOpenWea: () => void;
}) {
  const meta = stepMeta(step);
  const status: 'done' | 'active' | 'pending' = satisfied ? 'done' : active ? 'active' : 'pending';
  return (
    <div className="agreement" style={{
      display: 'flex', gap: '1rem', alignItems: 'flex-start',
      borderColor: status === 'active' ? 'var(--c-primary-border)' : 'var(--c-g200)',
      background: status === 'active' ? 'linear-gradient(180deg, var(--c-primary-subtle) 0%, #fff 60%)' : 'var(--c-g50)',
      opacity: status === 'pending' ? .55 : 1,
    }}>
      <div style={{
        flex: '0 0 auto', width: 36, height: 36, borderRadius: 999,
        background: status === 'done' ? 'var(--c-primary)' : status === 'active' ? 'var(--c-primary)' : 'var(--c-g200)',
        color: status === 'done' || status === 'active' ? '#fff' : 'var(--c-g600)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '.9rem',
      }}>{status === 'done' ? '✓' : n}</div>
      <div style={{ flex: 1 }}>
        <h3 style={{ fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
          {meta.title}
          <OwnedByPill ownedBy={ownedBy} />
        </h3>
        <p style={{ color: 'var(--c-g600)', fontSize: '.9rem', marginTop: '.25rem' }}>{meta.blurb}</p>
        {status === 'done' && step !== 'adopter-type' && step !== 'mou' && step !== 'adoption' && (
          <StepDoneSummary step={step} impact={impact} record={record} />
        )}
        {status === 'active' && (
          <div style={{ marginTop: '1rem' }}>
            {step === 'profile-on-file' && <ProfileOnFileMissing session={session} />}
            {step === 'adopter-type' && <AdopterTypeForm record={record} onSave={onUpdate} />}
            {step === 'wea-on-file' && <WeaOnFileMissing session={session} onOpenWea={onOpenWea} />}
            {step === 'mou' && <MouSignForm session={session} record={record} onSave={onUpdate} />}
            {step === 'adoption' && <DeclareAdoptionForm record={record} onSave={onUpdate} />}
          </div>
        )}
        {status === 'done' && (step === 'adopter-type' || step === 'mou') && (
          <StepDoneSummary step={step} impact={impact} record={record} />
        )}
      </div>
    </div>
  );
}

function OwnedByPill({ ownedBy }: { ownedBy: 'impact' | 'jp' }) {
  const isImpact = ownedBy === 'impact';
  return (
    <span style={{
      fontSize: '.65rem', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase',
      padding: '.18rem .5rem', borderRadius: 999,
      background: isImpact ? 'var(--c-primary-subtle)' : '#fef3c7',
      color: isImpact ? 'var(--c-primary-active)' : '#92400e',
      border: `1px solid ${isImpact ? 'var(--c-primary-border)' : '#fcd34d'}`,
    }}>
      {isImpact ? `🏠 from ${JP.impactName}` : `📋 ${JP.org} step`}
    </span>
  );
}

function stepMeta(step: AdopterStep): { title: string; blurb: string } {
  switch (step) {
    case 'profile-on-file':
      return {
        title: 'Your contact profile',
        blurb: `${JP.org} reads contact info from your ${JP.impactName} home — you don’t fill it in again here.`,
      };
    case 'adopter-type':
      return {
        title: 'Who are you adopting as?',
        blurb: 'This is the only identity-level question specific to ADOPT.',
      };
    case 'wea-on-file':
      return {
        title: 'WEA Statement of Faith',
        blurb: `Required for church / organization / network adopters. ${JP.org} reads it from your ${JP.impactName} home — sign it once, re-use it everywhere.`,
      };
    case 'mou':
      return {
        title: 'Sign the ADOPT Memorandum of Understanding',
        blurb: `Specific to the ${JP.org} program. The document lives in your vault — ${JP.org} receives only the attestation that you signed.`,
      };
    case 'adoption':
      return {
        title: 'Declare your adoption',
        blurb: 'Choose your Frontier People Group and (optionally) ask to be matched with a facilitator.',
      };
  }
}

function StepDoneSummary({ step, impact, record }: { step: AdopterStep; impact: ImpactProfile; record: JpAdopterRecord }) {
  if (step === 'profile-on-file' && impact.contact) {
    const fields = [
      impact.contact.email && 'email',
      impact.contact.phone && 'phone',
      impact.contact.country && 'country',
      impact.contact.city && 'city',
    ].filter(Boolean) as string[];
    return (
      <div style={{ marginTop: '.75rem', fontSize: '.85rem', color: 'var(--c-g600)' }}>
        <span style={{ color: 'var(--c-primary-active)', fontWeight: 700 }}>✓ On file</span> — your vault holds {fields.join(', ')}.
        {' '}{JP.org} sees a “can reach you” flag; the actual values stay in your vault unless you grant a richer scope.
      </div>
    );
  }
  if (step === 'wea-on-file' && impact.attestations.wea) {
    const d = new Date(impact.attestations.wea.signedAt * 1000).toLocaleDateString();
    return (
      <div style={{ marginTop: '.75rem', fontSize: '.85rem', color: 'var(--c-g600)' }}>
        <span style={{ color: 'var(--c-primary-active)', fontWeight: 700 }}>✓ Signed at your home</span> on <b>{d}</b>. {JP.org} holds the attestation only.
      </div>
    );
  }
  if (step === 'adopter-type' && record.adopterType) {
    return (
      <div style={{ marginTop: '.75rem', fontSize: '.85rem', color: 'var(--c-g600)' }}>
        <span style={{ color: 'var(--c-primary-active)', fontWeight: 700 }}>✓</span> Adopting as <b>{ADOPTER_TYPE_LABEL[record.adopterType]}</b>.
      </div>
    );
  }
  if (step === 'mou' && record.attestations.mou) {
    const d = new Date(record.attestations.mou.signedAt * 1000).toLocaleString();
    return (
      <div style={{ marginTop: '.75rem', fontSize: '.85rem', color: 'var(--c-g600)' }}>
        <span style={{ color: 'var(--c-primary-active)', fontWeight: 700 }}>✓ Signed</span> on <b>{d}</b>. Receipt: <code style={{ fontSize: '.78rem' }}>{record.attestations.mou.docHash.slice(0, 18)}…</code>
      </div>
    );
  }
  return null;
}

// ── Step bodies ─────────────────────────────────────────────────────────────

function ProfileOnFileMissing({ session }: { session: Session }) {
  const homeUrl = personalAuthOrigin(nameLabel(session.name));
  return (
    <div className="soon" style={{ display: 'block' }}>
      Your {JP.impactName} home doesn’t have contact info yet. Add it once at{' '}
      <a href={homeUrl} target="_blank" rel="noopener noreferrer"><b>{homeUrl}</b></a> — it’s reused across every community app.
    </div>
  );
}

const ADOPTER_TYPE_LABEL: Record<AdopterType, string> = {
  individual: 'an individual',
  family: 'a family',
  group: 'a small group',
  church: 'a church',
  organization: 'an organization',
  network: 'a network',
};

const ADOPTER_TYPE_OPTIONS: { type: AdopterType; label: string; blurb: string }[] = [
  { type: 'individual', label: 'Individual', blurb: 'You as one person.' },
  { type: 'family', label: 'Family', blurb: 'A household adopting together.' },
  { type: 'group', label: 'Small group', blurb: 'A few people praying together.' },
  { type: 'church', label: 'Church', blurb: 'A local church or congregation.' },
  { type: 'organization', label: 'Organization', blurb: 'A ministry, agency, or other org.' },
  { type: 'network', label: 'Network', blurb: 'A network of churches or orgs.' },
];

function AdopterTypeForm({ record, onSave }: { record: JpAdopterRecord; onSave: (next: JpAdopterRecord) => void }) {
  const [picked, setPicked] = useState<AdopterType | undefined>(record.adopterType);
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '.6rem' }}>
        {ADOPTER_TYPE_OPTIONS.map((o) => {
          const active = picked === o.type;
          return (
            <button
              key={o.type}
              onClick={() => setPicked(o.type)}
              style={{
                textAlign: 'left', padding: '.75rem .9rem', borderRadius: 12, cursor: 'pointer',
                background: active ? 'var(--c-primary-subtle)' : '#fff',
                border: `1.5px solid ${active ? 'var(--c-primary)' : 'var(--c-g200)'}`,
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--c-g900)' }}>{o.label}</div>
              <div style={{ fontSize: '.78rem', color: 'var(--c-g500)', marginTop: '.15rem' }}>{o.blurb}</div>
            </button>
          );
        })}
      </div>
      <button
        className="btn btn-primary"
        disabled={!picked}
        style={{ marginTop: '1rem' }}
        onClick={() => picked && onSave({ ...record, adopterType: picked })}
      >
        Continue
      </button>
    </>
  );
}

function WeaOnFileMissing({ session, onOpenWea }: { session: Session; onOpenWea: () => void }) {
  const homeUrl = personalAuthOrigin(nameLabel(session.name));
  return (
    <div className="soon" style={{ display: 'block' }}>
      Church / organization / network adopters affirm the WEA Statement of Faith. Sign it once at your{' '}
      <a href={homeUrl} target="_blank" rel="noopener noreferrer"><b>{JP.impactName} home</b></a> — every community
      app that needs it (including {JP.org}) will see “✓ on file.”
      {' '}<button onClick={onOpenWea} style={{ background: 'none', border: 'none', color: 'var(--c-primary)', fontWeight: 700, cursor: 'pointer', padding: 0 }}>Read the statement →</button>
    </div>
  );
}

function MouSignForm({ session, record, onSave }: { session: Session; record: JpAdopterRecord; onSave: (next: JpAdopterRecord) => void }) {
  const [agreed, setAgreed] = useState(false);
  const [signing, setSigning] = useState(false);

  const sign = async () => {
    setSigning(true);
    try {
      // Bind the attestation to the active JP delegation — revoking the delegation at the
      // member's home voids the consent the receipt rode in on (ADR-0019). For the demo we
      // use the session token as the consent-binding seed (it identifies the active grant);
      // in production this is the actual ERC-7710 delegation hash.
      const att = await attestDocConsentBound({
        docId: MOU_DOC_ID,
        docText: MOU_TEXT,
        delegationJson: { sub: session.token.slice(0, 32) },
      });
      onSave({ ...record, attestations: { ...record.attestations, mou: att } });
    } finally {
      setSigning(false);
    }
  };

  return (
    <>
      <div style={{
        background: '#fff', border: '1px solid var(--c-g200)', borderRadius: 12, padding: '1rem 1.25rem',
        maxHeight: 280, overflow: 'auto', fontSize: '.85rem', lineHeight: 1.55, color: 'var(--c-g700)', whiteSpace: 'pre-wrap',
      }}>
        {MOU_TEXT}
      </div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '.6rem', marginTop: '1rem', fontSize: '.9rem', color: 'var(--c-g700)' }}>
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: '.25rem' }} />
        <span>I have read the ADOPT MOU and commit to its terms. I understand the document is held in my {JP.impactName} vault and {JP.org} receives only the attestation that I signed.</span>
      </label>
      <button
        className="btn btn-primary"
        disabled={!agreed || signing}
        style={{ marginTop: '1rem' }}
        onClick={() => void sign()}
      >
        {signing ? 'Signing with your home…' : <><ShieldIcon /> Sign with my {JP.impactName} home</>}
      </button>
    </>
  );
}

function DeclareAdoptionForm({ record, onSave }: { record: JpAdopterRecord; onSave: (next: JpAdopterRecord) => void }) {
  const [picked, setPicked] = useState<string | undefined>(record.adoption?.peopleGroupId);
  const [requestFacilitator, setRequestFacilitator] = useState<boolean>(record.adoption?.requestFacilitator ?? true);
  const [declaring, setDeclaring] = useState(false);
  const pg = picked ? findPeopleGroup(picked) : undefined;

  const declare = () => {
    if (!pg) return;
    setDeclaring(true);
    onSave({
      ...record,
      adoption: {
        peopleGroupId: pg.id,
        peopleGroupName: pg.name,
        declaredAt: Math.floor(Date.now() / 1000),
        requestFacilitator,
      },
    });
  };

  return (
    <>
      <p style={{ fontSize: '.88rem', color: 'var(--c-g600)' }}>
        Pick a Frontier People Group to commit to. (Demo seed of 10 well-known FPGs; the live list
        comes from {JP.org} in a later phase.)
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '.6rem', marginTop: '.75rem' }}>
        {FPG_SEED.map((g) => <FpgCard key={g.id} g={g} active={picked === g.id} onPick={() => setPicked(g.id)} />)}
      </div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '.6rem', marginTop: '1.25rem', fontSize: '.9rem', color: 'var(--c-g700)' }}>
        <input type="checkbox" checked={requestFacilitator} onChange={(e) => setRequestFacilitator(e.target.checked)} style={{ marginTop: '.25rem' }} />
        <span>Match me with a facilitator already serving this people group, when one is available.</span>
      </label>
      <button className="btn btn-primary" disabled={!picked || declaring} style={{ marginTop: '1rem' }} onClick={declare}>
        {declaring ? 'Declaring…' : `Declare adoption of ${pg ? pg.name : '…'}`}
      </button>
    </>
  );
}

function FpgCard({ g, active, onPick }: { g: PeopleGroup; active: boolean; onPick: () => void }) {
  return (
    <button
      onClick={onPick}
      style={{
        textAlign: 'left', padding: '.85rem 1rem', borderRadius: 12, cursor: 'pointer',
        background: active ? 'var(--c-primary-subtle)' : '#fff',
        border: `1.5px solid ${active ? 'var(--c-primary)' : 'var(--c-g200)'}`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '.5rem' }}>
        <div style={{ fontWeight: 700, color: 'var(--c-g900)' }}>{g.name}</div>
        <div style={{ fontSize: '.72rem', color: 'var(--c-g500)', fontWeight: 600 }}>{formatPopulation(g.populationApprox)}</div>
      </div>
      <div style={{ fontSize: '.78rem', color: 'var(--c-g500)', marginTop: '.2rem' }}>{g.country} · {g.region}</div>
      <div style={{ fontSize: '.74rem', color: 'var(--c-g400)', marginTop: '.15rem' }}>{g.religion}</div>
    </button>
  );
}

// ── Completion: adoption summary + JP projection ────────────────────────────

function AdoptionSummary({ session, record, impact }: { session: Session; record: JpAdopterRecord; impact: ImpactProfile }) {
  const pg = record.adoption ? findPeopleGroup(record.adoption.peopleGroupId) : undefined;
  const homeUrl = personalAuthOrigin(nameLabel(session.name));
  return (
    <>
      <section className="hero" style={{ padding: '3rem 0 2rem' }}>
        <div className="wrap">
          <div className="eyebrow" style={{ color: 'var(--c-primary)' }}>✓ Adoption declared</div>
          <h1 style={{ marginTop: '.5rem', fontSize: 'clamp(1.6rem, 4vw, 2.4rem)' }}>
            {session.name}, you’ve adopted <span style={{ color: 'var(--c-primary)' }}>{pg?.name ?? 'a Frontier People Group'}</span>.
          </h1>
          {pg && (
            <p className="hero-sub" style={{ fontSize: '1rem' }}>
              {pg.country} · ~{formatPopulation(pg.populationApprox)} people · {pg.religion}.
              {record.adoption?.requestFacilitator ? ' We’ll match you with a facilitator when one’s available.' : ''}
            </p>
          )}
        </div>
      </section>

      <section className="section wrap" style={{ paddingTop: 0 }}>
        <div className="agreements" style={{ gridTemplateColumns: '1fr', gap: '.875rem' }}>
          <div className="agreement">
            <h3>What now</h3>
            <p style={{ color: 'var(--c-g600)' }}>
              The ADOPT path is a long walk — Pray, learn, partner. {JP.org} will send you quarterly
              prayer updates and, when matched, introductions from facilitators on the field.
              These ride over the scoped delegation you granted at sign-in.
            </p>
          </div>
          <div className="agreement" style={{ background: '#fff' }}>
            <h3>Where everything lives</h3>
            <p style={{ color: 'var(--c-g600)' }}>
              The ADOPT MOU you signed is in your {JP.impactName} vault at{' '}
              <a href={homeUrl} target="_blank" rel="noopener noreferrer"><b>{homeUrl}</b></a>.
              Your contact info + WEA stay there too. {JP.org} only holds the attestations + your public
              adoption declaration — revisit and revoke any time from your home.
            </p>
          </div>
        </div>
      </section>

      <JpProjectionPanel impact={impact} record={record} session={session} />
    </>
  );
}

function JpProjectionPanel({ impact, record, session }: { impact: ImpactProfile; record: JpAdopterRecord; session: Session }) {
  const projection = useMemo(() => projectForJp(impact, record), [impact, record]);
  const homeUrl = personalAuthOrigin(nameLabel(session.name));
  return (
    <section className="section wrap" style={{ paddingTop: 0 }}>
      <div className="trust">
        <div className="eyebrow" style={{ color: 'var(--c-primary-mid)' }}>What JP can see</div>
        <h2 style={{ fontSize: '1.5rem', maxWidth: '42ch' }}>This is everything {JP.org} holds about you. Compare it to your vault — much smaller.</h2>
        <div style={{ marginTop: '1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          <ProjBox label="Contact channel" value={projection.hasContact ? '✓ Can reach you (flag only)' : '— none'} />
          <ProjBox label="Adopter type" value={projection.adopterType ? ADOPTER_TYPE_LABEL[projection.adopterType] : '—'} />
          <ProjBox label="ADOPT MOU receipt" value={projection.attestations.mou ? `✓ ${projection.attestations.mou.docHash.slice(0, 16)}…` : '—'} mono />
          <ProjBox label="WEA receipt" value={projection.attestations.wea ? `✓ ${projection.attestations.wea.docHash.slice(0, 16)}…` : '— (not required)'} mono />
          <ProjBox label="Public adoption" value={projection.adoption ? `✓ ${projection.adoption.peopleGroupName}` : '—'} />
          <ProjBox label="Wants facilitator match" value={projection.adoption ? (projection.adoption.requestFacilitator ? 'Yes' : 'No') : '—'} />
        </div>
        <p style={{ marginTop: '1.5rem', fontSize: '.85rem', color: '#94a3b8' }}>
          Revoke at your home <a href={homeUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c-primary-mid)' }}>{homeUrl}</a> and this projection goes empty —
          your vault stays intact, JP just stops seeing it.
        </p>
      </div>
    </section>
  );
}

function ProjBox({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: '.8rem 1rem' }}>
      <div style={{ fontSize: '.7rem', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#94a3b8' }}>{label}</div>
      <div style={{ marginTop: '.35rem', color: '#e2e8f0', fontSize: '.92rem', fontFamily: mono ? "'SF Mono','Roboto Mono',monospace" : undefined }}>{value}</div>
    </div>
  );
}

// ── Facilitator Intranet (placeholder, wired next) ──────────────────────────

function FacilitatorIntranet({ session, onSignOut, onOpenWea }: {
  session: Session; onSignOut: () => void; onOpenWea: () => void;
}) {
  const homeUrl = personalAuthOrigin(nameLabel(session.name));
  return (
    <>
      <IntranetTopbar session={session} subtitle="Facilitator dashboard" onSignOut={onSignOut} />
      {session.fresh && (
        <div style={{ background: 'var(--c-primary-subtle)', borderBottom: '1px solid var(--c-primary-border)', padding: '.75rem 1.25rem', textAlign: 'center', fontSize: '.9rem', color: 'var(--c-primary-active)' }}>
          ✓ Connected via {JP.impactName} — welcome, <b>{session.name}</b>.
        </div>
      )}
      <section className="hero" style={{ padding: '3rem 0 2rem' }}>
        <div className="wrap">
          <div className="eyebrow">{JP.paths.facilitator.who}</div>
          <h1 style={{ marginTop: '.5rem', fontSize: 'clamp(1.6rem, 4vw, 2.4rem)' }}>{JP.paths.facilitator.title}</h1>
          <p className="hero-sub" style={{ fontSize: '1rem' }}>{JP.paths.facilitator.body}</p>
        </div>
      </section>
      <section className="section wrap" style={{ paddingTop: 0 }}>
        <div className="agreement">
          <h3>Facilitator onboarding — wiring next</h3>
          <p style={{ color: 'var(--c-g600)' }}>
            The facilitator flow (set up your facilitator organization at your {JP.impactName} home, declare
            people-group coverage + capacity, sign the ADOPT MOU + WEA Statement of Faith as a named
            signatory) is the next phase. The adopter flow ships first.
          </p>
          <p style={{ color: 'var(--c-g600)', marginTop: '.5rem' }}>
            Your home: <a href={homeUrl} target="_blank" rel="noopener noreferrer"><b>{homeUrl}</b></a>.{' '}
            <button onClick={onOpenWea} style={{ background: 'none', border: 'none', color: 'var(--c-primary)', fontWeight: 700, cursor: 'pointer', padding: 0 }}>Read the WEA Statement →</button>
          </p>
        </div>
      </section>
      <IntranetFooter />
    </>
  );
}

// ── WEA modal (unchanged) ───────────────────────────────────────────────────

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
          <span className="soon">You’ll affirm this inside your {JP.impactName} home — once, then re-used everywhere.</span>
        </div>
      </div>
    </div>
  );
}
