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
import { loadSeats, loadActiveSeat } from '../../lib/seats';
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

  // The "founder" is whoever holds the active seat. In a fresh demo
  // it\'s the first seat-claimer (Alice).
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

  // If Org already exists, short-circuit. Routing back to seat picker
  // is the caller\'s job via onComplete.
  useEffect(() => {
    if (loadOrg()) { setDialogOpen(false); return; }
    // Recovery: if the visitor cancelled mid-flow (e.g. closed tab
    // before the propagation poll finished but AFTER the chain
    // confirmed), the Org is on chain but not in demo-state. Detect
    // by predicting the address with the SAME init params + salt; if
    // it has code, register it locally and skip the dialog.
    const recover = async () => {
      if (!founder || !factoryAddress) return;
      const initParams = {
        mode: 1,
        custodians: [founder.personAgent],
        trustees: [] as `0x${string}`[],
        initialPasskeyCredentialIdDigest: ('0x' + '00'.repeat(32)) as `0x${string}`,
        initialPasskeyX: 0n,
        initialPasskeyY: 0n,
      } as const;
      const salt = BigInt(
        '0x' +
          [...new TextEncoder().encode(`${orgConfig.name}:${founder.personAgent}`)]
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('')
            .slice(0, 16),
      );
      try {
        const predicted = await predictAccountAddress({
          factoryAddress,
          initParams,
          salt,
        });
        const { hasCode: probe } = await import('../../lib/chain-reads');
        if (await probe(predicted)) {
          saveOrg({
            address: predicted,
            txHash: ('0x' + '00'.repeat(32)) as `0x${string}`,
            mode: 1,
            custodians: [founder.personAgent],
            createdAt: new Date().toISOString(),
          });
          setDialogOpen(false);
        }
      } catch {
        // Ignore probe failures; the visitor can still run Act 2 fresh.
      }
    };
    void recover();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runCeremony = async () => {
    if (!founder || !factoryAddress || !custodyPolicyAddress) {
      setStage('error');
      setError('Preconditions missing — need an active seat claim + factory address + custody policy address.');
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

    // Compose AgentAccountInitParams for the Org.
    const initParams = {
      mode: 1, // hybrid
      custodians: [founder.personAgent],
      trustees: [] as Address[],
      initialPasskeyCredentialIdDigest: ('0x' + '00'.repeat(32)) as Hex,
      initialPasskeyX: 0n,
      initialPasskeyY: 0n,
    } as const;

    // Salt derived from a stable demo seed; lets the visitor re-claim
    // the same Org address across resets if they want.
    const salt = BigInt(
      '0x' +
        [...new TextEncoder().encode(`${orgConfig.name}:${founder.personAgent}`)]
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
          .slice(0, 16),
    );

    // Encode factory.createAccountWithModeCustomSafetyDelay with 0-second
    // T4 safety delay so subsequent custody changes (Act 3+) can
    // schedule+apply in the same demo session without a real wait.
    // Production should NEVER do this; the spec default is 1h.
    const factoryCallData = encodeFunctionData({
      abi: agentAccountFactoryAbi,
      functionName: 'createAccountWithModeCustomSafetyDelay',
      args: [initParams, custodyPolicyAddress, 0, salt],
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
        <h1>No active seat.</h1>
        <p>Claim at least one seat in Act 1 before creating the Organization.</p>
        <a href="#/">← Back to seat picker</a>
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
