import { useEffect, useState } from 'react';
import { loadOrCreateDemoUser, resetDemoUser, type DemoUser } from './test-user';

// Each step below is a stub. As the @agenticprimitives/* packages get
// implemented (per spec 101 priority order), these stubs get replaced with
// real calls.

interface DemoState {
  user: DemoUser;
  smartAccountAddress: string | null;
  sessionId: string | null;
  delegationHash: string | null;
  profile: unknown;
  log: string[];
}

export function App() {
  const [state, setState] = useState<DemoState | null>(null);

  useEffect(() => {
    const user = loadOrCreateDemoUser();
    setState({
      user,
      smartAccountAddress: null,
      sessionId: null,
      delegationHash: null,
      profile: null,
      log: [`Loaded demo EOA: ${user.address}`],
    });
  }, []);

  const append = (line: string) =>
    setState((s) => (s ? { ...s, log: [...s.log, line] } : s));

  // STEP 1: SIWE login → JWT session
  const signIn = async () => {
    append('[1] SIWE login → JWT session (TODO: implement once identity-auth + agent-account are real)');
    // const message = siwe.buildMessage({ ... });
    // const signature = await state!.user.account.signMessage({ message });
    // const res = await fetch('/a2a/auth/siwe-verify', { method: 'POST', body: JSON.stringify({ message, signature }) });
    // const { smartAccountAddress } = await res.json();
    // setState(s => s ? { ...s, smartAccountAddress } : s);
  };

  // STEP 2: a2a init session → web builds + signs Delegation → a2a packages it
  const authorizeAgent = async () => {
    append('[2] Authorize agent: a2a /session/init → user signs delegation → /session/package (TODO: implement once delegation is real)');
  };

  // STEP 3: web calls a2a tool proxy → a2a → mcp → returns PII
  const readMyProfile = async () => {
    append('[3] Read my profile via a2a → mcp (TODO: implement once mcp-runtime is real)');
  };

  const reset = () => {
    resetDemoUser();
    location.reload();
  };

  if (!state) return <p>Loading…</p>;

  return (
    <>
      <h1>agenticprimitives demo</h1>
      <p className="muted">
        End-to-end demo of all 7 packages. A test EOA in localStorage signs
        in via SIWE → smart account is provisioned → user delegates to an
        a2a session key → a2a calls an MCP tool that returns the user's PII,
        verified by the full delegation chain.
      </p>

      <div className="step">
        <h3>Demo user (EOA)</h3>
        <p><code>{state.user.address}</code></p>
        <p className="muted">Mnemonic stored in localStorage. Demo-only — never do this in production.</p>
        <button onClick={reset}>Reset user</button>
      </div>

      <div className="step">
        <h3>Step 1 — Sign in (SIWE)</h3>
        <p>
          {state.smartAccountAddress
            ? <span className="ok">✓ Signed in. Smart account: <code>{state.smartAccountAddress}</code></span>
            : <span className="muted">Not signed in.</span>}
        </p>
        <button onClick={signIn} disabled={!!state.smartAccountAddress}>Sign in with EOA</button>
      </div>

      <div className="step">
        <h3>Step 2 — Authorize agent (issue delegation)</h3>
        <p>
          {state.sessionId
            ? <span className="ok">✓ Session active: <code>{state.sessionId}</code></span>
            : <span className="muted">No session yet.</span>}
        </p>
        <button onClick={authorizeAgent} disabled={!state.smartAccountAddress || !!state.sessionId}>
          Authorize agent
        </button>
      </div>

      <div className="step">
        <h3>Step 3 — Read profile via agent</h3>
        <pre>{state.profile ? JSON.stringify(state.profile, null, 2) : '(no profile loaded)'}</pre>
        <button onClick={readMyProfile} disabled={!state.sessionId}>Read my profile</button>
      </div>

      <div className="step">
        <h3>Log</h3>
        <pre>{state.log.join('\n')}</pre>
      </div>
    </>
  );
}
