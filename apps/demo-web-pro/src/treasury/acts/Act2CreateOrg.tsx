/**
 * Act 2 — Create Acme Construction (Org Smart Agent).
 *
 * Flow (per spec 211 § 5 Act 2 + 2026-05-22 mode-choice round):
 *   - Sender: the founding seat\'s Person Smart Agent (Alice\'s PSA).
 *   - Calls factory.createAccountWithMode with:
 *       mode      = 1 (hybrid)         — sole-custodian shape
 *       custodians = [Alice.PSA]       — Alice\'s Person Smart Agent
 *       trustees   = []                — added in Act 4 with mode upgrade
 *   - Paymaster sponsors gas via demo-a2a\'s /account/build-call-userop.
 *   - Alice\'s passkey signs the userOpHash (verified inside Alice.PSA
 *     via _verifyWebAuthn).
 *   - On success, the deployed Org address is saved in demo-state.
 *
 * Mode = hybrid (not org) on purpose — the spec\'s "approvalsRequired = 1
 * (sole-member org)" wording maps to hybrid in the on-chain factory.
 * Act 4 promotes the mode + adds trustees once Bob joins.
 */

import { useEffect, useState } from 'react';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import { agentAccountFactoryAbi } from '@agenticprimitives/agent-account';
import { orgConfig } from '../../org-config';
import { loadSeats, loadActiveSeat, setActiveSeat } from '../../lib/seats';
import { loadOrg, saveOrg } from '../../lib/demo-state';
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

type WorkingPhase = 'preflight' | 'building-userop' | 'signing' | 'awaiting-receipt';

const PHASE_LABEL: Record<WorkingPhase, string> = {
  'preflight': 'Computing counterfactual Org address…',
  'building-userop': 'Building gasless deploy request…',
  'signing': 'Confirming with your passkey…',
  'awaiting-receipt': 'Awaiting paymaster + chain confirmation…',
};

const PHASE_HINT: Record<WorkingPhase, string | undefined> = {
  'preflight': 'The factory deterministically computes Acme Construction\'s on-chain address before any tx is sent.',
  'building-userop': 'demo-a2a composes the ERC-4337 user operation that Alice\'s Person Smart Agent will dispatch.',
  'signing': 'Your passkey authorizes Alice\'s Person Smart Agent to create the Org. Same passkey, second use.',
  'awaiting-receipt': 'The smart-agent paymaster sponsors the gas. No ETH needed.',
};

export function Act2CreateOrg({ onComplete }: { onComplete: () => void }) {
  const [stage, setStage] = useState<ConnectionStage>('consent');
  const [phase, setPhase] = useState<WorkingPhase>('preflight');
  const [error, setError] = useState<string | null>(null);
  const [predictedAddress, setPredictedAddress] = useState<Address | null>(null);
  const [deployedAddress, setDeployedAddress] = useState<Address | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [dialogOpen, setDialogOpen] = useState(true);

  // Spec 211 § 5 Act 2: Alice is the founder. The "Acting as" chip
  // doesn\'t matter here — the Org\'s initial custodian is always
  // Alice\'s PSA. Acts 4+ are where Bob participates in admin actions.
  const seats = loadSeats();
  const aliceSeat = orgConfig.seats[0]!;
  const founder = seats[aliceSeat.id] ?? null;
  const founderName = aliceSeat.name;
  const activeSeatId = loadActiveSeat();
  const aliceIsActive = activeSeatId === aliceSeat.id;

  const factoryAddress = config.factoryAddress;
  const custodyPolicyAddress = config.custodyPolicy;
  const demoA2aReady = !!config.demoA2aUrl;

  // If Org already exists in local state, short-circuit the dialog.
  // No silent recovery via on-chain probe — that proved more confusing
  // than helpful when a stale Org sat at a predictable address. If
  // demo-state is empty, deploy fresh.
  useEffect(() => {
    if (loadOrg()) setDialogOpen(false);
  }, []);

  const runCeremony = async () => {
    if (!founder || !factoryAddress || !custodyPolicyAddress) {
      setStage('error');
      setError('Preconditions missing — need an active seat claim + factory address + custody policy address.');
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

    // Compose AgentAccountInitParams for the Org.
    const initParams = {
      mode: 1, // hybrid
      custodians: [founder.personAgent],
      trustees: [] as Address[],
      initialPasskeyCredentialIdDigest: ('0x' + '00'.repeat(32)) as Hex,
      initialPasskeyX: 0n,
      initialPasskeyY: 0n,
    } as const;

    // Salt derived from (org name, founder PSA, version tag). The
    // version tag bumps whenever the deploy parameters change in a
    // way that\'s NOT visible in the CREATE2 inputs — most notably,
    // the safety-delay value, which changes config state after the
    // proxy is created (via the CustodyPolicy.onInstall payload) but
    // doesn\'t affect the predicted address. Bumping the tag forces
    // a fresh address so visitors don\'t inherit a stale on-chain
    // Org that was deployed before today\'s 0s-safety-delay fix.
    const SALT_VERSION = 'v4-fresh'; // bump on every breaking deploy-param change
    const salt = BigInt(
      '0x' +
        [...new TextEncoder().encode(`${orgConfig.name}:${founder.personAgent}:${SALT_VERSION}`)]
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
          .slice(0, 16),
    );

    // Encode factory.createAccountWithModeCustomSafetyDelay with a 1-second
    // T4 safety delay. KNOWN CONTRACT QUIRK: the factory treats
    // safetyDelaySeconds==0 as "use spec default (1 hour)" — there's no
    // way to pass literal zero through the current factory ABI. Passing
    // 1 second is the smallest legal value; Base Sepolia mines blocks
    // every ~2s, so by the time Act 3's apply userOp lands the eta is
    // already past. Production must NEVER use this; spec default is 1h.
    //
    // TODO: fix factory to use type(uint32).max as the default sentinel
    // so literal 0 can be passed through. Requires factory redeploy.
    const factoryCallData = encodeFunctionData({
      abi: agentAccountFactoryAbi,
      functionName: 'createAccountWithModeCustomSafetyDelay',
      args: [initParams, custodyPolicyAddress, 1, salt],
    });

    // Wrap as Alice.PSA.execute(factory, 0, factoryCallData).
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

    // CREATE2-deterministic — predicted address IS the deployed address.
    // Verify code is in place so we don\'t falsely report success.
    const orgAddress = await predictAccountAddress({
      factoryAddress,
      initParams,
      salt,
    });
    const deployed = await waitForCode(orgAddress);
    if (!deployed) {
      setStage('error');
      setError(
        `The submit tx succeeded (${result.transactionHash}) but the Org address ` +
          `${orgAddress} still has no code after polling. Refresh the page — the demo ` +
          'will detect the deployed Org on next render.',
      );
      setTxHash(result.transactionHash);
      // Save anyway — the deploy succeeded; the local record lets the
      // visitor recover by refreshing instead of redoing the act.
      saveOrg({
        address: orgAddress,
        txHash: result.transactionHash,
        mode: 1,
        custodians: [founder.personAgent],
        createdAt: new Date().toISOString(),
      });
      return;
    }

    saveOrg({
      address: orgAddress,
      txHash: result.transactionHash,
      mode: 1,
      custodians: [founder.personAgent],
      createdAt: new Date().toISOString(),
    });

    setDeployedAddress(orgAddress);
    setPredictedAddress(orgAddress);
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

  // ─── Render ──────────────────────────────────────────────────────────

  if (!founder) {
    return (
      <section className="card">
        <p className="eyebrow">Act 2 · Bootstrap</p>
        <h1>{founderName} hasn\'t claimed a seat yet.</h1>
        <p>Per spec 211, {founderName} is the founder. Claim her seat in Act 1 first.</p>
        <a href="#/">← Back to seat picker</a>
      </section>
    );
  }

  // Spec 211 § 4: require ALL seats claimed before deploying the Org.
  const unclaimedSeats = orgConfig.seats.filter((s) => !seats[s.id]);
  if (unclaimedSeats.length > 0) {
    return (
      <section className="card">
        <p className="eyebrow">Act 2 · Bootstrap</p>
        <h1>Claim every seat first.</h1>
        <p>
          {orgConfig.name} doesn\'t boot until both admins have Person Smart Agents on chain.
          Still open: <strong>{unclaimedSeats.map((s) => s.name).join(', ')}</strong>.
        </p>
        <a href="#/" className="primary">← Back to seat picker</a>
      </section>
    );
  }

  // Spec 211 § 5: Alice is the founder. If the active actor is Bob,
  // surface a switch CTA so the userOp gets dispatched from Alice\'s
  // PSA. This is enforced server-side too — the userOp\'s sender is
  // Alice.PSA — but failing fast in the UI avoids a confusing on-chain
  // revert.
  if (!aliceIsActive) {
    return (
      <section>
        <div className="hero">
          <p className="eyebrow">Act 2 · Bootstrap · <LiveStatusBadge status="live" /></p>
          <h1>Switch to {founderName} to create the Org.</h1>
          <p>
            Per spec 211 § 5, {founderName} is the founder of {orgConfig.name}. Her
            Person Smart Agent dispatches the deploy and becomes the Org\'s initial
            custodian.
          </p>
        </div>
        <section className="card">
          <button
            type="button"
            className="primary"
            onClick={() => setActiveSeat(aliceSeat.id)}
            data-testid="act2-switch-to-alice"
          >
            Act as {founderName} →
          </button>
          <p className="muted small">
            (Or use the <strong>Acting as ▾</strong> chip in the top bar.)
          </p>
        </section>
      </section>
    );
  }

  const existing = loadOrg();

  return (
    <section>
      <div className="hero">
        <p className="eyebrow">
          Act 2 · Bootstrap · <LiveStatusBadge status="live" />
        </p>
        <h1>
          Create <strong>{orgConfig.name}</strong>.
        </h1>
        <p>
          {founderName}\'s Person Smart Agent will deploy an on-chain Smart Agent for{' '}
          <strong>{orgConfig.name}</strong>. The Org is its own identity — separate from{' '}
          {founderName} — but {founderName}\'s Person Smart Agent is its sole custodian
          until Bob joins (Act 3).
        </p>
      </div>

      {existing && !dialogOpen && (
        <section className="card">
          <p className="eyebrow">{orgConfig.name} · live</p>
          <h2>Already deployed.</h2>
          <dl className="kv">
            <dt>Address</dt>
            <dd><code>{shortAddress(existing.address)}</code></dd>
            <dt>Deploy tx</dt>
            <dd><code>{shortAddress(existing.txHash)}</code></dd>
            <dt>Mode</dt>
            <dd>hybrid · approvalsRequired=1</dd>
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
        title={`Create ${orgConfig.name}`}
        scopeList={[
          `Deploy a new AgentAccount on Base Sepolia named "${orgConfig.name}".`,
          `Install the CustodyPolicy module so the Org can schedule custody changes (Acts 3, 4).`,
          `Make ${founderName}\'s Person Smart Agent the sole admin (approvalsRequired=1).`,
        ]}
        grantee={`${orgConfig.name} (a new Smart Agent)`}
        duration="permanent on-chain identity"
        limits={[
          'Move funds yet — the Treasury is created in Act 2.5 and holds them.',
          `Be controlled by anyone other than ${founderName} yet — Bob joins as a co-admin in Act 3, approvals required becomes 2 in Act 4.`,
          'Be deleted — like all smart accounts, the address is permanent.',
        ]}
        revokeNote={`In Act 4 the Custody Council (Alice + Bob, 2-of-2) will be able to rotate ${orgConfig.name}\'s custodians via scheduleCustodyChange.`}
        onAccept={handleAccept}
        onDecline={handleDecline}
        phaseLabel={PHASE_LABEL[phase]}
        phaseHint={PHASE_HINT[phase]}
        successAddress={deployedAddress ?? undefined}
        successTxHash={txHash ?? undefined}
        successExtra={
          stage === 'success' && deployedAddress ? (
            <p className="muted">
              {orgConfig.name} is live on Base Sepolia. {founderName}\'s Person Smart Agent
              is its sole admin until Bob joins.
            </p>
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

      {/* Counterfactual preview (visible when ConnectionDialog is closed). */}
      {!dialogOpen && !existing && predictedAddress && (
        <section className="card muted">
          <p className="eyebrow">Counterfactual</p>
          <p>
            Predicted Org address: <code>{shortAddress(predictedAddress)}</code>
          </p>
        </section>
      )}
    </section>
  );
}
