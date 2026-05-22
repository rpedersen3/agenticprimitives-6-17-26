/**
 * Act 2.5 — Create Acme Treasury (Service Smart Agent).
 *
 * Per spec 211 § 5 Act 2.5 + the 2026-05-22 mode-choice round:
 *   - Sender: the founder\'s Person Smart Agent (Alice\'s PSA).
 *     This is a transitional shape — Acme Construction\'s custodian set is
 *     just {Alice.PIA} at this point, so Alice\'s passkey can sign the
 *     required custody slot directly. Phase 6f.4 adds Bob\'s passkey and
 *     raises approvals required.
 *   - Calls factory.createAccountWithMode for the Treasury with:
 *       mode       = 1 (hybrid)        — Alice passkey identity as initial custodian
 *       custodians = [Alice.PIA]       — passkey-derived identity, not Org address
 *       trustees   = []                — added later by custody policy acts
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
import { loadActiveSeat, loadSeats, setActiveSeat } from '../../lib/seats';
import { loadOrg, loadTreasury, saveTreasury } from '../../lib/demo-state';
import { getPasskeyForSeat } from '../../lib/passkey';
import {
  executeCallFromAgent,
  encodeExecuteCall,
} from '../../lib/execute-call';
import { predictAccountAddress, waitForCode } from '../../lib/chain-reads';
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
  // Same Alice-is-founder discipline as Act 2 — keeps the Treasury\'s
  // "deployed by" attribution aligned with the founder narrative even
  // though the deployer doesn\'t enter the Treasury custodian set.
  const aliceSeat = orgConfig.seats[0]!;
  const founder = seats[aliceSeat.id] ?? null;
  const founderName = aliceSeat.name;
  const aliceIsActive = activeSeatId === aliceSeat.id;

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
    const passkey = getPasskeyForSeat(aliceSeat.id);
    if (!passkey) {
      setStage('error');
      setError(`${founderName}\'s passkey is missing. Try disconnecting + reclaiming the seat.`);
      return;
    }

    setStage('working');
    setError(null);
    setPhase('preflight');

    // Phase 6f.4 — Treasury custodians are PASSKEY-DIRECT, not the Org.
    // The "Treasury actedOnBehalfOf Org" relationship is now expressed
    // purely as a delegation/PROV-O attestation (issued in Act 5), not
    // by putting the Org in the Treasury's custodian set. Custody must
    // bottom out at human signers (spec 211 § 3 / spec 212 § 2.2).
    //
    // Pass an empty `custodians` array: Alice's passkey is registered
    // via the `initialPasskey*` path, which writes Alice's PIA into the
    // passkey-storage mapping. Including the PIA in `custodians` too
    // would double-count it; the contract reverts CustodianAlreadyExists.
    const alicePia = founder.personIdentity;
    const initParams = {
      mode: 1, // hybrid — same shape as Org; threshold bumps to 2 in Act 4
      custodians: [] as Address[],
      trustees: [] as Address[],
      initialPasskeyCredentialIdDigest: passkey.credentialIdDigest,
      initialPasskeyX: passkey.pubKeyX,
      initialPasskeyY: passkey.pubKeyY,
    } as const;

    // Salt includes the Org address so a Treasury deployed for a
    // different Org never collides at the same CREATE2 slot.
    const SALT_VERSION = 'v6-dedup-pia';
    const salt = BigInt(
      '0x' +
        [...new TextEncoder().encode(`${TREASURY_NAME}:${org.address}:${alicePia}:${SALT_VERSION}`)]
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
          .slice(0, 16),
    );

    // 1-second T4 safety delay — same demo override as Act 2.
    const factoryCallData = encodeFunctionData({
      abi: agentAccountFactoryAbi,
      functionName: 'createMultiSigSmartAgent',
      args: [initParams, custodyPolicyAddress, 1, salt],
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
    const deployed = await waitForCode(treasuryAddress);
    if (!deployed) {
      setStage('error');
      setError(
        `The submit tx succeeded (${result.transactionHash}) but the Treasury address ` +
          `${treasuryAddress} still has no code after polling. Refresh the page.`,
      );
      setTxHash(result.transactionHash);
      saveTreasury({
        address: treasuryAddress,
        txHash: result.transactionHash,
        mode: 1,
        custodians: [alicePia],
        createdAt: new Date().toISOString(),
      });
      return;
    }

    saveTreasury({
      address: treasuryAddress,
      txHash: result.transactionHash,
      mode: 1,
      custodians: [alicePia],
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
        <p>The Treasury is authorized by {orgConfig.name}. Run Act 2 before Act 2.5.</p>
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

  const unclaimedSeats = orgConfig.seats.filter((s) => !seats[s.id]);
  if (unclaimedSeats.length > 0) {
    return (
      <section className="card">
        <p className="eyebrow">Act 2.5 · Admin</p>
        <h1>Claim every seat first.</h1>
        <p>
          Treasury deploys only when both admin seats are on board. Still open:{' '}
          <strong>{unclaimedSeats.map((s) => s.name).join(', ')}</strong>.
        </p>
        <a href="#/" className="primary">← Back to seat picker</a>
      </section>
    );
  }

  if (!aliceIsActive) {
    return (
      <section>
        <div className="hero">
          <p className="eyebrow">Act 2.5 · Admin · <LiveStatusBadge status="live" /></p>
          <h1>Switch to {founderName} to deploy the Treasury.</h1>
          <p>
            The Treasury is authorized by {orgConfig.name}, but custody still bottoms out at
            passkey identities. Right now only {founderName}'s passkey identity is available.
          </p>
        </div>
        <section className="card">
          <button
            type="button"
            className="primary"
            onClick={() => setActiveSeat(aliceSeat.id)}
            data-testid="act2_5-switch-to-alice"
          >
            Act as {founderName} →
          </button>
        </section>
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
          `Set ${founderName}'s passkey identity as the initial Treasury custodian.`,
          `Establish the prov:actedOnBehalfOf link from the Treasury to ${orgConfig.name} in the audit trail.`,
        ]}
        grantee={`${TREASURY_NAME} (Service Smart Agent)`}
        duration="permanent on-chain identity, authorized by the Org"
        limits={[
          'Put any Smart Agent address in the Treasury custodian set — custody bottoms out at passkey identities.',
          `Issue payments yet — Acts 4 and 5 set up the stewardship pattern that lets Person Agents draft payments under caveats.`,
          `Treat ${orgConfig.name} as the literal custodian — the Org→Treasury relationship is stewardship/provenance, not custody.`,
        ]}
        revokeNote={`Act 4 adds Bob's passkey identity to Treasury custody and raises approvals required where needed.`}
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
                {TREASURY_NAME} is live on Base Sepolia. It is authorized by {orgConfig.name}
                in the product model and initially custodied by {founderName}'s passkey identity.
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
