import { useCallback, useEffect, useState } from 'react';
import type { Address } from '@agenticprimitives/types';
import {
  AUD,
  signupWithName,
  stepUpToAgent,
  connectWithName,
  provisionA2aAgent,
  addWalletCredential,
  addPasskeyCredential,
  fetchProfile,
  fetchSensitive,
  type BasicProfile,
} from './connect-client';
import { hasWallet } from './lib/wallet';
import { startGoogleSignIn, exchangeCode } from './server-client';

interface Session {
  token: string;
  via: string; // 'wallet' | 'Google'
  fresh: boolean; // true = just created (welcome) vs reconnected (welcome back)
}

const SESSION_KEY = 'agenticprimitives:demo-sso:session';

/** True iff we should try to restore a persisted session on load — i.e. one is stored
 *  AND we're not mid Google-redirect (which mints its own session from ?code). */
function shouldRestore(): boolean {
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.has('code') || u.searchParams.has('connect_status')) return false;
    return !!localStorage.getItem(SESSION_KEY);
  } catch {
    return false;
  }
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState<boolean>(shouldRestore);
  const [profile, setProfile] = useState<BasicProfile | null>(null);
  const [signupAvail, setSignupAvail] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  // Live signup progress, rendered as a modal checklist.
  const [signup, setSignup] = useState<
    | { phase: 'running' | 'done'; steps: string[] }
    | { phase: 'error'; steps: string[]; error: string }
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sensitive, setSensitive] = useState<{ email: string; phone: string } | null>(null);
  const [stepUpMsg, setStepUpMsg] = useState<string | null>(null);
  const [desiredName, setDesiredName] = useState('');
  const [connectName, setConnectName] = useState('');
  const [connectErr, setConnectErr] = useState<string | null>(null);
  const [nameInfo, setNameInfo] = useState<{
    status: 'idle' | 'checking' | 'none' | 'found';
    name?: string;
    hasEoa?: boolean;
    hasPasskey?: boolean;
  }>({ status: 'idle' });
  const [googleNotice, setGoogleNotice] = useState<string | null>(null);
  const [service, setService] = useState<{ step?: string; error?: string; a2aAgent?: string } | null>(null);
  const [addCred, setAddCred] = useState<{ step?: string; error?: string; done?: string } | null>(null);

  const openSession = useCallback(async (token: string, via: string, fresh: boolean) => {
    setSession({ token, via, fresh });
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ token, via })); // survive page refresh
    } catch {
      /* storage blocked (private mode) — session just won't persist */
    }
    setProfile(await fetchProfile(token));
  }, []);

  // Restore a persisted session on load (within the token's lifetime), unless we're
  // mid Google-redirect (?code / connect_status) — that path mints its own session.
  useEffect(() => {
    if (!restoring) return;
    void (async () => {
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return;
        const stored = JSON.parse(raw) as { token?: string; via?: string };
        if (!stored.token || !stored.via) {
          localStorage.removeItem(SESSION_KEY);
          return;
        }
        // Validate against the broker: an expired/invalid token yields no profile → drop it.
        const p = await fetchProfile(stored.token);
        if (!p) {
          localStorage.removeItem(SESSION_KEY);
          return;
        }
        setSession({ token: stored.token, via: stored.via, fresh: false });
        setProfile(p);
      } finally {
        setRestoring(false);
      }
    })();
  }, [restoring]);

  // Real Google OIDC return: ?code → exchange → token (login-grade session).
  useEffect(() => {
    const url = new URL(window.location.href);
    // Google bootstrap (no agent linked to this subject yet) — the callback redirects
    // back here with a status instead of dead-ending on a JSON page.
    const connectStatus = url.searchParams.get('connect_status');
    if (connectStatus) {
      const email = url.searchParams.get('email');
      const reason = url.searchParams.get('reason');
      if (connectStatus === 'linked') {
        setGoogleNotice(
          `✓ Google${email ? ` (${email})` : ''} is now linked to your workspace — next time you can sign in with Google.`,
        );
      } else if (connectStatus === 'link_failed') {
        setGoogleNotice(`Couldn't link Google: ${reason ?? 'please try again'}.`);
      } else {
        setGoogleNotice(
          `We recognized your Google account${email ? ` (${email})` : ''}, but no workspace is linked to it yet. ` +
            `Create one with a wallet/passkey — or sign in with your wallet/passkey and use "Link Google".`,
        );
      }
      for (const k of ['connect_status', 'via', 'email', 'reason']) url.searchParams.delete(k);
      window.history.replaceState({}, '', url.toString());
      return;
    }
    const code = url.searchParams.get('code');
    if (!code) return;
    (async () => {
      try {
        const token = await exchangeCode(code, AUD);
        await openSession(token, 'Google', true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Google sign-in failed');
      } finally {
        url.searchParams.delete('code');
        url.searchParams.delete('state');
        window.history.replaceState({}, '', url.toString());
      }
    })();
  }, [openSession]);

  // As the user types an agent name, check on-chain: does it exist, and which custody
  // credentials does it have? → only offer passkey / wallet that actually exist on it.
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
          b.exists
            ? { status: 'found', name: b.name, hasEoa: b.hasEoa, hasPasskey: b.hasPasskey }
            : { status: 'none' },
        );
      } catch {
        setNameInfo({ status: 'idle' });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [connectName]);

  // Signup name availability: block signing up with an EXISTING agent name.
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

  // Connect by agent-service name: resolve name → agent → prove with a custody
  // credential (the name is the identity; any custodian credential gets you in).
  async function onConnectName(via: 'wallet' | 'passkey') {
    if (!connectName.trim()) return;
    setConnectErr(null);
    setBusy(true);
    try {
      const out = await connectWithName(connectName.trim(), via);
      if (out.ok) await openSession(out.token, via, false);
      else setConnectErr(out.error);
    } catch (e) {
      setConnectErr(e instanceof Error ? e.message : 'connect failed');
    } finally {
      setBusy(false);
    }
  }

  // Sign up: create a NEW workspace with the chosen name + a fresh custody credential.
  // Blocked unless the name is available (not an existing agent name).
  async function onSignup(via: 'wallet' | 'passkey') {
    const base = desiredName.trim();
    if (!base || signupAvail !== 'available') return;
    setError(null);
    setBusy(true);
    const steps: string[] = [];
    setSignup({ phase: 'running', steps: [] });
    const onStep = (s: string) => {
      steps.push(s);
      setSignup({ phase: 'running', steps: [...steps] });
    };
    try {
      const out = await signupWithName(base, via, onStep);
      if (!out.ok) {
        setSignup({ phase: 'error', steps: [...steps], error: out.error });
        return;
      }
      // Show the finished checklist for a beat, then drop into the home page.
      setSignup({ phase: 'done', steps: [...steps] });
      await new Promise((r) => setTimeout(r, 900));
      await openSession(out.token, via, true);
      // Clear connect/signup inputs so no stale name lingers if the user signs out.
      setDesiredName('');
      setConnectName('');
      setSignupAvail('idle');
      setNameInfo({ status: 'idle' });
      setConnectErr(null);
      setSignup(null);
    } catch (e) {
      setSignup({ phase: 'error', steps: [...steps], error: e instanceof Error ? e.message : 'signup failed' });
    } finally {
      setBusy(false);
    }
  }

  async function onRevealSensitive() {
    if (!session) return;
    setStepUpMsg(null);
    // Login-grade (Google): the canonical agent is custody-controlled by a wallet/passkey,
    // so fire the wallet step-up IMMEDIATELY on this click (a gesture is required for the
    // wallet to prompt — so we can't auto-fire on render, but this is one click → MetaMask).
    if (session.via === 'Google') {
      await stepUp('wallet');
      return;
    }
    const r = await fetchSensitive(session.token);
    if (r.ok) setSensitive({ email: r.email, phone: r.phone });
    else setStepUpMsg(r.reason);
  }

  // Step a Google (login-grade) session UP to custody-grade for the SAME bound agent
  // (server enforces target = googleToken.sub). The credential must be a custodian of
  // that agent — so a Google login flows into exactly ONE workspace (ADR-0017).
  async function stepUp(via: 'wallet' | 'passkey') {
    if (!session) return;
    setStepUpMsg(`Confirming with your ${via === 'wallet' ? 'wallet' : 'device'}…`);
    try {
      const out = await stepUpToAgent(via, session.token);
      if (!out.ok) {
        setStepUpMsg(out.error);
        return;
      }
      await openSession(out.token, via, false); // custody-grade for the SAME agent
      setStepUpMsg(null);
      const r = await fetchSensitive(out.token); // auto-reveal now that we're custody-grade
      if (r.ok) setSensitive({ email: r.email, phone: r.phone });
    } catch (e) {
      setStepUpMsg(e instanceof Error ? e.message : 'step-up failed');
    }
  }

  async function onProvisionService() {
    if (!session || !profile || session.via === 'Google') return;
    const personAddr = profile.agent.split(':').pop() as Address;
    setService({ step: 'Starting…' });
    const res = await provisionA2aAgent(session.via as 'wallet' | 'passkey', personAddr, (step) =>
      setService((s) => ({ ...s, step })),
    );
    setService(res.ok ? { a2aAgent: res.result.a2aAgent } : { error: res.error });
  }

  // Add the COMPLEMENTARY custody credential to this agent: wallet→add passkey,
  // passkey→add wallet. The existing credential signs the on-chain addCustodian/
  // addPasskey; the SA address is unchanged (ADR-0011).
  async function onAddCredential() {
    if (!session || !profile || session.via === 'Google') return;
    const personAddr = profile.agent.split(':').pop() as Address;
    setAddCred({ step: 'Starting…' });
    try {
      const onStep = (s: string) => setAddCred({ step: s });
      if (session.via === 'passkey') {
        const r = await addWalletCredential(personAddr, onStep);
        setAddCred(r.ok ? { done: `Wallet ${r.added.slice(0, 6)}…${r.added.slice(-4)} added` } : { error: r.error });
      } else {
        const r = await addPasskeyCredential(personAddr, onStep);
        setAddCred(r.ok ? { done: 'Passkey added' } : { error: r.error });
      }
    } catch (e) {
      setAddCred({ error: e instanceof Error ? e.message : 'add credential failed' });
    }
  }

  function signOut() {
    setSession(null);
    setProfile(null);
    setSensitive(null);
    setStepUpMsg(null);
    setService(null);
    setAddCred(null);
    setError(null);
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    // Reset the connect/signup screen so a just-used name doesn't linger as stale.
    setDesiredName('');
    setConnectName('');
    setSignupAvail('idle');
    setNameInfo({ status: 'idle' });
    setConnectErr(null);
  }

  return (
    <div>
      <h1>Agentic Connect</h1>
      <p className="muted">
        Your portable workspace — created once, on Base Sepolia, and reachable from any app with any
        sign-in. One canonical agent; your wallet, passkey, social, or agent name all return the same you.
      </p>

      {error && <p className="err">⛔ {error}</p>}

      {restoring && !session && <p className="muted">Restoring your session…</p>}

      {/* ── Not signed in: connect ───────────────────────────────── */}
      {!session && !restoring && (
        <>
          {googleNotice && (
            <div className="panel broker">
              <p className="ok" style={{ margin: 0 }}>ℹ️ {googleNotice}</p>
            </div>
          )}

          {/* Returning: connect with your agent-service name */}
          <div className="panel broker">
            <h2>Connect with your agent name</h2>
            <p className="muted">Already have a workspace? Enter its name, then confirm with the credential you set up.</p>
            <p>
              <input
                value={connectName}
                onChange={(e) => setConnectName(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ''))}
                placeholder="bob.demo.agent"
                style={{ minWidth: '14rem' }}
              />
            </p>
            {nameInfo.status === 'checking' && <p className="muted">Checking…</p>}
            {nameInfo.status === 'none' && (
              <p className="muted">No workspace with that name yet — new here? Sign up below. ↓</p>
            )}
            {nameInfo.status === 'found' && (
              <>
                <p className="ok" style={{ margin: '0 0 0.5rem' }}>
                  ✓ Found <code>{nameInfo.name}</code>
                </p>
                <p>
                  {nameInfo.hasPasskey && (
                    <button disabled={busy} onClick={() => onConnectName('passkey')}>
                      Continue with passkey
                    </button>
                  )}{' '}
                  {nameInfo.hasEoa && (
                    <button disabled={busy} onClick={() => onConnectName('wallet')}>
                      Continue with wallet
                    </button>
                  )}
                  {!nameInfo.hasPasskey && !nameInfo.hasEoa && (
                    <span className="muted">This workspace has no custody credential on-chain yet.</span>
                  )}
                  {' '}
                  <span className="muted">
                    ({[nameInfo.hasPasskey && 'passkey', nameInfo.hasEoa && 'wallet'].filter(Boolean).join(' + ') ||
                      'none'}{' '}
                    on this workspace)
                  </span>
                </p>
              </>
            )}
            {connectErr && <p className="err">⛔ {connectErr}</p>}
          </div>

          {/* New: sign up — pick a unique agent name + a custody credential */}
          <div className="panel broker">
            <h2>New here? Sign up</h2>
            <p className="muted">
              Pick your agent name, then create it with a passkey or wallet (custody-grade — it secures the
              workspace and unlocks sensitive details).
            </p>
            <p>
              <input
                value={desiredName}
                onChange={(e) =>
                  // Strip a pasted ".demo.agent" suffix, then keep just the label chars —
                  // so "alicev50.demo.agent" normalizes to the base "alicev50".
                  setDesiredName(
                    e.target.value.toLowerCase().replace(/\.demo\.agent$/, '').replace(/[^a-z0-9-]/g, ''),
                  )
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
                ⛔ {desiredName}.demo.agent is taken — choose another (or connect with it above).
              </p>
            )}
            <p>
              <button disabled={busy || signupAvail !== 'available'} onClick={() => onSignup('passkey')}>
                {busy ? 'Working…' : 'Sign up with passkey'}
              </button>{' '}
              <button disabled={busy || signupAvail !== 'available'} onClick={() => onSignup('wallet')}>
                Sign up with wallet
              </button>
            </p>
            {!hasWallet() && (
              <p className="muted">
                <em>No browser wallet detected</em> — sign up with a passkey (your device).
              </p>
            )}
            <p className="muted">
              Or <button disabled={busy} onClick={() => startGoogleSignIn(AUD, window.location.origin + '/')}>continue with Google</button>{' '}
              — login-grade; it identifies a workspace but you confirm with a passkey/wallet to use it (ADR-0017).
            </p>
          </div>
        </>
      )}

      {/* ── Signed in via Google (login-grade): MANDATORY step-up to the bound agent ── */}
      {session && session.via === 'Google' && (
        <div className="panel broker">
          <h2>Confirm it's you to continue</h2>
          <p className="muted">
            Signed in with Google — this <strong>identifies your workspace</strong>, but a Google login is
            login-grade. To use it you must confirm with your <strong>passkey or wallet</strong> (a
            custody-grade credential of this same workspace).
          </p>
          <button onClick={() => stepUp('passkey')}>Continue with passkey</button>{' '}
          <button onClick={() => stepUp('wallet')}>Continue with wallet</button>{' '}
          <button onClick={signOut}>Disconnect</button>
          {stepUpMsg && <p className="err" style={{ marginTop: '0.5rem' }}>⛔ {stepUpMsg}</p>}
          <p className="muted" style={{ marginTop: '0.5rem' }}>
            If your passkey/wallet isn't part of this workspace yet, it'll say so — sign in with it directly,
            then add the other credential.
          </p>
        </div>
      )}

      {/* ── Signed in with a custody credential: the full workspace ── */}
      {session && session.via !== 'Google' && (
        <>
          <div className="panel broker">
            <h2>
              {session.fresh ? '✓ Welcome to your workspace' : '✓ Welcome back'}{' '}
              <span className="badge">via {session.via}</span>
            </h2>
            {profile ? (
              <>
                <p>
                  <strong>{profile.name ?? 'your workspace'}</strong>
                  <br />
                  <span className="muted">Canonical agent</span> <code>{profile.agent}</code>
                  <br />
                  <span className="muted">Signed in with</span> {profile.credential} ·{' '}
                  <span className="muted">access:</span>{' '}
                  <strong>{profile.access === 'standard' ? 'standard' : 'full (confirmed with device)'}</strong>
                </p>
                {!profile.name && (
                  <p className="muted">
                    <em>No <code>.demo.agent</code> name yet.</em> (Name claim lands next; your agent address
                    is the canonical identity regardless.)
                  </p>
                )}
              </>
            ) : (
              <p className="muted">Loading your profile…</p>
            )}
            <button onClick={signOut}>Sign out</button>
            <p style={{ marginTop: '0.5rem' }}>
              <button onClick={() => startGoogleSignIn(AUD, window.location.origin + '/', session.token)}>
                Link Google to this workspace
              </button>{' '}
              <span className="muted">— adds Google as a quick login (custody-authorized, P0-C).</span>
            </p>
            <p className="muted" style={{ marginTop: '0.5rem' }}>
              Your workspace stays safe. Sign back in anytime with the same credential — it resolves to this
              same agent.
            </p>
          </div>

          <div className="panel">
            <h2>Your contact details</h2>
            {sensitive ? (
              <pre>{JSON.stringify(sensitive, null, 2)}</pre>
            ) : (
              <>
                <p className="muted" style={{ filter: 'blur(4px)', userSelect: 'none' }}>
                  ▒▒▒▒▒▒▒@▒▒▒▒.▒▒▒ · +1 ▒▒▒ ▒▒▒ ▒▒▒▒
                </p>
                <button onClick={onRevealSensitive}>Confirm to view contact details</button>
                {stepUpMsg && <p className="err" style={{ marginTop: '0.5rem' }}>⛔ {stepUpMsg}</p>}
                <p className="muted">
                  Custody-grade session — your contact details unlock directly.
                </p>
              </>
            )}
          </div>

          {session.via !== 'Google' && (
            <div className="panel">
              <h2>Your agent services</h2>
              {service?.a2aAgent ? (
                <p className="ok">
                  ✓ Agent service live: <code>{service.a2aAgent}</code>
                  <br />
                  It <strong>operates on behalf of</strong> your workspace — an on-chain
                  <code> OPERATES_ON_BEHALF_OF</code> edge (it proposed; your workspace confirmed).
                </p>
              ) : service?.step ? (
                <p className="ok">⏳ {service.step}</p>
              ) : (
                <>
                  <p className="muted">
                    Provision a second Smart Agent (an A2A service agent) that acts on your behalf, linked
                    on-chain via an <code>OPERATES_ON_BEHALF_OF</code> relationship. Signed by your same
                    credential.
                  </p>
                  <button onClick={onProvisionService}>Provision an agent service</button>
                  {service?.error && (
                    <p className="err" style={{ marginTop: '0.5rem' }}>⛔ {service.error}</p>
                  )}
                </>
              )}
            </div>
          )}

          {session.via !== 'Google' && (
            <div className="panel">
              <h2>Add a sign-in method</h2>
              {addCred?.done ? (
                <p className="ok">
                  ✓ {addCred.done}. You can now sign in to{' '}
                  <code>{profile?.name ?? 'this workspace'}</code> with{' '}
                  {session.via === 'passkey' ? 'that wallet' : 'this passkey'} too — same agent, same
                  contact details.
                </p>
              ) : addCred?.step ? (
                <p className="ok">⏳ {addCred.step}</p>
              ) : (
                <>
                  <p className="muted">
                    This workspace is secured by your <strong>{session.via}</strong>. Add the other so you
                    can sign in either way. Your agent address never changes — the new credential is added
                    as a second on-chain custodian, signed by your current one.
                  </p>
                  <button onClick={onAddCredential}>
                    {session.via === 'passkey' ? 'Add a wallet (SIWE)' : 'Add a passkey'}
                  </button>
                  {addCred?.error && (
                    <p className="err" style={{ marginTop: '0.5rem' }}>⛔ {addCred.error}</p>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      <p className="muted" style={{ marginTop: '1rem', fontSize: '0.85em' }}>
        Real on Base Sepolia (chain 84532): identity resolves on-chain, the workspace is a deployed
        ERC-4337 Smart Agent, and PII is gated by the verified <code>AgentSession</code> (spec 227).
      </p>

      {/* ── Signup progress modal ──────────────────────────────────── */}
      {signup && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>
              {signup.phase === 'done'
                ? '✓ Workspace ready'
                : signup.phase === 'error'
                  ? '⛔ Couldn’t finish'
                  : 'Creating your workspace…'}
            </h2>
            <ol className="steps">
              {signup.steps.map((s, i) => {
                const isLast = i === signup.steps.length - 1;
                const done = signup.phase === 'done' || !isLast;
                const current = signup.phase === 'running' && isLast;
                return (
                  <li key={i} className={done ? 'done' : current ? 'current' : 'pending'}>
                    {current ? <span className="spinner" /> : <span>{done ? '✓' : '•'}</span>}
                    {s}
                  </li>
                );
              })}
            </ol>
            {signup.phase === 'running' && (
              <p className="muted">This takes ~15–30s. Confirm any device or wallet prompt that appears.</p>
            )}
            {signup.phase === 'done' && <p className="ok">Signing you in…</p>}
            {signup.phase === 'error' && (
              <>
                <p className="err">{signup.error}</p>
                <p className="muted">Nothing was charged. You can try again.</p>
                <button onClick={() => setSignup(null)}>Close</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
