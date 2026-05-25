import { useCallback, useEffect, useState } from 'react';
import type { Address, Hex } from '@agenticprimitives/types';
import {
  AUD,
  siweLogin,
  bootstrapWithWallet,
  passkeyLogin,
  bootstrapWithPasskey,
  passkeySignHash,
  claimName,
  fetchProfile,
  fetchSensitive,
  type BasicProfile,
  type DemoPasskey,
} from './connect-client';
import { hasWallet, personalSign } from './lib/wallet';
import { startGoogleSignIn, exchangeCode } from './server-client';

interface Session {
  token: string;
  via: string; // 'wallet' | 'Google'
  fresh: boolean; // true = just created (welcome) vs reconnected (welcome back)
}
type BootstrapState =
  | { kind: 'wallet'; address: Address; step?: string; error?: string }
  | { kind: 'passkey'; passkey: DemoPasskey; step?: string; error?: string };

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<BasicProfile | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sensitive, setSensitive] = useState<{ email: string; phone: string } | null>(null);
  const [stepUpMsg, setStepUpMsg] = useState<string | null>(null);
  const [desiredName, setDesiredName] = useState('');
  const [googleNotice, setGoogleNotice] = useState<string | null>(null);

  const openSession = useCallback(async (token: string, via: string, fresh: boolean) => {
    setSession({ token, via, fresh });
    setProfile(await fetchProfile(token));
  }, []);

  // Real Google OIDC return: ?code → exchange → token (login-grade session).
  useEffect(() => {
    const url = new URL(window.location.href);
    // Google bootstrap (no agent linked to this subject yet) — the callback redirects
    // back here with a status instead of dead-ending on a JSON page.
    const connectStatus = url.searchParams.get('connect_status');
    if (connectStatus) {
      const email = url.searchParams.get('email');
      setGoogleNotice(
        `We recognized your Google account${email ? ` (${email})` : ''}, but no workspace is linked to it yet. ` +
          `Create one with your wallet below — then Google becomes a quick login for it.`,
      );
      for (const k of ['connect_status', 'via', 'email']) url.searchParams.delete(k);
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

  async function onConnectWallet() {
    setError(null);
    setBusy(true);
    try {
      const out = await siweLogin();
      if (out.status === 'issued') {
        await openSession(out.token, 'wallet', false);
      } else if (out.status === 'bootstrap') {
        setBootstrap({ kind: 'wallet', address: out.address });
      } else {
        setError(out.reason ?? `Could not sign you in (${out.status}).`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'wallet connect failed');
    } finally {
      setBusy(false);
    }
  }

  async function onConnectPasskey() {
    setError(null);
    setBusy(true);
    try {
      const out = await passkeyLogin();
      if (out.status === 'issued') {
        await openSession(out.token, 'passkey', false);
      } else if (out.status === 'bootstrap') {
        setBootstrap({ kind: 'passkey', passkey: out.passkey });
      } else {
        setError(out.reason ?? `Could not sign you in (${out.status}).`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'passkey connect failed');
    } finally {
      setBusy(false);
    }
  }

  async function onCreateWorkspace() {
    const bs = bootstrap;
    if (!bs) return;
    const setStep = (step: string) => setBootstrap((b) => (b ? { ...b, step } : b));
    const fail = (error: string) => setBootstrap((b) => (b ? { ...b, step: undefined, error } : b));
    setBootstrap({ ...bs, error: undefined, step: 'Starting…' });

    let agent: Address;
    let signHash: (h: Hex) => Promise<Hex>;
    if (bs.kind === 'wallet') {
      const res = await bootstrapWithWallet(bs.address, setStep);
      if (!res.ok) return fail(res.error);
      agent = res.agent;
      signHash = (h) => personalSign(bs.address, h);
    } else {
      const res = await bootstrapWithPasskey(bs.passkey, setStep);
      if (!res.ok) return fail(res.error);
      agent = res.agent;
      signHash = passkeySignHash;
    }
    // Claim a forced-unique <name>.demo.agent (best-effort; non-fatal).
    await claimName(agent, signHash, desiredName || 'agent', setStep);
    setStep('Finishing up…');
    try {
      const out = bs.kind === 'wallet' ? await siweLogin() : await passkeyLogin(false);
      if (out.status === 'issued') {
        setBootstrap(null);
        await openSession(out.token, bs.kind, true);
      } else {
        fail(`created, but sign-in returned ${out.status}`);
      }
    } catch (e) {
      fail(e instanceof Error ? e.message : 'sign-in failed');
    }
  }

  async function onRevealSensitive() {
    if (!session) return;
    setStepUpMsg(null);
    const r = await fetchSensitive(session.token);
    if (r.ok) setSensitive({ email: r.email, phone: r.phone });
    else setStepUpMsg(r.reason);
  }

  function signOut() {
    setSession(null);
    setProfile(null);
    setSensitive(null);
    setStepUpMsg(null);
    setBootstrap(null);
    setError(null);
  }

  return (
    <div>
      <h1>Agentic Connect</h1>
      <p className="muted">
        Your portable workspace — created once, on Base Sepolia, and reachable from any app with any
        sign-in. One canonical agent; your wallet, passkey, social, or agent name all return the same you.
      </p>

      {error && <p className="err">⛔ {error}</p>}

      {/* ── Not signed in: connect ───────────────────────────────── */}
      {!session && !bootstrap && (
        <div className="panel broker">
          <h2>Connect</h2>
          <p className="muted">Choose how to sign in. First time? We'll create your workspace.</p>
          {googleNotice && <p className="ok">ℹ️ {googleNotice}</p>}
          <p>
            <button disabled={busy} onClick={onConnectPasskey}>
              {busy ? 'Working…' : 'Use a passkey'}
            </button>{' '}
            <button disabled={busy} onClick={onConnectWallet}>
              Connect wallet
            </button>{' '}
            <button disabled={busy} onClick={() => startGoogleSignIn(AUD, window.location.origin + '/')}>
              Continue with Google
            </button>
          </p>
          {!hasWallet() && (
            <p className="muted">
              <em>No browser wallet detected</em> — use a passkey (your device) or continue with Google.
            </p>
          )}
          <p className="muted">
            <strong>Passkey</strong> or <strong>wallet</strong> are custody-grade — they create/secure your
            workspace and unlock sensitive details. <strong>Google</strong> is login-grade: it reads your
            basic profile, but you'll add a passkey/wallet to your workspace for anything sensitive
            (ADR-0017).
          </p>
        </div>
      )}

      {/* ── Bootstrap: create the workspace ──────────────────────── */}
      {bootstrap && (
        <div className="panel broker">
          <h2>Create your workspace</h2>
          {!bootstrap.step && !bootstrap.error && (
            <>
              <p className="muted">
                No workspace yet for your{' '}
                {bootstrap.kind === 'wallet' ? (
                  <>wallet <code>{bootstrap.address}</code></>
                ) : (
                  <>passkey</>
                )}
                . We'll deploy your personal Smart Agent on Base Sepolia (gas sponsored — you won't pay),
                link this credential to it, and claim a <code>.demo.agent</code> name.
              </p>
              <p>
                <label className="muted">
                  Pick a name:{' '}
                  <input
                    value={desiredName}
                    onChange={(e) => setDesiredName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    placeholder="e.g. alice"
                    style={{ marginRight: '0.25rem' }}
                  />
                  <code>{(desiredName || 'agent')}.demo.agent</code>{' '}
                  <span className="muted">(a number is appended if taken)</span>
                </label>
              </p>
              <button onClick={onCreateWorkspace}>Create my workspace</button>{' '}
              <button onClick={signOut}>Cancel</button>
            </>
          )}
          {bootstrap.step && (
            <>
              <p className="ok">⏳ {bootstrap.step}</p>
              <p className="muted">This usually takes 15–30 seconds. Confirm any wallet prompt.</p>
            </>
          )}
          {bootstrap.error && (
            <>
              <p className="err">⛔ {bootstrap.error}</p>
              <p className="muted">Nothing was charged. You can try again.</p>
              <button onClick={onCreateWorkspace}>Try again</button>{' '}
              <button onClick={signOut}>Cancel</button>
            </>
          )}
        </div>
      )}

      {/* ── Signed in: the agent card + PII ──────────────────────── */}
      {session && (
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
            <p className="muted" style={{ marginTop: '0.5rem' }}>
              Your workspace stays safe. Sign back in anytime with the same wallet — it resolves to this same
              agent.
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
                  Sensitive details are protected — they require a <strong>custody-grade</strong> session
                  (wallet/passkey). A Google (login-grade) session is asked to step up (ADR-0017 / CN-2).
                </p>
              </>
            )}
          </div>
        </>
      )}

      <p className="muted" style={{ marginTop: '1rem', fontSize: '0.85em' }}>
        Real on Base Sepolia (chain 84532): identity resolves on-chain, the workspace is a deployed
        ERC-4337 Smart Agent, and PII is gated by the verified <code>AgentSession</code> (spec 227).
      </p>
    </div>
  );
}
