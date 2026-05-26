import { useCallback, useEffect, useState } from 'react';
import type { Address } from '@agenticprimitives/types';
import { connectWithName, signupWithName, createOrg, startSiteEnrollment } from './connect-client';
import { hasWallet } from './lib/wallet';
import { loadPasskey } from './lib/passkey';

const ENROLL_KEY = 'agenticprimitives:demo-org:enroll';

const SESSION_KEY = 'agenticprimitives:demo-org:session';
const orgsKey = (addr: string) => `agenticprimitives:demo-org:orgs:${addr.toLowerCase()}`;

type Via = 'wallet' | 'passkey';
interface Session {
  token: string;
  via: Via;
  name: string;
  address: Address;
  fresh: boolean;
}
interface Org {
  orgAgent: string;
  orgName: string;
}

/** Decode a JWS payload segment (base64url JSON). */
function decodeToken(token: string): { sub?: string; exp?: number } | null {
  try {
    const seg = token.split('.')[1] ?? '';
    const json = atob(seg.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((2 - (seg.length & 3)) & 3));
    return JSON.parse(json) as { sub?: string; exp?: number };
  } catch {
    return null;
  }
}
/** eip155:84532:0xabc… → 0xabc… */
function addrFromSub(sub?: string): Address | null {
  const m = sub?.match(/0x[0-9a-fA-F]{40}$/);
  return (m?.[0] as Address) ?? null;
}

/** Restore a persisted, non-expired session synchronously (no flicker). */
function restoreSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { token?: string; via?: Via; name?: string };
    if (!s.token || !s.via || !s.name) return null;
    const dec = decodeToken(s.token);
    const addr = addrFromSub(dec?.sub);
    if (!addr || !dec?.exp || dec.exp * 1000 <= Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return { token: s.token, via: s.via, name: s.name, address: addr, fresh: false };
  } catch {
    return null;
  }
}

export function App() {
  const [session, setSession] = useState<Session | null>(restoreSession);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Connect-by-name
  const [connectName, setConnectName] = useState('');
  const [connectErr, setConnectErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nameInfo, setNameInfo] = useState<{
    status: 'idle' | 'checking' | 'none' | 'found';
    name?: string;
    hasEoa?: boolean;
    hasPasskey?: boolean;
  }>({ status: 'idle' });

  // Sign-up
  const [desiredName, setDesiredName] = useState('');
  const [signupAvail, setSignupAvail] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');

  // Orgs
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgName, setOrgName] = useState('');
  const [orgAvail, setOrgAvail] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');

  // Shared progress modal (sign-up + create-org)
  const [flow, setFlow] = useState<
    | { title: string; phase: 'running' | 'done'; steps: string[] }
    | { title: string; phase: 'error'; steps: string[]; error: string }
    | null
  >(null);

  const openSession = useCallback((token: string, via: Via, name: string, fresh: boolean) => {
    const addr = addrFromSub(decodeToken(token)?.sub);
    if (!addr) {
      setError('Could not read the agent address from the session token.');
      return;
    }
    setSession({ token, via, name, address: addr, fresh });
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ token, via, name }));
    } catch {
      /* storage blocked — session just won't persist */
    }
    try {
      const stored = localStorage.getItem(orgsKey(addr));
      setOrgs(stored ? (JSON.parse(stored) as Org[]) : []);
    } catch {
      setOrgs([]);
    }
  }, []);

  // Load orgs for a restored session on first mount.
  useEffect(() => {
    if (!session) return;
    try {
      const stored = localStorage.getItem(orgsKey(session.address));
      setOrgs(stored ? (JSON.parse(stored) as Org[]) : []);
    } catch {
      /* ignore */
    }
    // run once for the initial restored session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Central-auth enrollment return (spec 229): ?enrolled=1 → our local passkey is now an
  // on-chain custodian; sign in with it directly (retry for post-add RPC lag). ?enroll_error
  // → surface it. Runs once on mount.
  useEffect(() => {
    const u = new URL(window.location.href);
    const enrolled = u.searchParams.get('enrolled');
    const enrollErr = u.searchParams.get('enroll_error');
    const retName = u.searchParams.get('name');
    const retState = u.searchParams.get('state');
    if (!enrolled && !enrollErr) return;
    for (const k of ['enrolled', 'enroll_error', 'name', 'state']) u.searchParams.delete(k);
    window.history.replaceState({}, '', u.toString());

    let stored: { state?: string; name?: string } = {};
    try {
      stored = JSON.parse(sessionStorage.getItem(ENROLL_KEY) ?? '{}') as { state?: string; name?: string };
    } catch {
      /* ignore */
    }
    sessionStorage.removeItem(ENROLL_KEY);

    if (enrollErr) {
      setError(`Enrollment was not completed (${enrollErr}).`);
      return;
    }
    if (stored.state && retState && stored.state !== retState) {
      setError('Enrollment state mismatch — please try again.');
      return;
    }
    const name = retName ?? stored.name ?? '';
    if (!name) {
      setError('Enrollment returned without a name.');
      return;
    }
    void (async () => {
      setFlow({ title: 'Finishing setup…', phase: 'running', steps: ['Signing in with your new passkey…'] });
      let lastErr = '';
      for (let i = 0; i < 5; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 2500));
        const out = await connectWithName(name, 'passkey');
        if (out.ok) {
          setFlow(null);
          openSession(out.token, 'passkey', out.name ?? name, true);
          return;
        }
        lastErr = out.error;
      }
      setFlow({ title: 'Couldn’t finish', phase: 'error', steps: [], error: lastErr || 'sign-in after enrollment failed' });
    })();
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function signOut() {
    setSession(null);
    setMenuOpen(false);
    setOrgs([]);
    setError(null);
    setConnectName('');
    setConnectErr(null);
    setNameInfo({ status: 'idle' });
    setDesiredName('');
    setSignupAvail('idle');
    setOrgName('');
    setOrgAvail('idle');
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }

  // ── name availability checks (debounced) ────────────────────────────
  // Connect: which credentials does the named agent have?
  useEffect(() => {
    const name = connectName.trim();
    if (!name) {
      setNameInfo({ status: 'idle' });
      return;
    }
    setNameInfo({ status: 'checking' });
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/connect/name-info?name=${encodeURIComponent(name)}`);
        const b = (await r.json()) as { exists?: boolean; name?: string; hasEoa?: boolean; hasPasskey?: boolean };
        setNameInfo(
          b.exists ? { status: 'found', name: b.name, hasEoa: b.hasEoa, hasPasskey: b.hasPasskey } : { status: 'none' },
        );
      } catch {
        setNameInfo({ status: 'idle' });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [connectName]);

  // Sign-up: block an existing name.
  useEffect(() => {
    const name = desiredName.trim();
    if (!name) {
      setSignupAvail('idle');
      return;
    }
    setSignupAvail('checking');
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/connect/name-info?name=${encodeURIComponent(name)}`);
        const b = (await r.json()) as { exists?: boolean };
        setSignupAvail(b.exists ? 'taken' : 'available');
      } catch {
        setSignupAvail('idle');
      }
    }, 400);
    return () => clearTimeout(t);
  }, [desiredName]);

  // Org: name must be free.
  useEffect(() => {
    const name = orgName.trim();
    if (!name) {
      setOrgAvail('idle');
      return;
    }
    setOrgAvail('checking');
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/connect/name-info?name=${encodeURIComponent(name)}`);
        const b = (await r.json()) as { exists?: boolean };
        setOrgAvail(b.exists ? 'taken' : 'available');
      } catch {
        setOrgAvail('idle');
      }
    }, 400);
    return () => clearTimeout(t);
  }, [orgName]);

  // ── actions ─────────────────────────────────────────────────────────
  async function onConnectName(via: Via) {
    if (!connectName.trim()) return;
    setConnectErr(null);
    setBusy(true);
    try {
      const out = await connectWithName(connectName.trim(), via);
      if (out.ok) openSession(out.token, via, out.name ?? connectName.trim(), false);
      else setConnectErr(out.error);
    } catch (e) {
      setConnectErr(e instanceof Error ? e.message : 'connect failed');
    } finally {
      setBusy(false);
    }
  }

  // First-visit: register a local passkey for this origin + redirect to the central auth,
  // where the person's primary passkey approves adding it as a custodian (spec 229 §3).
  async function onAddSite(name: string) {
    setConnectErr(null);
    setBusy(true);
    try {
      const { url, state } = await startSiteEnrollment(name);
      sessionStorage.setItem(ENROLL_KEY, JSON.stringify({ state, name }));
      window.location.href = url; // → central auth; returns with ?enrolled=1
    } catch (e) {
      setBusy(false);
      setConnectErr(e instanceof Error ? e.message : 'could not start enrollment');
    }
  }

  async function onSignup(via: Via) {
    const base = desiredName.trim();
    if (!base || signupAvail !== 'available') return;
    setError(null);
    const steps: string[] = [];
    const onStep = (s: string) => {
      steps.push(s);
      setFlow({ title: 'Creating your agent…', phase: 'running', steps: [...steps] });
    };
    setFlow({ title: 'Creating your agent…', phase: 'running', steps: [] });
    try {
      const out = await signupWithName(base, via, onStep);
      if (!out.ok) {
        setFlow({ title: 'Couldn’t finish', phase: 'error', steps: [...steps], error: out.error });
        return;
      }
      setFlow({ title: '✓ Agent ready', phase: 'done', steps: [...steps] });
      await new Promise((r) => setTimeout(r, 800));
      openSession(out.token, via, out.name, true);
      setDesiredName('');
      setSignupAvail('idle');
      setFlow(null);
    } catch (e) {
      setFlow({ title: 'Couldn’t finish', phase: 'error', steps: [...steps], error: e instanceof Error ? e.message : 'signup failed' });
    }
  }

  async function onCreateOrg(via: Via) {
    if (!session) return;
    const base = orgName.trim();
    if (!base || orgAvail !== 'available') return;
    const steps: string[] = [];
    const onStep = (s: string) => {
      steps.push(s);
      setFlow({ title: 'Creating your organization…', phase: 'running', steps: [...steps] });
    };
    setFlow({ title: 'Creating your organization…', phase: 'running', steps: [] });
    try {
      const out = await createOrg(via, session.address, base, onStep);
      if (!out.ok) {
        setFlow({ title: 'Couldn’t finish', phase: 'error', steps: [...steps], error: out.error });
        return;
      }
      setFlow({ title: '✓ Organization created', phase: 'done', steps: [...steps] });
      const next = [{ orgAgent: out.result.orgAgent, orgName: out.result.orgName }, ...orgs];
      setOrgs(next);
      try {
        localStorage.setItem(orgsKey(session.address), JSON.stringify(next));
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 900));
      setOrgName('');
      setOrgAvail('idle');
      setFlow(null);
    } catch (e) {
      setFlow({ title: 'Couldn’t finish', phase: 'error', steps: [...steps], error: e instanceof Error ? e.message : 'create org failed' });
    }
  }

  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

  return (
    <div>
      <header className="topbar">
        <div className="brand">Agentic Org</div>
        <div className="account">
          {session ? (
            <div className="menu">
              <button className="menu-btn" onClick={() => setMenuOpen((o) => !o)}>
                {session.name} ▾
              </button>
              {menuOpen && (
                <div className="menu-pop" onMouseLeave={() => setMenuOpen(false)}>
                  <div className="muted" style={{ padding: '0.3rem 0.6rem' }}>
                    <code>{short(session.address)}</code> · {session.via}
                  </div>
                  <button onClick={() => navigator.clipboard?.writeText(session.address)}>Copy agent address</button>
                  <button onClick={signOut}>Sign out</button>
                </div>
              )}
            </div>
          ) : (
            <span className="muted">Not signed in</span>
          )}
        </div>
      </header>

      <p className="muted">
        Sign in with your <strong>agent name</strong> — the same canonical Smart Agent you use everywhere — then
        spin up a named organization it governs. (Relying-site demo; spec 229.)
      </p>

      {error && <p className="err">⛔ {error}</p>}

      {/* ── Signed out: connect / sign up ──────────────────────────── */}
      {!session && (
        <>
          <div className="panel broker">
            <h2>Connect to your Smart Agent</h2>
            <p className="muted">Enter your agent name, then confirm with the credential you set up.</p>
            <p>
              <input
                value={connectName}
                onChange={(e) => setConnectName(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ''))}
                placeholder="e.g. rpedersen"
                style={{ minWidth: '14rem' }}
              />
            </p>
            {nameInfo.status === 'checking' && <p className="muted">Checking…</p>}
            {nameInfo.status === 'none' && <p className="muted">No agent with that name yet — new here? Sign up below. ↓</p>}
            {nameInfo.status === 'found' && (
              <>
                <p className="ok" style={{ margin: '0 0 0.5rem' }}>
                  ✓ Found <code>{nameInfo.name}</code>
                </p>
                <p>
                  {nameInfo.hasPasskey && loadPasskey() && (
                    <button disabled={busy} onClick={() => onConnectName('passkey')}>
                      Continue with passkey
                    </button>
                  )}{' '}
                  {nameInfo.hasEoa && (
                    <button disabled={busy} onClick={() => onConnectName('wallet')}>
                      Continue with wallet
                    </button>
                  )}{' '}
                  {nameInfo.hasPasskey && (
                    <button disabled={busy} onClick={() => onAddSite(nameInfo.name!)}>
                      Set up this site (passkey) →
                    </button>
                  )}
                </p>
                {nameInfo.hasPasskey && !loadPasskey() && (
                  <p className="muted">
                    First time using <code>{nameInfo.name}</code> on this site? <strong>Set up this site</strong> —
                    you’ll approve once with your passkey at your home Connect, then use Windows Hello / Face ID here.
                  </p>
                )}
              </>
            )}
            {connectErr && <p className="err">⛔ {connectErr}</p>}
          </div>

          <div className="panel broker">
            <h2>New here? Sign up</h2>
            <p className="muted">Pick an agent name and create it with a passkey or wallet on this site.</p>
            <p>
              <input
                value={desiredName}
                onChange={(e) =>
                  setDesiredName(e.target.value.toLowerCase().replace(/\.demo\.agent$/, '').replace(/[^a-z0-9-]/g, ''))
                }
                placeholder="e.g. alice"
                style={{ marginRight: '0.25rem' }}
              />
              <code>{desiredName ? `${desiredName}.demo.agent` : 'your-name.demo.agent'}</code>
            </p>
            {desiredName && signupAvail === 'checking' && <p className="muted">Checking availability…</p>}
            {desiredName && signupAvail === 'available' && (
              <p className="ok" style={{ margin: '0 0 0.5rem' }}>✓ {desiredName}.demo.agent is available</p>
            )}
            {desiredName && signupAvail === 'taken' && (
              <p className="err" style={{ margin: '0 0 0.5rem' }}>
                ⛔ {desiredName}.demo.agent already exists.{' '}
                <button
                  style={{ marginLeft: '0.25rem' }}
                  onClick={() => {
                    setConnectName(desiredName);
                    setDesiredName('');
                    setSignupAvail('idle');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  Connect to {desiredName}.demo.agent instead →
                </button>
                <br />
                <span className="muted">That sends you to the “Connect” box above to sign in with it.</span>
              </p>
            )}
            <p>
              <button disabled={signupAvail !== 'available'} onClick={() => onSignup('passkey')}>
                Sign up with passkey
              </button>{' '}
              <button disabled={signupAvail !== 'available'} onClick={() => onSignup('wallet')}>
                Sign up with wallet
              </button>
            </p>
            {!hasWallet() && (
              <p className="muted">
                <em>No browser wallet detected</em> — sign up with a passkey.
              </p>
            )}
          </div>
        </>
      )}

      {/* ── Signed in: create + list organizations ─────────────────── */}
      {session && (
        <>
          <div className="panel">
            <h2>
              Welcome{session.fresh ? '' : ' back'}, {session.name}
            </h2>
            <p className="muted">
              Agent <code>{short(session.address)}</code> — signed in via {session.via}.
            </p>
          </div>

          <div className="panel broker">
            <h2>Create an organization</h2>
            <p className="muted">
              Pick a unique name. We deploy an <strong>Organization Smart Agent</strong> custodied by your connected
              credential, claim the name, and record <code>you → HAS_GOVERNANCE_OVER → org</code> on-chain.
            </p>
            <p>
              <input
                value={orgName}
                onChange={(e) =>
                  setOrgName(e.target.value.toLowerCase().replace(/\.demo\.agent$/, '').replace(/[^a-z0-9-]/g, ''))
                }
                placeholder="e.g. acme"
                style={{ marginRight: '0.25rem' }}
              />
              <code>{orgName ? `${orgName}.demo.agent` : 'org-name.demo.agent'}</code>
            </p>
            {orgName && orgAvail === 'checking' && <p className="muted">Checking availability…</p>}
            {orgName && orgAvail === 'available' && (
              <p className="ok" style={{ margin: '0 0 0.5rem' }}>✓ {orgName}.demo.agent is available</p>
            )}
            {orgName && orgAvail === 'taken' && (
              <p className="err" style={{ margin: '0 0 0.5rem' }}>⛔ {orgName}.demo.agent is taken — choose another.</p>
            )}
            <button disabled={orgAvail !== 'available'} onClick={() => onCreateOrg(session.via)}>
              Create organization
            </button>
          </div>

          {orgs.length > 0 && (
            <div className="panel">
              <h2>Your organizations</h2>
              <ul>
                {orgs.map((o) => (
                  <li key={o.orgAgent}>
                    <strong>{o.orgName}</strong> — <code>{short(o.orgAgent)}</code>{' '}
                    <span className="badge">you govern</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <p className="muted" style={{ marginTop: '1rem', fontSize: '0.85em' }}>
        Real on Base Sepolia (chain 84532): your agent + each org are deployed ERC-4337 Smart Agents; the org is
        custodied by your credential and linked to you by an on-chain relationship (spec 229).
      </p>

      {/* ── Progress modal (sign-up + create-org) ──────────────────── */}
      {flow && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>{flow.title}</h2>
            <ol className="steps">
              {flow.steps.map((s, i) => {
                const isLast = i === flow.steps.length - 1;
                const done = flow.phase === 'done' || !isLast;
                const current = flow.phase === 'running' && isLast;
                return (
                  <li key={i} className={done ? 'done' : current ? 'current' : 'pending'}>
                    {current ? <span className="spinner" /> : <span>{done ? '✓' : '•'}</span>}
                    {s}
                  </li>
                );
              })}
            </ol>
            {flow.phase === 'running' && (
              <p className="muted">This takes ~15–30s. Confirm any device or wallet prompt that appears.</p>
            )}
            {flow.phase === 'error' && (
              <>
                <p className="err">{flow.error}</p>
                <p className="muted">Nothing was charged. You can try again.</p>
                <button onClick={() => setFlow(null)}>Close</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
