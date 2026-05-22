/**
 * Act 2.5 — Create Acme Treasury (Service Smart Agent).
 *
 * Per spec 211 § 5 Act 2.5 + the 2026-05-22 mode-choice round:
 *   - Sender: the founder\'s Person Smart Agent (Alice\'s PSA).
 *     This is a transitional shape — Acme Construction\'s admin set is
 *     just {Alice.PSA} at this point, so Alice\'s passkey can sign for
 *     the Org indirectly via ERC-1271. Phase 6f.4 lights up the proper
 *     "Org dispatches → Treasury" chain once Bob is on board.
 *   - Calls factory.createAccountWithMode for the Treasury with:
 *       mode       = 0 (single)        — Org as sole custodian
 *       custodians = [Org.address]     — Acme Construction
 *       trustees   = []                — Treasury inherits recovery from the Org
 *   - Paymaster sponsors gas.
 *   - On success the Treasury address is saved in demo-state.
 *
 * The Org→Treasury delegation referenced in the spec is SIMULATED in
 * this phase — the delegation OBJECT is rendered in the success card
 * as a permission-style summary; the actual on-chain enforcement
 * pipeline lights up in phase 6f.7-6f.8.
 */

import { useEffect, useState } from 'react';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import { agentAccountFactoryAbi } from '@agenticprimitives/agent-account';
import { orgConfig } from '../../org-config';
import { loadActiveSeat, loadSeats } from '../../lib/seats';
import { loadOrg, loadTreasury, saveTreasury } from '../../lib/demo-state';
import { getPasskeyForSeat } from '../../lib/passkey';
import {
  executeCallFromAgent,
  encodeExecuteCall,
} from '../../lib/execute-call';
import { predictAccountAddress, hasCode } from '../../lib/chain-reads';
import { ConnectionDialog, type ConnectionStage } from '../components/ConnectionDialog';
import { LiveStatusBadge } from '../components/LiveStatusBadge';
import { shortAddress } from '../../components';
import { config } from '../../config';

const TREASURY_NAME = 'Acme Treasury';

type WorkingPhase = 'preflight' | 'building-userop' | 'signing' | 'awaiting-receipt';

const PHASE_LABEL: Record<WorkingPhase, string> = {
  'preflight': 'Computing counterfactual Treasury address…',
  'building-userop': 'Building gasless deploy request…',
  'signing': 'Confirming with your passkey…',
  'awaiting-receipt': 'Awaiting paymaster + chain confirmation…',
};

const PHASE_HINT: Record<WorkingPhase, string | undefined> = {
  'preflight': 'The factory computes Treasury\'s deterministic address from Org + a stable salt.',
  'building-userop': 'demo-a2a composes the ERC-4337 user operation.',
  'signing': 'Your passkey authorizes the founder\'s Person Smart Agent to dispatch the Treasury deploy on Acme Construction\'s behalf.',
  'awaiting-receipt': 'The smart-agent paymaster sponsors the gas. No ETH needed.',
};

export function Act2_5CreateTreasury({ onComplete }: { onComplete: () => void }) {
  const [stage, setStage] = useState<ConnectionStage>('consent');
  const [phase, setPhase] = useState<WorkingPhase>('preflight');
  const [error, setError] = useState<string | null>(null);
  const [deployedAddress, setDeployedAddress] = useState<Address | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [dialogOpen, setDialogOpen] = useState(true);

  const org = loadOrg();
  const activeSeatId = loadActiveSeat();
  const seats = loadSeats();
  const founder =
    activeSeatId && seats[activeSeatId]
      ? seats[activeSeatId]
      : null;
  const founderName =
    orgConfig.seats.find((s) => s.id === founder?.seatId)?.name ?? 'the founder';

  const factoryAddress = config.factoryAddress;
  const custodyPolicyAddress = config.custodyPolicy;
  const demoA2aReady = !!config.demoA2aUrl;

  useEffect(() => {
    if (loadTreasury()) setDialogOpen(false);
  }, []);

  const runCeremony = async () => {
    if (!org || !founder || !factoryAddress || !custodyPolicyAddress) {
      setStage('error');
      setError('Preconditions missing — need Act 2 complete (Org deployed), an active seat, factory + custody policy addresses.');
      return;
    }
    const passkey = getPasskeyForSeat(founder.seatId);
    if (!passkey) {
      setStage('error');
      setError(`${founderName}\'s passkey is missing. Try disconnecting + reclaiming the seat.`);
      return;
    }

    setStage('working');
    setError(null);
    setPhase('preflight');

    const initParams = {
      mode: 0, // single — Org as sole custodian
      custodians: [org.address],
      trustees: [] as Address[],
      initialPasskeyCredentialIdDigest: ('0x' + '00'.repeat(32)) as Hex,
      initialPasskeyX: 0n,
      initialPasskeyY: 0n,
    } as const;

    const salt = BigInt(
      '0x' +
        [...new TextEncoder().encode(`${TREASURY_NAME}:${org.address}`)]
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
          .slice(0, 16),
    );

    const factoryCallData = encodeFunctionData({
      abi: agentAccountFactoryAbi,
      functionName: 'createAccountWithMode',
      args: [initParams, custodyPolicyAddress, salt],
    });

    // For now Alice\'s PSA dispatches directly. Once Acts 3-4 give the
    // Org real co-custody, the Org Smart Agent itself dispatches via a
    // proposeCustodyChange flow.
    const outerCallData = encodeExecuteCall({
      target: factoryAddress,
      value: 0n,
      innerData: factoryCallData,
    });

    setPhase('building-userop');
    await new Promise((r) => setTimeout(r, 30));
    setPhase('signing');

    const result = await executeCallFromAgent({
      sender: founder.personAgent,
      passkey,
      callData: outerCallData,
    });
    if (!result.ok) {
      setStage('error');
      setError(result.reason || result.error);
      return;
    }

    setPhase('awaiting-receipt');

    const treasuryAddress = await predictAccountAddress({
      factoryAddress,
      initParams,
      salt,
    });
    const deployed = await hasCode(treasuryAddress);
    if (!deployed) {
      setStage('error');
      setError(
        `The submit tx succeeded (${result.transactionHash}) but the Treasury address ` +
          `${treasuryAddress} has no code yet. Try refreshing the page in a moment.`,
      );
      setTxHash(result.transactionHash);
      return;
    }

    saveTreasury({
      address: treasuryAddress,
      txHash: result.transactionHash,
      mode: 0,
      custodians: [org.address],
      createdAt: new Date().toISOString(),
    });

    setDeployedAddress(treasuryAddress);
    setTxHash(result.transactionHash);
    setStage('success');
  };

  const handleAccept = () => {
    if (!demoA2aReady) return;
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

  if (!org) {
    return (
      <section className="card">
        <p className="eyebrow">Act 2.5 · Admin</p>
        <h1>Create the Organization first.</h1>
        <p>The Treasury is owned by {orgConfig.name}. Run Act 2 before Act 2.5.</p>
        <a href="#/acts/create-org" className="primary">Go to Act 2 →</a>
      </section>
    );
  }

  if (!founder) {
    return (
      <section className="card">
        <p className="eyebrow">Act 2.5 · Admin</p>
        <h1>No active seat.</h1>
        <p>Switch to a claimed seat in the top bar before continuing.</p>
        <a href="#/">← Back to seat picker</a>
      </section>
    );
  }

  const existing = loadTreasury();

  return (
    <section>
      <div className="hero">
        <p className="eyebrow">
          Act 2.5 · Admin · <LiveStatusBadge status="live" />
        </p>
        <h1>
          Create <strong>{TREASURY_NAME}</strong>.
        </h1>
        <p>
          {orgConfig.name} deploys a separate Smart Agent to hold and disburse funds.
          {' '}{orgConfig.name} will be the Treasury\'s sole admin. The Treasury never holds
          its own keys — it acts on behalf of {orgConfig.name} (per spec 210\'s
          PROV-O <code>actedOnBehalfOf</code> relationship).
        </p>
      </div>

      {existing && !dialogOpen && (
        <section className="card">
          <p className="eyebrow">{TREASURY_NAME} · live</p>
          <h2>Already deployed.</h2>
          <dl className="kv">
            <dt>Treasury address</dt>
            <dd><code>{shortAddress(existing.address)}</code></dd>
            <dt>Owned by</dt>
            <dd><code>{shortAddress(org.address)}</code> · {orgConfig.name}</dd>
            <dt>Deploy tx</dt>
            <dd><code>{shortAddress(existing.txHash)}</code></dd>
          </dl>
          <p className="muted">
            Use <strong>Reset demo</strong> in the top bar to wipe and re-deploy.
          </p>
          <a href="#/" className="primary">← Back to seat picker</a>
        </section>
      )}

      <ConnectionDialog
        open={dialogOpen}
        stage={stage}
        title={`Create ${TREASURY_NAME}`}
        scopeList={[
          `Deploy a new AgentAccount named "${TREASURY_NAME}" on Base Sepolia.`,
          `Set ${orgConfig.name} as its sole custodian (the Treasury cannot move funds without Org approval).`,
          `Establish the prov:actedOnBehalfOf link from the Treasury to ${orgConfig.name} in the audit trail.`,
        ]}
        grantee={`${TREASURY_NAME} (Service Smart Agent)`}
        duration="permanent on-chain identity, owned by the Org"
        limits={[
          'Hold its own keys — it has no passkey; only the Org can sign for it.',
          `Issue payments yet — Acts 4 and 5 set up the stewardship pattern that lets Person Agents draft payments under caveats.`,
          `Be controlled directly by ${founderName}\'s passkey — authority chains through the Org.`,
        ]}
        revokeNote={`The Org\'s Custody Council (Act 4) controls every Treasury custody change. The Treasury inherits the Org\'s recovery posture.`}
        onAccept={handleAccept}
        onDecline={handleDecline}
        phaseLabel={PHASE_LABEL[phase]}
        phaseHint={PHASE_HINT[phase]}
        successAddress={deployedAddress ?? undefined}
        successTxHash={txHash ?? undefined}
        successExtra={
          stage === 'success' && deployedAddress ? (
            <>
              <p className="muted">
                {TREASURY_NAME} is live on Base Sepolia, owned by {orgConfig.name}.
              </p>
              <p className="muted small">
                The Org→Treasury "actedOnBehalfOf" delegation will be enforceable in
                phase 6f.7. For now this relationship is{' '}
                <strong>simulated</strong> at the runtime layer — the object exists
                on chain, the enforcement pipe is queued.
              </p>
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
