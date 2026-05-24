/**
 * Act 1 — Create a Person Smart Agent for a seat (spec 211 § 5 / 6f.1).
 *
 * Phase 6f.4 SIWE extension: the visitor picks 1+ auth methods at the
 * start (passkey, wallet, or both). Person.PSA deploys with the chosen
 * mix as `custodians` + `initialPasskey*`, baking the mix into
 * the CREATE2 address. The seat is stored with the matching
 * `authMethods: AuthMethod[]`.
 */

import { useState } from 'react';
import { orgConfig, type SeatDef } from '../../org-config';
import {
  registerPasskeyForSeat,
  savePasskeyForSeat,
  getPasskeyForSeat,
} from '../../lib/passkey';
import { claimSeat, setActiveSeat, type AuthMethod } from '../../lib/seats';
import { deployPersonAgent } from '../../lib/deploy-person';
import { claimPsaName, predictUniqueAgentLabel } from '../../lib/claim-psa-name';
import { passkeyIdentity } from '@agenticprimitives/custody';
import { LiveStatusBadge } from '../components/LiveStatusBadge';
import { ConnectionDialog, type ConnectionStage } from '../components/ConnectionDialog';
import { config } from '../../config';
import { useAccount, useConnect, useConnectors, useDisconnect } from 'wagmi';
import { loadSeats } from '../../lib/seats';
import { getSiweAuth } from '../../lib/seats';
import type { Address, Hex } from 'viem';

type AuthChoice = 'passkey' | 'siwe' | 'both';

type WorkingPhase =
  | 'registering-passkey'
  | 'connecting-wallet'
  | 'building-userop'
  | 'awaiting-signature'
  | 'awaiting-receipt';

const PHASE_LABEL: Record<WorkingPhase, string> = {
  'registering-passkey': 'Registering passkey…',
  'connecting-wallet': 'Connecting wallet…',
  'building-userop': 'Building gasless deploy request…',
  'awaiting-signature': 'Awaiting signature…',
  'awaiting-receipt': 'Awaiting paymaster + chain confirmation…',
};

const PHASE_HINT: Record<WorkingPhase, string | undefined> = {
  'registering-passkey':
    'Your browser will prompt you with TouchID / FaceID / a security key. The credential never leaves your device.',
  'connecting-wallet':
    'MetaMask will pop up to approve the connection. The seat is bound to whichever EOA you connect.',
  'building-userop':
    'demo-a2a is composing the ERC-4337 user operation.',
  'awaiting-signature':
    'Sign the user-operation hash with whichever method you enrolled — passkey if both are present (gasless preferred).',
  'awaiting-receipt':
    'The smart-agent paymaster sponsors the gas. No ETH needed.',
};

export function Act1AlicePerson({
  seatId,
  onComplete,
}: {
  seatId: string;
  onComplete: () => void;
}) {
  const seat = orgConfig.seats.find((s) => s.id === seatId);
  if (!seat) {
    return (
      <section className="card">
        <h2>Unknown seat: {seatId}</h2>
        <a href="#/">← Back to seat picker</a>
      </section>
    );
  }
  return <Act1Body seat={seat} onComplete={onComplete} />;
}

function Act1Body({ seat, onComplete }: { seat: SeatDef; onComplete: () => void }) {
  const [authChoice, setAuthChoice] = useState<AuthChoice>('passkey');
  const [stage, setStage] = useState<ConnectionStage>('consent');
  const [workingPhase, setWorkingPhase] = useState<WorkingPhase>('registering-passkey');
  const [error, setError] = useState<string | null>(null);
  const [deployedAddress, setDeployedAddress] = useState<Address | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [psaName, setPsaName] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [predictedLabel, setPredictedLabel] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(true);

  const { address: walletAddress, isConnected, connector: activeConnector } = useAccount();
  const { connect, isPending: connectPending } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const connectors = useConnectors();

  // Detect "already used by another seat" — if a different seat is
  // already bound to the currently-connected EOA, the user almost
  // certainly meant to switch MetaMask accounts before claiming.
  const conflictingSeat = (() => {
    if (!walletAddress) return null;
    const all = loadSeats();
    for (const [seatId, claim] of Object.entries(all)) {
      if (seatId === seat.id) continue;
      const siwe = getSiweAuth(claim);
      if (siwe?.eoa.toLowerCase() === walletAddress.toLowerCase()) {
        return seatId;
      }
    }
    return null;
  })();

  const demoA2aReady = !!config.demoA2aUrl;
  const wrongChain = config.chainId !== undefined && config.chainId !== 84532;

  // Already-claimed short-circuit: passkey-only seats land here on
  // refresh and don't want to re-claim.
  const existingPasskey = getPasskeyForSeat(seat.id);
  const existingAccount = existingPasskey?.account;
  if (existingAccount && stage === 'consent' && dialogOpen) {
    // Render a "this seat already exists" card instead of the dialog;
    // mirrors the prior behaviour but without the side-effect useEffect.
    setDialogOpen(false);
  }

  const needsWallet = authChoice === 'siwe' || authChoice === 'both';
  const canStart =
    (!needsWallet || (isConnected && !!walletAddress)) && !conflictingSeat;

  /**
   * Re-open MetaMask's account picker so the visitor can switch to a
   * different EOA for this seat. wagmi's `useConnect` doesn't re-prompt
   * when the wallet is already connected, so we disconnect first then
   * call `wallet_requestPermissions` directly via the provider — MetaMask
   * always shows the picker for that method, regardless of cached
   * approvals.
   */
  const switchWalletAccount = async () => {
    try {
      // 1. Disconnect through wagmi so React state resets cleanly.
      if (isConnected) await disconnectAsync();
      // 2. Ask MetaMask to show its account picker. The injected
      //    connector exposes a provider via `getProvider()`.
      const injected = connectors.find((c) => c.id === 'injected') ?? connectors[0];
      if (!injected) return;
      const provider = (await injected.getProvider()) as
        | { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }
        | undefined;
      if (provider?.request) {
        try {
          await provider.request({
            method: 'wallet_requestPermissions',
            params: [{ eth_accounts: {} }],
          });
        } catch {
          // user dismissed; fine — we just won't connect this time
        }
      }
      // 3. Re-connect via wagmi so the new account flows back into useAccount.
      connect({ connector: injected });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const runCeremony = async () => {
    setStage('working');
    setError(null);

    // 1. Resolve / enroll passkey if the choice includes it. Per
    //    ADR-0010 + spec 220 we predict the SA's unique `.agent` name
    //    BEFORE the WebAuthn ceremony so the OS-level passkey label
    //    matches what NameDisplay will eventually show on chain
    //    (`alice` / `alice2` / `alice3` / … on demo.agent).
    let passkey: import('../../lib/passkey').DemoPasskey | undefined;
    if (authChoice !== 'siwe') {
      setWorkingPhase('registering-passkey');
      try {
        passkey = getPasskeyForSeat(seat.id) ?? undefined;
        if (!passkey) {
          const predicted = await predictUniqueAgentLabel(seat.id.toLowerCase());
          setPredictedLabel(predicted);
          const predictedAgentName = predicted
            ? `${predicted}.demo.agent`
            : undefined;
          const fresh = await registerPasskeyForSeat(
            seat.id,
            seat.name,
            predictedAgentName,
          );
          savePasskeyForSeat(seat.id, fresh);
          passkey = fresh;
        } else if (passkey.agentName) {
          // Pre-existing passkey with a stored agent name — surface it
          // so the success card can show "passkey enrolled as alice3"
          // without re-prediction.
          setPredictedLabel(passkey.agentName.replace(/\.demo\.agent$/, ''));
        }
      } catch (e) {
        setStage('error');
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }

    // 2. Resolve EOA if the choice includes it. Connection must already
    //    be active by now (consent gate enforces it).
    let eoa: Address | undefined;
    if (authChoice !== 'passkey') {
      if (!walletAddress) {
        setStage('error');
        setError('No wallet connected. Open MetaMask + connect, then re-try.');
        return;
      }
      eoa = walletAddress as Address;
    }

    setWorkingPhase('building-userop');
    await new Promise((r) => setTimeout(r, 30));
    setWorkingPhase('awaiting-signature');

    const result = await deployPersonAgent({
      passkey,
      custodians: eoa ? [eoa] : [],
    });
    setWorkingPhase('awaiting-receipt');
    if (!result.ok) {
      setStage('error');
      setError(result.reason || result.error);
      return;
    }

    // 3. Build the seat's authMethods.
    const authMethods: AuthMethod[] = [];
    if (passkey) {
      authMethods.push({
        kind: 'passkey',
        credentialIdDigest: passkey.credentialIdDigest,
        pubKeyX: passkey.pubKeyX,
        pubKeyY: passkey.pubKeyY,
        pia: passkeyIdentity(passkey.pubKeyX, passkey.pubKeyY),
      });
    }
    if (eoa) {
      authMethods.push({ kind: 'siwe', eoa });
    }
    claimSeat({
      seatId: seat.id,
      personAgent: result.deployedAddress,
      authMethods,
      claimedAt: new Date().toISOString(),
    });
    setActiveSeat(seat.id);

    setDeployedAddress(result.deployedAddress);
    setTxHash(result.transactionHash);
    setStage('success');

    // Best-effort: auto-claim <seatId>.demo.agent for this PSA and set
    // its primary name so NameDisplay everywhere immediately shows
    // the human-readable name. Two extra txs, both gasless via the
    // PSA's passkey path. Failures don't block success — the user
    // can still proceed; the error surfaces in the success card.
    if (passkey) {
      // Number-suffix uniqueness per spec 220 § 5: alice → alice2 → …
      // Names are facet registrations pointing at the canonical SA;
      // the human-readable label stays intact (no hex salt).
      void (async () => {
        const claim = await claimPsaName({
          baseLabel: seat.id.toLowerCase(),
          personAgent: result.deployedAddress,
          passkey,
        });
        if (claim.ok) {
          setPsaName(claim.name);
        } else {
          setNameError(claim.reason);
        }
      })();
    }
  };

  const handleAccept = () => {
    if (!demoA2aReady || wrongChain || !canStart) return;
    void runCeremony();
  };

  const handleDecline = () => {
    setDialogOpen(false);
    onComplete();
  };

  const handleRetry = () => {
    setStage('consent');
    setError(null);
  };

  // Pre-consent extra: method picker + (conditional) wallet connect.
  const methodPicker =
    stage === 'consent' ? (
      <div
        style={{
          marginBottom: 12,
          padding: '10px 14px',
          background: '#f7f7fa',
          borderRadius: 8,
          fontSize: '0.86rem',
        }}
      >
        <p style={{ marginTop: 0, marginBottom: 6, fontWeight: 600 }}>
          How does {seat.name} authenticate?
        </p>
        <label style={{ display: 'block', marginBottom: 4 }}>
          <input
            type="radio"
            name={`auth-${seat.id}`}
            checked={authChoice === 'passkey'}
            onChange={() => setAuthChoice('passkey')}
          />{' '}
          <strong>Passkey only</strong>{' '}
          <span className="muted small">(TouchID / FaceID / security key — gasless UX)</span>
        </label>
        <label style={{ display: 'block', marginBottom: 4 }}>
          <input
            type="radio"
            name={`auth-${seat.id}`}
            checked={authChoice === 'siwe'}
            onChange={() => setAuthChoice('siwe')}
          />{' '}
          <strong>Wallet (SIWE) only</strong>{' '}
          <span className="muted small">(connect MetaMask — every action prompts the wallet)</span>
        </label>
        <label style={{ display: 'block', marginBottom: 4 }}>
          <input
            type="radio"
            name={`auth-${seat.id}`}
            checked={authChoice === 'both'}
            onChange={() => setAuthChoice('both')}
          />{' '}
          <strong>Both passkey + wallet</strong>{' '}
          <span className="muted small">(registered as 2 custodians — most resilient)</span>
        </label>
        {needsWallet && (
          <div style={{ marginTop: 10 }}>
            {isConnected && walletAddress ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="muted small">
                    Wallet connected:
                  </span>
                  <code style={{ fontSize: '0.78rem' }}>{walletAddress}</code>
                  <span className="muted small">
                    {activeConnector?.name ? `via ${activeConnector.name}` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => void switchWalletAccount()}
                    style={{ padding: '2px 8px', fontSize: '0.78rem' }}
                    data-testid="act1-switch-wallet"
                  >
                    Use different account
                  </button>
                </div>
                {conflictingSeat && (
                  <p className="err" style={{ marginTop: 4, marginBottom: 0, fontSize: '0.8rem' }}>
                    This EOA is already bound to <strong>{conflictingSeat}</strong>\'s seat.
                    Click <em>Use different account</em> and pick a fresh MetaMask account
                    for {seat.name}, or your on-chain custody dedup will revert.
                  </p>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {connectors.length === 0 ? (
                  <span className="muted small">
                    No injected wallet detected — install MetaMask or another browser wallet.
                  </span>
                ) : (
                  connectors.map((c) => (
                    <button
                      key={c.uid}
                      type="button"
                      onClick={() => connect({ connector: c })}
                      disabled={connectPending}
                      data-testid={`act1-connect-${c.id}`}
                    >
                      Connect {c.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
    ) : null;

  return (
    <section>
      <div className="hero">
        <p className="eyebrow">
          Act 1 · Bootstrap · <LiveStatusBadge status="live" />
        </p>
        <h1>
          Claim the <strong>{seat.name}</strong> seat.
        </h1>
        <p>
          Register {seat.name}\'s human-signer authority (passkey, wallet, or both) and deploy
          their Person Smart Agent on Base Sepolia. The smart-agent paymaster sponsors the
          deploy — you don\'t need any ETH. Whichever methods are enrolled become custodians of
          the resulting Smart Agent.
        </p>
      </div>

      {!demoA2aReady && (
        <p className="err">
          <strong>VITE_DEMO_A2A_URL</strong> is not set in this build. Act 1 needs the
          demo-a2a relayer to sponsor the gasless userOp.
        </p>
      )}
      {wrongChain && (
        <p className="err">
          This demo targets <strong>Base Sepolia</strong>. Chain {config.chainId} is configured.
        </p>
      )}

      {!dialogOpen && (
        <section className="card">
          <p className="muted">
            This seat is already claimed. Use the <strong>Acting as ▾</strong> chip in the top
            bar to switch.
          </p>
          <button type="button" className="primary" onClick={onComplete}>
            ← Back to seat picker
          </button>
        </section>
      )}

      <ConnectionDialog
        open={dialogOpen}
        stage={stage}
        title={`Connect as ${seat.name}`}
        scopeList={[
          `Sign every action taken by ${seat.name}\'s Person Smart Agent on Base Sepolia.`,
          `Authorize gasless transactions via the paymaster on ${seat.name}\'s behalf.`,
          authChoice === 'siwe'
            ? 'Each admin action will prompt your wallet to sign the EIP-712 schedule/apply hash.'
            : authChoice === 'both'
              ? 'Either passkey or wallet can sign; passkey is preferred (gasless).'
              : 'The passkey signs every action on chain (no wallet popup).',
        ]}
        grantee={`${seat.name}\'s Person Smart Agent`}
        duration={
          authChoice === 'passkey'
            ? 'as long as the passkey exists on this device'
            : authChoice === 'siwe'
              ? 'as long as the wallet has the EOA\'s key'
              : 'as long as either method (passkey or wallet) is recoverable'
        }
        limits={[
          'Sign for the Organization or the Treasury — those have their own Smart Agents.',
          `Move ${orgConfig.name}\'s treasury funds directly — that requires stewardship from the Treasury (Acts 4–5).`,
        ]}
        revokeNote={`The Custody Council (Act 4) can rotate ${seat.name}\'s identities at any time. No recovery seed needed.`}
        onAccept={handleAccept}
        onDecline={handleDecline}
        acceptLabel={
          !canStart ? `Connect a wallet to continue` : 'Allow'
        }
        acceptDisabled={!canStart}
        preConsentSlot={methodPicker}
        phaseLabel={PHASE_LABEL[workingPhase]}
        phaseHint={PHASE_HINT[workingPhase]}
        successAddress={deployedAddress ?? undefined}
        successTxHash={txHash ?? undefined}
        successExtra={
          stage === 'success' && deployedAddress ? (
            <>
              <p className="muted">
                {seat.name}\'s Person Smart Agent is live on Base Sepolia. Custodians:
                {authChoice !== 'siwe' && ' passkey'}
                {authChoice === 'both' && ' +'}
                {authChoice !== 'passkey' && ' wallet'}.
              </p>
              {/*
                Canonical-identity callout — per ADR-0010 the SA address is
                the identity; the `.agent` name is a facet pointing at it.
                We surface both, side by side, in a small card so the user
                reads the doctrine off the screen.
              */}
              <div
                style={{
                  marginTop: 8,
                  padding: 10,
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  background: '#f9fafb',
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                <div>
                  <span style={{ color: '#6b7280' }}>Canonical Smart Agent:</span>{' '}
                  <code style={{ fontSize: 12 }}>{deployedAddress}</code>
                </div>
                <div style={{ marginTop: 4 }}>
                  <span style={{ color: '#6b7280' }}>Name (facet):</span>{' '}
                  {psaName ? (
                    <strong style={{ color: '#059669' }}>{psaName}</strong>
                  ) : nameError ? (
                    <span style={{ color: '#b45309' }}>
                      ⚠ auto-claim skipped — {nameError}
                    </span>
                  ) : (
                    <span style={{ color: '#9ca3af' }}>
                      claiming{predictedLabel
                        ? ` ${predictedLabel}.demo.agent`
                        : ''}…
                    </span>
                  )}
                </div>
                {predictedLabel && (
                  <div style={{ marginTop: 4, fontSize: 11, color: '#6b7280' }}>
                    Your passkey was enrolled as{' '}
                    <code>{predictedLabel}.demo.agent</code> so the OS
                    keychain entry matches.
                  </div>
                )}
              </div>
            </>
          ) : undefined
        }
        onContinue={() => {
          setDialogOpen(false);
          onComplete();
        }}
        errorMessage={error ?? undefined}
        onRetry={handleRetry}
        onCancel={() => {
          setDialogOpen(false);
          onComplete();
        }}
      />
    </section>
  );
}
