import { useCallback, useEffect, useState } from 'react';
import type { Address } from '@agenticprimitives/types';
import { JP, GATEWAY } from './lib/brand';
import { startSiteEnrollment, exchangeCode, verifyIdToken } from './connect-client';
import { toAgentName as fullName, personalHome, personalAuthOrigin, nameLabel } from './lib/domain';

// JP-Adopt is a RELYING APP (spec 236). It runs the adoption program; Impact Community is the
// member's home + private data vault. Public capability UX (the marketing render below) lives
// in this file; the SSO step routes through Impact via `startSiteEnrollment`, the canonical
// demo-org pattern (ADR-0019). After return, we render a path-specific intranet — adopter or
// facilitator — keyed off the `kind` we stashed before redirect. MOU/WEA signing + adoption
// declarations + introductions land in P2–P4.

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

// ── Session ─────────────────────────────────────────────────────────────────
// The session is an id_token claim bag, the same shape demo-org uses. We
// additionally remember which JP path the member is on so the intranet renders
// the right surface — the kind is set when the member clicks "Start adoption"
// or "Register as a facilitator", stashed into sessionStorage with the enroll
// state, and restored on `?code` return.

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

// ── App ─────────────────────────────────────────────────────────────────────

export function App() {
  const [session, setSession] = useState<Session | null>(restoreSession);
  const [modal, setModal] = useState<Modal>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // copy shown in the SSO button while redirecting

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
      /* session just won't persist — non-fatal */
    }
  }, []);

  const signOut = useCallback(() => {
    setSession(null);
    setError(null);
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // ── OIDC return-path handler ──────────────────────────────────────────
  // demo-org / spec 230 pattern: on ?code&state, match against the stash we left
  // at `startSiteEnrollment`, then `exchangeCode` + `verifyIdToken` open the
  // session. Audit F5: fail closed on a state mismatch.
  useEffect(() => {
    const u = new URL(window.location.href);
    const code = u.searchParams.get('code');
    const retState = u.searchParams.get('state');
    const err = u.searchParams.get('enroll_error');
    if (!code && !err) return;
    for (const k of ['code', 'state', 'enroll_error']) u.searchParams.delete(k);
    window.history.replaceState({}, '', u.toString());
    if (err) {
      setError(`Sign-in was not completed (${err}).`);
      return;
    }

    let stash: EnrollStash = {};
    try {
      stash = JSON.parse(sessionStorage.getItem(ENROLL_KEY) ?? '{}') as EnrollStash;
    } catch {
      /* ignore */
    }
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

  // ── SSO kickoff ───────────────────────────────────────────────────────
  // "Connect via Impact Community" — same shape as demo-org's `beginSiteSetup`:
  // build the central-auth URL with `startSiteEnrollment`, stash {state,nonce,
  // codeVerifier,kind} in sessionStorage so the `?code` return can complete it,
  // then full-page redirect to the member's secure home.
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

  // ── render ────────────────────────────────────────────────────────────

  if (session) {
    return (
      <Intranet
        session={session}
        onSignOut={signOut}
        onOpenWea={() => setModal({ kind: 'wea' })}
      />
    );
  }

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
        <div role="alert" style={{ background: '#fef2f2', borderBottom: '1px solid #fecaca', color: '#991b1b', padding: '.75rem 1.25rem', textAlign: 'center', fontSize: '.875rem' }}>
          {error}
        </div>
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

// ── Onboarding panel ────────────────────────────────────────────────────────
// Collects the member's Impact name (same input shape as demo-org's sign-in
// card) and routes the "Connect via Impact Community" button through the SSO
// flow. The kind (adopter | facilitator) is held by the parent so the return
// path can render the right intranet.

function OnboardPanel({
  kind,
  busy,
  onClose,
  onConnect,
}: {
  kind: Kind;
  busy: string | null;
  onClose: () => void;
  onConnect: (name: string) => void;
}) {
  const p = JP.paths[kind];
  const [name, setName] = useState<string>(() => {
    try {
      return localStorage.getItem('agenticprimitives:demo-jp:last-name') ?? '';
    } catch {
      return '';
    }
  });
  const trimmed = name.trim();

  const submit = () => {
    if (!trimmed || busy) return;
    try {
      localStorage.setItem('agenticprimitives:demo-jp:last-name', trimmed);
    } catch {
      /* ignore */
    }
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
            id="jp-impact-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="e.g. rich-pedersen"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            disabled={!!busy}
            style={{
              padding: '.75rem .9rem', fontSize: '1rem', borderRadius: 10,
              border: '1.5px solid var(--c-g300)', background: '#fff', width: '100%',
              fontFamily: "'SF Mono','Roboto Mono',monospace",
            }}
          />
          {trimmed && (
            <div style={{ fontSize: '.75rem', color: 'var(--c-g500)', fontFamily: "'SF Mono','Roboto Mono',monospace" }}>
              {fullName(trimmed)} · home at {personalHome(trimmed)}
            </div>
          )}

          <button
            className="btn-sso"
            onClick={submit}
            disabled={!trimmed || !!busy}
            title="Connect via Impact Community to start your JP onboarding"
          >
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

// ── Intranet ────────────────────────────────────────────────────────────────
// Minimal P1 dashboards — confirm the SSO worked + lay out the upcoming pieces
// (MOU/WEA signing → P2; declarations → P3; introductions → P4). The point is
// to demonstrate that JP runs the program: the member is "in" the JP adopter
// or facilitator dashboard, while their data lives in their Impact home.

function Intranet({
  session,
  onSignOut,
  onOpenWea,
}: {
  session: Session;
  onSignOut: () => void;
  onOpenWea: () => void;
}) {
  const path = session.kind === 'adopter' ? JP.paths.adopter : JP.paths.facilitator;
  const short = `${session.address.slice(0, 6)}…${session.address.slice(-4)}`;
  const homeUrl = personalAuthOrigin(nameLabel(session.name));

  return (
    <>
      <header className="topbar">
        <div className="wrap">
          <div className="brand">
            <span className="brand-glyph" aria-hidden="true"><GlobeGlyph /></span>
            <div>{JP.appName}<small>{JP.org} · {session.kind === 'adopter' ? 'Adopter dashboard' : 'Facilitator dashboard'}</small></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
            <span className="powered" title={session.address}>
              {session.name} · {short}
            </span>
            <button className="btn btn-ghost" style={{ padding: '.5rem 1rem', fontSize: '.85rem' }} onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      {session.fresh && (
        <div style={{ background: 'var(--c-primary-subtle)', borderBottom: '1px solid var(--c-primary-border)', padding: '.75rem 1.25rem', textAlign: 'center', fontSize: '.9rem', color: 'var(--c-primary-active)' }}>
          ✓ Connected via {JP.impactName} — welcome, <b>{session.name}</b>. Your home + vault are at{' '}
          <a href={homeUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c-primary)' }}>{homeUrl}</a>.
        </div>
      )}

      <section className="hero" style={{ padding: '3rem 0 2rem' }}>
        <div className="wrap">
          <div className="eyebrow">{path.who}</div>
          <h1 style={{ marginTop: '.5rem', fontSize: 'clamp(1.6rem, 4vw, 2.4rem)' }}>{path.title} · {session.name}</h1>
          <p className="hero-sub" style={{ fontSize: '1rem' }}>{path.body}</p>
        </div>
      </section>

      <section className="section wrap" style={{ paddingTop: 0 }}>
        <div className="sec-head">
          <div className="eyebrow">Your JP onboarding</div>
          <h2>Next steps</h2>
          <p>JP runs the program. Each step writes to your {JP.impactName} vault — JP gets only the attestation it needs.</p>
        </div>

        <div className="agreements" style={{ gridTemplateColumns: '1fr', gap: '.875rem' }}>
          <DashboardStep
            n={1}
            title={`Connect via ${JP.impactName}`}
            status="done"
            body={`Done — signed in as ${session.name}.`}
          />
          {session.kind === 'facilitator' && (
            <DashboardStep
              n={2}
              title="Set up your facilitator organization"
              status="soon"
              body="Create an Organization Smart Agent secured by your ROOT credential at Impact. Wired next — same ceremony as demo-org’s create-org flow."
            />
          )}
          <DashboardStep
            n={session.kind === 'facilitator' ? 3 : 2}
            title="Add your profile to your vault"
            status="soon"
            body={`Contact + ${session.kind === 'facilitator' ? 'organization' : 'household'} profile fields, written to your vault. JP gets read access only for fields you grant.`}
          />
          <DashboardStep
            n={session.kind === 'facilitator' ? 4 : 3}
            title={`Sign ${JP.mou.name}${session.kind === 'facilitator' ? ' + WEA Statement of Faith' : ''}`}
            status="soon"
            body={`EIP-712 signed inside your vault. JP receives only the attestation that you signed — not the document. ${session.kind === 'facilitator' ? 'Both signatures required for facilitators.' : 'WEA signature required for church/org/network adopters.'}`}
            cta={{ label: `Preview ${JP.wea.name}`, onClick: onOpenWea }}
          />
          <DashboardStep
            n={session.kind === 'facilitator' ? 5 : 4}
            title={session.kind === 'facilitator' ? 'Declare facilitator coverage' : 'Declare your adoption'}
            status="soon"
            body={session.kind === 'facilitator'
              ? 'Declare the people groups, adopter types, and capacity bands you serve. Matched to adopters by the JP broker.'
              : 'Declare the Frontier People Group you’re adopting, and choose whether to be matched with a facilitator.'}
          />
        </div>
      </section>

      <section className="section wrap" style={{ paddingTop: 0 }}>
        <div className="trust">
          <div className="eyebrow" style={{ color: 'var(--c-primary-mid)' }}>You stay in control</div>
          <h2 style={{ fontSize: '1.5rem', maxWidth: '40ch' }}>JP can see only what you grant. Disconnect anytime — your data stays in your vault.</h2>
          <div className="trust-grid" style={{ marginTop: '1.25rem' }}>
            <div className="trust-pt"><CheckIcon /><span>This dashboard reads JP’s scoped delegation — disconnect at your Impact home and it goes dark.</span></div>
            <div className="trust-pt"><CheckIcon /><span>Your profile + signed agreements live in your vault, not on JP’s servers.</span></div>
          </div>
          <p style={{ marginTop: '1.25rem', fontSize: '.85rem', color: '#94a3b8' }}>
            Your home + vault: <a href={homeUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c-primary-mid)' }}>{homeUrl}</a>
          </p>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <span>{JP.org} · Adopt-a-People-Group pilot — JP runs the program.</span>
          <span>Identity + data vault: <b style={{ color: 'var(--c-primary)' }}>{JP.impactName}</b>. You stay in control.</span>
        </div>
      </footer>
    </>
  );
}

function DashboardStep({
  n,
  title,
  status,
  body,
  cta,
}: {
  n: number;
  title: string;
  status: 'done' | 'soon';
  body: string;
  cta?: { label: string; onClick: () => void };
}) {
  return (
    <div className="agreement" style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
      <div style={{
        flex: '0 0 auto', width: 36, height: 36, borderRadius: 999,
        background: status === 'done' ? 'var(--c-primary)' : 'var(--c-g200)',
        color: status === 'done' ? '#fff' : 'var(--c-g600)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 800, fontSize: '.9rem',
      }}>
        {status === 'done' ? '✓' : n}
      </div>
      <div style={{ flex: 1 }}>
        <h3 style={{ fontSize: '1.05rem' }}>
          {title}
          {status === 'soon' && <span style={{ marginLeft: '.5rem', fontSize: '.7rem', fontWeight: 700, color: 'var(--c-accent)', background: 'var(--c-accent-subtle)', padding: '.15rem .45rem', borderRadius: 999, border: '1px solid var(--c-accent-border)' }}>WIRING NEXT</span>}
        </h3>
        <p>{body}</p>
        {cta && (
          <button onClick={cta.onClick} style={{ marginTop: '.5rem', background: 'none', border: 'none', color: 'var(--c-primary)', fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: '.85rem' }}>
            {cta.label} →
          </button>
        )}
      </div>
    </div>
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
          <span className="soon">You’ll affirm this inside your {JP.impactName} home during onboarding.</span>
        </div>
      </div>
    </div>
  );
}
