import { useEffect, useState } from 'react';
import { loadOrCreateDemoUser, resetDemoUser, type DemoUser } from './test-user';
import { signInWithSiwe } from './siwe-flow';
import { authorizeAgent as authorizeAgentFlow } from './authorize-flow';
import type { Address } from '@agenticprimitives/types';

const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 31337);

// Step 1 (SIWE login) + Step 2 (Authorize agent) wired. Step 3 (Read profile)
// remains a stub until @agenticprimitives/mcp-runtime ships.

interface Deployments {
  chainId: number;
  delegationManager: Address;
  agentAccountFactory: Address;
  timestampEnforcer: Address;
  allowedTargetsEnforcer: Address;
  allowedMethodsEnforcer: Address;
  valueEnforcer: Address;
}

interface DemoState {
  user: DemoUser;
  smartAccountAddress: Address | null;
  sessionId: string | null;
  delegationHash: string | null;
  profile: unknown;
  log: string[];
  deployments: Deployments | null;
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
      deployments: null,
    });
    // Fetch deployment addresses once. Demo-only — not authenticated.
    fetch('/a2a/deployments')
      .then((r) => r.json())
      .then((d: Deployments) => setState((s) => (s ? { ...s, deployments: d } : s)))
      .catch(() => {
        // Demo-a2a not running yet — fine; Step 2 won't be reachable until it is.
      });
  }, []);

  const append = (line: string) =>
    setState((s) => (s ? { ...s, log: [...s.log, line] } : s));

  // STEP 1: SIWE login → JWT session
  const signIn = async () => {
    if (!state) return;
    append('[1] SIWE: building message + signing with EOA…');
    const res = await signInWithSiwe(state.user, CHAIN_ID);
    if (!res.ok) {
      append(`[1] FAILED: ${res.error}${res.reason ? ` (${res.reason})` : ''}`);
      return;
    }
    append(`[1] ✓ Signed in. wallet=${res.walletAddress} smartAccount=${res.smartAccountAddress} deployed=${res.isDeployed}`);
    setState((s) => (s ? { ...s, smartAccountAddress: res.smartAccountAddress } : s));
  };

  // STEP 2: a2a init session → web builds + signs Delegation → a2a packages it
  const authorizeAgent = async () => {
    if (!state || !state.smartAccountAddress || !state.deployments) {
      append('[2] not ready (need smart account + deployments)');
      return;
    }
    append('[2] /session/init → sign Delegation (EIP-712) → /session/package…');
    const res = await authorizeAgentFlow(state.user, {
      smartAccountAddress: state.smartAccountAddress,
      delegationManager: state.deployments.delegationManager,
      timestampEnforcer: state.deployments.timestampEnforcer,
      chainId: state.deployments.chainId,
    });
    if (!res.ok) {
      append(`[2] FAILED: ${res.error}${res.reason ? ` (${res.reason})` : ''}`);
      return;
    }
    append(
      `[2] ✓ Session packaged. sessionId=${res.sessionId} delegationHash=${res.delegationHash} erc1271Verified=${res.erc1271Verified}`,
    );
    setState((s) =>
      s ? { ...s, sessionId: res.sessionId, delegationHash: res.delegationHash } : s,
    );
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
