import { useEffect, useState } from 'react';
import { loadOrCreateDemoUser, resetDemoUser, type DemoUser } from './test-user';
import { signInWithSiwe } from './siwe-flow';
import { authorizeAgent as authorizeAgentFlow } from './authorize-flow';
import { readProfile } from './read-profile-flow';
import { deploySmartAccount } from './deploy-flow';
import {
  registerPasskey,
  loadPasskey,
  clearPasskey,
  type DemoPasskey,
} from './passkey-flow';
import { signInWithPasskey } from './passkey-siwe-flow';
import type { Address } from '@agenticprimitives/types';

const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 31337);
const RPC_URL = String(import.meta.env.VITE_RPC_URL ?? 'http://127.0.0.1:8545');

type SignerKind = 'eoa' | 'passkey';
const SIGNER_PREF_KEY = 'agenticprimitives:demo:signer';

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
  signerKind: SignerKind;
  user: DemoUser;
  passkey: DemoPasskey | null;
  smartAccountAddress: Address | null;
  isDeployed: boolean;
  paymasterAvailable: boolean;
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
    const passkey = loadPasskey();
    const storedKind = (localStorage.getItem(SIGNER_PREF_KEY) as SignerKind | null) ?? 'eoa';
    setState({
      signerKind: storedKind,
      user,
      passkey,
      smartAccountAddress: null,
      isDeployed: false,
      paymasterAvailable: true,
      sessionId: null,
      delegationHash: null,
      profile: null,
      log: [
        `Loaded demo EOA: ${user.address}`,
        passkey
          ? `Found stored passkey: ${passkey.label} (cred=${passkey.credentialIdB64.slice(0, 8)}…)`
          : 'No passkey registered yet.',
      ],
      deployments: null,
    });
    fetch('/a2a/deployments')
      .then((r) => r.json())
      .then((d: Deployments) => setState((s) => (s ? { ...s, deployments: d } : s)))
      .catch(() => {});
  }, []);

  const append = (line: string) =>
    setState((s) => (s ? { ...s, log: [...s.log, line] } : s));

  const selectSigner = (kind: SignerKind) => {
    localStorage.setItem(SIGNER_PREF_KEY, kind);
    setState((s) => (s ? { ...s, signerKind: kind } : s));
  };

  const registerNewPasskey = async () => {
    if (!state) return;
    append('[0] WebAuthn: prompting browser for new passkey…');
    try {
      const passkey = await registerPasskey(`Demo passkey ${new Date().toISOString().slice(0, 10)}`);
      append(
        `[0] ✓ Passkey registered. credId=${passkey.credentialIdB64.slice(0, 12)}… x=${passkey.pubKeyX.toString(16).slice(0, 8)}… y=${passkey.pubKeyY.toString(16).slice(0, 8)}…`,
      );
      setState((s) => (s ? { ...s, passkey } : s));
    } catch (e) {
      append(`[0] passkey registration failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const removePasskey = () => {
    clearPasskey();
    setState((s) => (s ? { ...s, passkey: null } : s));
    append('[0] passkey cleared from localStorage');
  };

  // STEP 1: sign in (EOA via SIWE, or passkey via SIWE-1271/6492)
  const signIn = async () => {
    if (!state) return;
    if (state.signerKind === 'eoa') {
      append('[1] EOA SIWE: building message + signing with EOA…');
      const res = await signInWithSiwe(state.user, CHAIN_ID);
      if (!res.ok) {
        append(`[1] FAILED: ${res.error}${res.reason ? ` (${res.reason})` : ''}`);
        return;
      }
      append(
        `[1] ✓ Signed in (EOA). wallet=${res.walletAddress} smartAccount=${res.smartAccountAddress} deployed=${res.isDeployed}`,
      );
      setState((s) =>
        s
          ? {
              ...s,
              smartAccountAddress: res.smartAccountAddress,
              isDeployed: res.isDeployed,
            }
          : s,
      );
      return;
    }
    // Passkey path
    if (!state.passkey) {
      append('[1] passkey path requires a registered passkey — see Step 0.');
      return;
    }
    if (!state.deployments) {
      append('[1] deployments not loaded yet — try again.');
      return;
    }
    append('[1] Passkey SIWE: building message + signing via WebAuthn ceremony…');
    const res = await signInWithPasskey({
      passkey: state.passkey,
      agentAccountFactory: state.deployments.agentAccountFactory,
      rpcUrl: RPC_URL,
      chainId: CHAIN_ID,
    });
    if (!res.ok) {
      append(`[1] FAILED: ${res.error}${res.reason ? ` (${res.reason})` : ''}`);
      return;
    }
    append(
      `[1] ✓ Signed in (passkey). smartAccount=${res.smartAccountAddress} deployed=${res.isDeployed}`,
    );
    setState((s) =>
      s
        ? {
            ...s,
            smartAccountAddress: res.smartAccountAddress,
            isDeployed: res.isDeployed,
          }
        : s,
    );
  };

  // STEP 1.5: deploy smart account via paymaster-sponsored UserOp
  // (EOA path only for now; passkey deploy is Phase 4b — see spec 130.)
  const deployAccount = async () => {
    if (!state || !state.smartAccountAddress) return;
    if (state.signerKind === 'passkey') {
      append(
        '[1.5] passkey-driven deploy is Phase 4b (PasskeySigner adapter). For now the demo signs in counterfactually — your account is deployed lazily by the universal validator during sign-in if needed.',
      );
      return;
    }
    append('[1.5] /session/deploy → sign userOpHash → /session/deploy/submit…');
    const res = await deploySmartAccount(state.user, state.user.address);
    if (!res.ok) {
      if (res.paymasterUnavailable) {
        append('[1.5] paymaster not configured — falling back to counterfactual mode');
        setState((s) => (s ? { ...s, paymasterAvailable: false } : s));
        return;
      }
      append(`[1.5] FAILED: ${res.error}${res.reason ? ` (${res.reason})` : ''}`);
      return;
    }
    append(`[1.5] ✓ Deployed at ${res.deployedAddress} via tx ${res.transactionHash}`);
    setState((s) => (s ? { ...s, isDeployed: true } : s));
  };

  const authorizeAgent = async () => {
    if (!state || !state.smartAccountAddress || !state.deployments) {
      append('[2] not ready (need smart account + deployments)');
      return;
    }
    if (state.signerKind === 'passkey') {
      append(
        '[2] passkey-driven delegation signing is Phase 4b — passkey signers for EIP-712 delegations will land in a follow-up.',
      );
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

  const readMyProfile = async () => {
    if (!state || !state.sessionId) {
      append('[3] not ready (need session)');
      return;
    }
    append('[3] POST /a2a/tools/get_profile → a2a mints token → mcp verifies + returns…');
    const res = await readProfile(state.sessionId);
    if (!res.ok) {
      append(`[3] FAILED: ${res.error}`);
      return;
    }
    append(`[3] ✓ Profile received. owner=${res.profile.owner_address} email=${res.profile.email}`);
    setState((s) => (s ? { ...s, profile: res.profile } : s));
  };

  const reset = () => {
    resetDemoUser();
    clearPasskey();
    localStorage.removeItem(SIGNER_PREF_KEY);
    location.reload();
  };

  if (!state) return <p>Loading…</p>;

  const isPasskey = state.signerKind === 'passkey';

  return (
    <>
      <h1>agenticprimitives demo</h1>
      <p className="muted">
        End-to-end demo of all 7 packages. Choose how you want to authenticate
        (EOA via SIWE or passkey via WebAuthn) — the rest of the flow is
        identical at the protocol layer, because demo-a2a verifies user
        signatures through ERC-1271/6492 and doesn't know which method you used.
      </p>

      <div className="step">
        <h3>Step 0 — Choose signer</h3>
        <p>
          <label style={{ marginRight: 16 }}>
            <input
              type="radio"
              name="signer"
              checked={state.signerKind === 'eoa'}
              onChange={() => selectSigner('eoa')}
              disabled={!!state.smartAccountAddress}
            />{' '}
            EOA (SIWE / mnemonic)
          </label>
          <label>
            <input
              type="radio"
              name="signer"
              checked={state.signerKind === 'passkey'}
              onChange={() => selectSigner('passkey')}
              disabled={!!state.smartAccountAddress}
            />{' '}
            Passkey (WebAuthn / P-256)
          </label>
        </p>
        {isPasskey && (
          <div className="muted" style={{ marginTop: 8 }}>
            <p>
              {state.passkey ? (
                <>Stored passkey: <code>{state.passkey.label}</code> (credentialId{' '}
                <code>{state.passkey.credentialIdB64.slice(0, 16)}…</code>)</>
              ) : (
                <>No passkey registered. Click below to create one — your browser will prompt for biometrics.</>
              )}
            </p>
            <button onClick={registerNewPasskey} disabled={!!state.smartAccountAddress}>
              {state.passkey ? 'Re-register passkey' : 'Register passkey'}
            </button>
            {state.passkey && (
              <button
                onClick={removePasskey}
                disabled={!!state.smartAccountAddress}
                style={{ marginLeft: 8 }}
              >
                Clear passkey
              </button>
            )}
          </div>
        )}
        {!isPasskey && (
          <p>
            <code>{state.user.address}</code>
            <span className="muted"> (mnemonic in localStorage — demo only)</span>
          </p>
        )}
        <button onClick={reset} style={{ marginTop: 8 }}>Reset all state</button>
      </div>

      <div className="step">
        <h3>Step 1 — Sign in {isPasskey ? '(passkey via SIWE-1271/6492)' : '(EOA via SIWE)'}</h3>
        <p>
          {state.smartAccountAddress
            ? <span className="ok">✓ Signed in. Smart account: <code>{state.smartAccountAddress}</code></span>
            : <span className="muted">Not signed in.</span>}
        </p>
        <button
          onClick={signIn}
          disabled={!!state.smartAccountAddress || (isPasskey && !state.passkey)}
        >
          {isPasskey ? 'Sign in with passkey' : 'Sign in with EOA'}
        </button>
      </div>

      {state.smartAccountAddress && state.paymasterAvailable && (
        <div className="step">
          <h3>Step 1.5 — Deploy smart account</h3>
          <p>
            {state.isDeployed
              ? <span className="ok">✓ Smart account deployed on-chain. ERC-1271 verification is live.</span>
              : <span className="muted">
                  {isPasskey
                    ? 'Passkey accounts deploy lazily via the universal validator during sign-in.'
                    : 'Smart account not yet deployed (counterfactual address). Deploy via paymaster-sponsored UserOp — you sign the userOpHash; the demo paymaster pays gas.'}
                </span>}
          </p>
          {!isPasskey && (
            <button onClick={deployAccount} disabled={state.isDeployed}>
              {state.isDeployed ? 'Deployed' : 'Deploy smart account'}
            </button>
          )}
        </div>
      )}

      <div className="step">
        <h3>Step 2 — Authorize agent (issue delegation)</h3>
        <p>
          {state.sessionId
            ? <span className="ok">✓ Session active: <code>{state.sessionId}</code></span>
            : <span className="muted">No session yet.</span>}
        </p>
        {isPasskey && !state.sessionId && (
          <p className="muted" style={{ fontSize: '0.9em' }}>
            Note: passkey-driven delegation signing (EIP-712 via WebAuthn) is Phase 4b.
            This button is disabled for the passkey path until the PasskeySigner adapter lands.
          </p>
        )}
        <button
          onClick={authorizeAgent}
          disabled={
            !state.smartAccountAddress ||
            !!state.sessionId ||
            (state.paymasterAvailable && !state.isDeployed && !isPasskey) ||
            isPasskey
          }
        >
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
