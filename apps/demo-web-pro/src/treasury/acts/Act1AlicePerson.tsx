/**
 * Act 1 — Create a Person Smart Agent for a seat (spec 211 § 5 / 6f.1).
 *
 * Flow:
 *   1. Register passkey for the seat (TouchID / FaceID / security key).
 *   2. Call demo-a2a /a2a/session/deploy with initMethod='passkey'.
 *   3. Sign userOpHash with the freshly-registered passkey.
 *   4. demo-a2a submits the signed userOp via paymaster.
 *   5. Record the deployed Person Smart Agent in seats.ts.
 *
 * The act is routed by seat (each open seat triggers its own Act 1).
 * After completion, the visitor lands back at the seat picker with
 * one seat now showing ✓ claimed.
 */

import { useState } from 'react';
import { orgConfig, type SeatDef } from '../../org-config';
import {
  registerPasskeyForSeat,
  savePasskeyForSeat,
  getPasskeyForSeat,
} from '../../lib/passkey';
import { claimSeat, setActiveSeat } from '../../lib/seats';
import { deployPersonAgent } from '../../lib/deploy-person';
import { LiveStatusBadge } from '../components/LiveStatusBadge';
import { shortAddress } from '../../components';
import { config } from '../../config';

type Phase = 'idle' | 'registering' | 'deploying' | 'done' | 'error';

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
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [deployedAddress, setDeployedAddress] = useState<`0x${string}` | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const demoA2aReady = !!config.demoA2aUrl;
  const wrongChain = config.chainId !== undefined && config.chainId !== 84532;

  const handleStart = async () => {
    setError(null);

    // Re-use existing passkey if the visitor cancelled mid-flow and
    // came back. Saves them a repeat ceremony.
    let passkey = getPasskeyForSeat(seat.id);
    if (!passkey) {
      setPhase('registering');
      try {
        passkey = await registerPasskeyForSeat(seat.id, seat.name);
        savePasskeyForSeat(seat.id, passkey);
      } catch (e) {
        setPhase('error');
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }

    setPhase('deploying');
    const result = await deployPersonAgent(passkey);
    if (!result.ok) {
      setPhase('error');
      setError(result.reason || result.error);
      return;
    }

    claimSeat({
      seatId: seat.id,
      personAgent: result.deployedAddress,
      credentialIdDigest: passkey.credentialIdDigest,
      claimedAt: new Date().toISOString(),
    });
    setActiveSeat(seat.id);

    setDeployedAddress(result.deployedAddress);
    setTxHash(result.transactionHash);
    setPhase('done');
  };

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
          Register a passkey for {seat.name} and deploy {seat.name}\'s Person Smart Agent on
          Base Sepolia. The smart-agent paymaster sponsors the deploy — you don\'t need any
          ETH. Once deployed, {seat.name}\'s passkey is the only thing that can sign for
          {seat.name}\'s Person Smart Agent.
        </p>
      </div>

      {!demoA2aReady && (
        <p className="err" data-testid="act1-no-a2a">
          <strong>VITE_DEMO_A2A_URL</strong> is not set in this build. Act 1 needs the
          demo-a2a relayer to sponsor the gasless userOp.
        </p>
      )}

      {wrongChain && (
        <p className="err" data-testid="act1-wrong-chain">
          This demo targets <strong>Base Sepolia</strong>. Chain {config.chainId} is configured.
        </p>
      )}

      <section className="split">
        <section className="card">
          <p className="eyebrow">Step 1 · Passkey</p>
          <h2>Register {seat.name}\'s passkey</h2>
          <p>
            Your browser will prompt you with TouchID / FaceID / a security key. The credential
            never leaves your device — only the P-256 public key (x, y) goes on chain.
          </p>
        </section>

        <section className="card">
          <p className="eyebrow">Step 2 · Deploy</p>
          <h2>Counterfactual address → live</h2>
          <p>
            The factory deploys an <code>AgentAccount</code> proxy and initializes it with
            {' '}<code>{seat.name}\'s</code> passkey credential as the root signer.
          </p>
        </section>
      </section>

      <section className="card">
        {phase === 'idle' && (
          <button
            type="button"
            className="primary"
            onClick={handleStart}
            disabled={!demoA2aReady}
            data-testid="act1-start"
          >
            Begin Act 1 — register {seat.name}\'s passkey
          </button>
        )}
        {phase === 'registering' && (
          <p className="muted" data-testid="act1-registering">
            Waiting for {seat.name}\'s passkey ceremony… (TouchID / FaceID prompt)
          </p>
        )}
        {phase === 'deploying' && (
          <p className="muted" data-testid="act1-deploying">
            Deploying {seat.name}\'s Person Smart Agent via the paymaster… one moment.
          </p>
        )}
        {phase === 'done' && deployedAddress && (
          <div data-testid="act1-done">
            <p>
              <strong>✓ {seat.name}\'s Person Smart Agent is live.</strong>
            </p>
            <dl className="kv">
              <dt>Address</dt>
              <dd>
                <code>{shortAddress(deployedAddress)}</code>
              </dd>
              {txHash && (
                <>
                  <dt>Deploy tx</dt>
                  <dd>
                    <code>{shortAddress(txHash)}</code>
                  </dd>
                </>
              )}
            </dl>
            <button type="button" className="primary" onClick={onComplete} data-testid="act1-continue">
              Continue
            </button>
          </div>
        )}
        {phase === 'error' && (
          <p className="err" data-testid="act1-error">
            <strong>Couldn\'t complete Act 1.</strong> {error ?? 'Unknown error.'}{' '}
            <button
              type="button"
              onClick={() => {
                setPhase('idle');
                setError(null);
              }}
            >
              Try again
            </button>
          </p>
        )}
      </section>
    </section>
  );
}
