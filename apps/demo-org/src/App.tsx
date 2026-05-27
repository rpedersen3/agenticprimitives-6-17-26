import { useCallback, useEffect, useState } from 'react';
import type { Address } from '@agenticprimitives/types';
import { connectWithName, connectWithDelegation, signupWithName, createOrg, startSiteEnrollment, readOrgData } from './connect-client';
import { openCentralAuthPopup, preferRedirect } from './lib/central-auth';
import type { DelegationWire } from './lib/delegation';
import { hasWallet } from './lib/wallet';
import { loadPasskey } from './lib/passkey';

const ENROLL_KEY = 'agenticprimitives:demo-org:enroll';
const LOCAL_PASSKEY_NAME = 'agenticprimitives:demo-org:passkey-name';
/** Normalize an agent name to its full `<label>.demo.agent` form for stable storage keys. */
const fullName = (name: string) => {
  const n = name.trim().toLowerCase();
  return n.endsWith('.demo.agent') ? n : `${n.replace(/\.+$/, '')}.demo.agent`;
};
/** The scoped delegation (person SA → this site's delegate SA) issued at enrollment, stored
 *  per agent name on this device (ADR-0019). Drives "Continue with passkey" + org actions. */
const delegationKey = (name: string) => `agenticprimitives:demo-org:delegation:${fullName(name)}`;
function loadDelegation(name: string): DelegationWire | null {
  try {
    const raw = localStorage.getItem(delegationKey(name));
    return raw ? (JSON.parse(raw) as DelegationWire) : null;
  } catch {
    return null;
  }
}
/** True iff this device holds a stored delegation for `name` (→ one-touch passkey sign-in). */
const hasLocalDelegation = (name: string): boolean => !!loadPasskey() && !!loadDelegation(name);

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
  governed?: boolean; // true if person→org HAS_GOVERNANCE_OVER edge was recorded
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
  // Per-org sensitive-data read state (via an org→person delegation).
  const [orgData, setOrgData] = useState<Record<string, { loading?: boolean; record?: unknown; error?: string }>>({});

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
      // Remember which agent THIS origin's local passkey is bound to, so we only
      // offer "Continue with passkey" for that agent (not for one set up elsewhere).
      if (via === 'passkey') localStorage.setItem(LOCAL_PASSKEY_NAME, name);
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
    // The central auth returns the SCOPED DELEGATION (person SA → our delegate SA), base64
    // JSON. The site is a delegate, not a custodian (ADR-0019).
    const delB64 = u.searchParams.get('delegation');
    if (!enrolled && !enrollErr) return;
    for (const k of ['enrolled', 'enroll_error', 'name', 'state', 'agent', 'delegation']) u.searchParams.delete(k);
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
    // Fail-closed (audit F5): a return MUST carry a state that matches the one we stashed.
    if (!stored.state || !retState || stored.state !== retState) {
      setError('We couldn’t verify that setup response. Please start setup again.');
      return;
    }
    const name = retName ?? stored.name ?? '';
    if (!name) {
      setError('Enrollment returned without a name.');
      return;
    }
    let delegation: DelegationWire | undefined;
    try {
      if (delB64) delegation = JSON.parse(atob(delB64)) as DelegationWire;
    } catch {
      /* ignore */
    }
    if (!delegation) {
      setError('Enrollment returned without a delegation. Please try again.');
      return;
    }
    void finishEnrollment(name, delegation);
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
  // Wallet → connectWithName (the wallet IS the person's custodian). Passkey → the site's
  // scoped delegation (ADR-0019): load the stored delegation + verify it (not isCustodian).
  async function onConnectName(via: Via) {
    if (!connectName.trim()) return;
    setConnectErr(null);
    setBusy(true);
    try {
      if (via === 'passkey') {
        const del = loadDelegation(connectName.trim());
        if (!del) {
          setConnectErr('This site isn’t set up for that agent yet — use “Set up this site”.');
          return;
        }
        const out = await connectWithDelegation(connectName.trim(), del);
        if (out.ok) openSession(out.token, 'passkey', out.name ?? connectName.trim(), false);
        else setConnectErr(out.error);
        return;
      }
      const out = await connectWithName(connectName.trim(), 'wallet');
      if (out.ok) openSession(out.token, 'wallet', out.name ?? connectName.trim(), false);
      else setConnectErr(out.error);
    } catch (e) {
      setConnectErr(e instanceof Error ? e.message : 'connect failed');
    } finally {
      setBusy(false);
    }
  }

  // After the central auth issues the delegation, store it and sign in via the delegation
  // (retry for post-issue RPC lag — the person SA / delegate SA reads may briefly lag).
  async function finishEnrollment(name: string, delegation: DelegationWire) {
    try {
      localStorage.setItem(delegationKey(name), JSON.stringify(delegation));
      localStorage.setItem(LOCAL_PASSKEY_NAME, name);
    } catch {
      /* ignore */
    }
    setFlow({ title: 'Finishing setup…', phase: 'running', steps: ['Signing you in…'] });
    let lastErr = '';
    for (let i = 0; i < 5; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 2500));
      const out = await connectWithDelegation(name, delegation);
      if (out.ok) {
        setFlow(null);
        openSession(out.token, 'passkey', out.name ?? name, true);
        return;
      }
      lastErr = out.error;
    }
    setFlow({ title: 'Couldn’t finish', phase: 'error', steps: [], error: lastErr || 'sign-in after enrollment failed' });
  }

  // Begin cross-origin setup: register a LOCAL passkey for this origin (Windows Hello), then
  // hand off to the central auth — in a POPUP (keeps you here; first-party context for the
  // home ceremony), falling back to a full-page redirect when the popup is blocked or on
  // mobile. Used for a brand-new signup (central creates the account) AND "set up this site"
  // for an existing agent (central adds this site's key). Spec 229 §3 + popup UX design.
  async function beginSiteSetup(name: string) {
    setError(null);
    setConnectErr(null);
    setFlow({ title: 'Setting up your account', phase: 'running', steps: ['Creating your sign-in key on this device…'] });
    let url: string;
    let state: string;
    try {
      // Registers a local passkey + deploys this site's delegate SA (Windows Hello prompts).
      const started = await startSiteEnrollment(name, (s) =>
        setFlow({ title: 'Setting up your account', phase: 'running', steps: [s] }),
      );
      if (!started.ok) {
        setFlow({ title: 'Couldn’t start setup', phase: 'error', steps: [], error: started.error });
        return;
      }
      ({ url, state } = started);
    } catch (e) {
      setFlow({
        title: 'Couldn’t start setup',
        phase: 'error',
        steps: [],
        error: e instanceof Error ? e.message : 'could not set up this device',
      });
      return;
    }

    // Mobile / narrow viewport → full-page redirect (a popup would open as a tab).
    if (preferRedirect()) {
      sessionStorage.setItem(ENROLL_KEY, JSON.stringify({ state, name }));
      setFlow({
        title: 'Setting up your account',
        phase: 'running',
        steps: ['Created your sign-in key', 'Taking you to your secure home to finish…'],
      });
      await new Promise((r) => setTimeout(r, 700));
      window.location.href = url;
      return;
    }

    // Desktop → popup-first.
    setFlow({
      title: 'Setting up your account',
      phase: 'running',
      steps: ['Created your sign-in key', 'Opening your secure home…'],
    });
    const result = await openCentralAuthPopup(url, state, (msg) =>
      setFlow({ title: 'Setting up your account', phase: 'running', steps: ['Created your sign-in key', msg] }),
    );
    if (result.status === 'blocked') {
      // Popup blocked → fall back to a redirect (carry state via sessionStorage).
      sessionStorage.setItem(ENROLL_KEY, JSON.stringify({ state, name }));
      setFlow({
        title: 'Setting up your account',
        phase: 'running',
        steps: ['Created your sign-in key', 'Your browser blocked the popup — taking you to your secure home…'],
      });
      await new Promise((r) => setTimeout(r, 1100));
      window.location.href = url;
      return;
    }
    if (result.status === 'cancelled') {
      setFlow(null);
      setConnectErr('Setup was cancelled. You can try again.');
      return;
    }
    if (result.status === 'error') {
      setFlow({ title: 'Couldn’t finish', phase: 'error', steps: [], error: result.error });
      return;
    }
    if (!result.delegation) {
      setFlow({ title: 'Couldn’t finish', phase: 'error', steps: [], error: 'no delegation returned from your secure home' });
      return;
    }
    await finishEnrollment(result.name || name, result.delegation);
  }

  /** Existing agent, first time on this site → set up a site key via the central auth. */
  const onAddSite = (name: string) => beginSiteSetup(name);

  async function onSignup(via: Via) {
    const base = desiredName.trim();
    if (!base || signupAvail !== 'available') return;
    // Passkey signup is HOMED at the central auth: create a local key here, then the central
    // auth creates your account (ROOT passkey) + links this site. Wallet signup stays local
    // (a wallet already works across origins, so no central round-trip is needed).
    if (via === 'passkey') {
      await beginSiteSetup(base);
      return;
    }
    setError(null);
    const steps: string[] = [];
    const onStep = (s: string) => {
      steps.push(s);
      setFlow({ title: 'Creating your account…', phase: 'running', steps: [...steps] });
    };
    setFlow({ title: 'Creating your account…', phase: 'running', steps: [] });
    try {
      const out = await signupWithName(base, via, onStep);
      if (!out.ok) {
        setFlow({ title: 'Couldn’t finish', phase: 'error', steps: [...steps], error: out.error });
        return;
      }
      setFlow({ title: '✓ Account ready', phase: 'done', steps: [...steps] });
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
    // The person→org governance edge is recorded AS THE PERSON by redeeming this site's
    // delegation (ADR-0019). Pass it for the passkey/delegation session.
    const delegation = via === 'passkey' ? (loadDelegation(session.name) ?? undefined) : undefined;
    try {
      const out = await createOrg(via, session.address, base, onStep, delegation);
      if (!out.ok) {
        setFlow({ title: 'Couldn’t finish', phase: 'error', steps: [...steps], error: out.error });
        return;
      }
      setFlow({ title: '✓ Organization created', phase: 'done', steps: [...steps] });
      const next = [{ orgAgent: out.result.orgAgent, orgName: out.result.orgName, governed: out.result.governed }, ...orgs];
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

  // Read an org's gated data via an org→person delegation (the org is custodied by this
  // site's passkey). Demonstrates reading org PII through the delegation model.
  async function onViewOrgData(orgAgent: string) {
    if (!session) return;
    setOrgData((m) => ({ ...m, [orgAgent]: { loading: true } }));
    try {
      const out = await readOrgData(orgAgent as Address, session.address);
      setOrgData((m) => ({
        ...m,
        [orgAgent]: out.ok ? { record: out.record } : { error: out.error },
      }));
    } catch (e) {
      setOrgData((m) => ({ ...m, [orgAgent]: { error: e instanceof Error ? e.message : 'read failed' } }));
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
                  {nameInfo.hasPasskey && hasLocalDelegation(nameInfo.name!) && (
                    <button disabled={busy} onClick={() => onConnectName('passkey')}>
                      Continue with passkey
                    </button>
                  )}{' '}
                  {nameInfo.hasEoa && (
                    <button disabled={busy} onClick={() => onConnectName('wallet')}>
                      Continue with wallet
                    </button>
                  )}{' '}
                  {nameInfo.hasPasskey && !hasLocalDelegation(nameInfo.name!) && (
                    <button disabled={busy} onClick={() => onAddSite(nameInfo.name!)}>
                      Set up this site (passkey) →
                    </button>
                  )}
                </p>
                {nameInfo.hasPasskey && !hasLocalDelegation(nameInfo.name!) && (
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
            <p className="muted">
              Pick a name for your account. With a passkey, we’ll set up your <strong>secure home</strong> (you’ll
              approve there, then come right back). A wallet creates it here directly.
            </p>
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
                  className="ghost"
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
                {orgs.map((o) => {
                  const data = orgData[o.orgAgent];
                  return (
                    <li key={o.orgAgent} style={{ marginBottom: '0.6rem' }}>
                      <strong>{o.orgName}</strong> — <code>{short(o.orgAgent)}</code>{' '}
                      {o.governed ? (
                        <span className="badge" title="person → HAS_GOVERNANCE_OVER → org recorded on-chain (via your delegation)">
                          you govern (on-chain)
                        </span>
                      ) : (
                        <span className="badge" title="Org created; governance edge not recorded">
                          org created
                        </span>
                      )}{' '}
                      <button
                        className="ghost"
                        style={{ minHeight: '32px', padding: '0.25rem 0.7rem', fontSize: '0.8rem' }}
                        disabled={data?.loading}
                        onClick={() => onViewOrgData(o.orgAgent)}
                      >
                        {data?.loading ? 'Reading…' : 'View org data'}
                      </button>
                      {data?.error && <p className="err" style={{ margin: '0.3rem 0 0' }}>⛔ {data.error}</p>}
                      {data && 'record' in data && data.record != null && (
                        <pre style={{ marginTop: '0.4rem' }}>{JSON.stringify(data.record, null, 2)}</pre>
                      )}
                    </li>
                  );
                })}
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
                <button className="ghost" onClick={() => setFlow(null)}>Close</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
