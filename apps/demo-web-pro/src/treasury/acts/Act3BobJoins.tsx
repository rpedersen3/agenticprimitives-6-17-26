/**
 * Act 3 — Bob joins as Org member (spec 211 § 5 Act 3 / phase 6f.3).
 *
 * Pre-conditions:
 *   - Acme Construction exists (Act 2).
 *   - Bob\'s seat may or may not be claimed yet.
 *
 * Flow:
 *   A. If Bob hasn\'t claimed his seat, surface a "claim Bob" CTA that
 *      switches the active actor to Bob and routes to his Act 1.
 *      Onreturn (Bob\'s PSA deployed), the visitor switches back to Alice.
 *   B. Alice (the founding custodian) schedules
 *      `CustodyAction.AddCustodian(Bob.PSA)` on the Org via
 *      Alice.PSA.execute(CustodyPolicy.scheduleCustodyChange(...)).
 *      The quorum sig is a single v=0 ERC-1271 slot pointing at
 *      Alice.PSA + a WebAuthn assertion blob over the EIP-712 hash.
 *   C. The Org was deployed with safetyDelay = 0s (Act 2), so we can
 *      apply immediately. We read the change\'s eta from chain to be
 *      safe.
 *   D. Alice applies the change via Alice.PSA.execute(CustodyPolicy
 *      .applyCustodyChange(...)). The CustodyPolicy then dispatches
 *      Org.executeFromModule(Org, 0, encode addCustodian(Bob.PSA)).
 *   E. Verify Org.isCustodian(Bob.PSA) == true.
 *
 * 🟢 LIVE end-to-end. The EIP-712 hashes + quorum-sig packing are real
 * on-chain mechanics; nothing simulated.
 */

import { useEffect, useState } from 'react';
import { keccak256, type Hex } from 'viem';
import { orgConfig } from '../../org-config';
import { loadActiveSeat, loadSeats, setActiveSeat, type SeatClaim } from '../../lib/seats';
import { loadOrg } from '../../lib/demo-state';
import { getPasskeyForSeat, assertWithPasskey } from '../../lib/passkey';
import { encodeWebAuthnSignature } from '@agenticprimitives/agent-account';
import {
  CustodyAction,
  buildAddCustodianArgs,
} from '@agenticprimitives/custody';
import {
  executeCallFromAgent,
  encodeExecuteCall,
} from '../../lib/execute-call';
import {
  computeDomainSeparator,
  hashScheduleCustodyChange,
  hashApplyCustodyChange,
  encodeScheduleCall,
  encodeApplyCall,
} from '../../lib/custody-flow';
import { packContractSigs } from '../../lib/quorum-sigs';
import {
  readScheduledChangeCount,
  readScheduledChange,
  readIsCustodian,
  readSafetyDelay,
} from '../../lib/chain-reads';
import { ConnectionDialog, type ConnectionStage } from '../components/ConnectionDialog';
import { LiveStatusBadge } from '../components/LiveStatusBadge';
import { shortAddress } from '../../components';
import { config } from '../../config';

type WorkingPhase =
  | 'computing-hash'
  | 'signing-schedule'
  | 'submitting-schedule'
  | 'reading-eta'
  | 'signing-apply'
  | 'submitting-apply'
  | 'verifying';

const PHASE_LABEL: Record<WorkingPhase, string> = {
  'computing-hash': 'Computing EIP-712 schedule hash…',
  'signing-schedule': 'Confirming schedule with your passkey…',
  'submitting-schedule': 'Submitting scheduled change…',
  'reading-eta': 'Reading change eta from chain…',
  'signing-apply': 'Confirming apply with your passkey…',
  'submitting-apply': 'Applying the change…',
  'verifying': 'Verifying Bob is now a custodian…',
};

const PHASE_HINT: Record<WorkingPhase, string | undefined> = {
  'computing-hash': 'Building the ScheduleCustodyChangeRequest hash the CustodyPolicy will verify.',
  'signing-schedule': 'Your passkey signs the EIP-712 hash on behalf of Alice\'s Person Smart Agent.',
  'submitting-schedule': 'Alice\'s PSA dispatches scheduleCustodyChange via the CustodyPolicy module. Paymaster pays gas.',
  'reading-eta': 'The Org was deployed with 0s safety delay — eta should already be reached.',
  'signing-apply': 'Same passkey, same shape, different EIP-712 typehash (ApplyCustodyChangeRequest).',
  'submitting-apply': 'CustodyPolicy.applyCustodyChange dispatches Org.executeFromModule → addCustodian(Bob.PSA).',
  'verifying': 'Reading Org.isCustodian(Bob.PSA) from chain to confirm the change landed.',
};

export function Act3BobJoins({ onComplete }: { onComplete: () => void }) {
  const [stage, setStage] = useState<ConnectionStage>('consent');
  const [phase, setPhase] = useState<WorkingPhase>('computing-hash');
  const [error, setError] = useState<string | null>(null);
  const [scheduleTx, setScheduleTx] = useState<Hex | null>(null);
  const [applyTx, setApplyTx] = useState<Hex | null>(null);
  const [bobCustodyConfirmed, setBobCustodyConfirmed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(true);
  const [safetyDelaySeconds, setSafetyDelaySeconds] = useState<number | null>(null);

  const seats = loadSeats();
  const activeSeatId = loadActiveSeat();
  const org = loadOrg();
  const bobSeat = orgConfig.seats.find((s) => s.id !== 'alice') ?? orgConfig.seats[1];
  const aliceSeat = orgConfig.seats.find((s) => s.id === 'alice') ?? orgConfig.seats[0];

  const aliceClaim: SeatClaim | undefined = aliceSeat ? seats[aliceSeat.id] : undefined;
  const bobClaim: SeatClaim | undefined = bobSeat ? seats[bobSeat.id] : undefined;

  // If Bob hasn\'t claimed his seat yet, route through Bob\'s Act 1 first.
  const needsBob = !bobClaim;

  // If the active actor isn't Alice, we can't sign for the Org. Walk
  // the visitor to switch.
  const aliceIsActive = aliceClaim && activeSeatId === aliceSeat?.id;

  useEffect(() => {
    const probe = async () => {
      if (!org || !config.custodyPolicy) return;
      // Detect Orgs deployed before the 0s-safety-delay fix.
      const delay = await readSafetyDelay({
        custodyPolicy: config.custodyPolicy,
        account: org.address,
        tier: 4,
      });
      setSafetyDelaySeconds(delay);
      // If Bob is already a custodian (e.g. Act 3 already completed),
      // close the dialog and show the summary card.
      if (bobClaim) {
        const isCust = await readIsCustodian({
          account: org.address,
          signer: bobClaim.personAgent,
        });
        if (isCust) {
          setBobCustodyConfirmed(true);
          setDialogOpen(false);
        }
      }
    };
    void probe();
  }, [org, bobClaim]);

  // ─── Pre-flight gates ─────────────────────────────────────────────────

  if (!org) {
    return (
      <section className="card">
        <p className="eyebrow">Act 3 · Admin</p>
        <h1>The Org doesn\'t exist yet.</h1>
        <p>Run Act 2 first to deploy {orgConfig.name}.</p>
        <a href="#/acts/create-org" className="primary">Go to Act 2 →</a>
      </section>
    );
  }

  if (!aliceClaim || !aliceSeat) {
    return (
      <section className="card">
        <p className="eyebrow">Act 3 · Admin</p>
        <h1>{aliceSeat?.name ?? 'Alice'} hasn\'t claimed her seat yet.</h1>
        <p>The Org\'s only custodian is needed to sign for the AddCustodian change.</p>
        <a href="#/" className="primary">← Back to seat picker</a>
      </section>
    );
  }

  if (needsBob || !bobClaim) {
    return (
      <section>
        <div className="hero">
          <p className="eyebrow">Act 3 · Bob joins · <LiveStatusBadge status="live" /></p>
          <h1>Bring Bob aboard.</h1>
          <p>
            Bob hasn\'t claimed his seat yet. First, walk Bob through onboarding —
            the visitor switches to Bob\'s seat, registers a fresh passkey, and deploys
            Bob\'s Person Smart Agent. After that, Alice schedules + applies the
            <code> AddCustodian(Bob.PSA) </code> change on the Org.
          </p>
        </div>
        <section className="card">
          <p>
            <strong>Step A.</strong> Switch to Bob and run Act 1 for Bob.
          </p>
          <a
            href={`#/acts/create-alice/${bobSeat?.id}`}
            className="primary next-step-card"
            onClick={() => bobSeat && setActiveSeat(bobSeat.id)}
            data-testid="act3-claim-bob"
          >
            Claim {bobSeat?.name}\'s seat →
          </a>
          <p className="muted small">
            Once Bob\'s seat is claimed, come back here (or use the rail) and we\'ll continue.
          </p>
        </section>
      </section>
    );
  }

  // Stale Org deployed before the 0s-safety-delay fix. The schedule
  // step would still work but the apply step would revert with
  // "ProposalNotReady" for an hour. Surface this as a fixable error.
  if (safetyDelaySeconds !== null && safetyDelaySeconds > 0) {
    return (
      <section>
        <div className="hero">
          <p className="eyebrow">Act 3 · Admin · <LiveStatusBadge status="live" /></p>
          <h1>This Org has a non-zero safety delay.</h1>
          <p>
            {orgConfig.name} was deployed with a {safetyDelaySeconds}-second T4 safety
            delay — Act 3 would need to wait that long between schedule and apply, which
            doesn\'t fit the demo flow.
          </p>
        </div>
        <section className="card">
          <p>
            <strong>Fix:</strong> reset the demo (top-bar <code>⋯</code>) and redo
            Acts 1 + 2 + 2.5. The new code path deploys with 0-second safety delay so
            Act 3 lands schedule + apply back-to-back.
          </p>
          <p className="muted small">
            On-chain Org and Treasury stay deployed at their current addresses; resetting
            just forgets the local mapping so the next Act 2 deploys a fresh Org with the
            corrected safety delay.
          </p>
          <a href="#/" className="primary">← Back to seat picker</a>
        </section>
      </section>
    );
  }

  if (!aliceIsActive) {
    return (
      <section>
        <div className="hero">
          <p className="eyebrow">Act 3 · Bob joins · <LiveStatusBadge status="live" /></p>
          <h1>Switch to Alice to continue.</h1>
          <p>
            Bob is on board. Now Alice (the founding custodian) needs to sign the
            AddCustodian change on the Org\'s behalf.
          </p>
        </div>
        <section className="card">
          <button
            type="button"
            className="primary"
            onClick={() => setActiveSeat(aliceSeat.id)}
            data-testid="act3-switch-to-alice"
          >
            Act as {aliceSeat.name} →
          </button>
          <p className="muted small">
            (Or use the <strong>Acting as ▾</strong> chip in the top bar.)
          </p>
        </section>
      </section>
    );
  }

  // ─── Run the schedule + apply ceremony ────────────────────────────────

  const runCeremony = async () => {
    if (!config.factoryAddress || !config.custodyPolicy || !config.chainId) {
      setStage('error');
      setError('Deployment config missing — VITE_FACTORY_ADDRESS / VITE_CUSTODY_POLICY / VITE_CHAIN_ID.');
      return;
    }
    const alicePasskey = getPasskeyForSeat(aliceSeat.id);
    if (!alicePasskey) {
      setStage('error');
      setError(`${aliceSeat.name}'s passkey is missing on this device.`);
      return;
    }

    setStage('working');
    setError(null);

    try {
      // 1. Compose the action args.
      const action = CustodyAction.AddCustodian;
      const innerArgs = buildAddCustodianArgs(bobClaim.personAgent);
      const argsHash = keccak256(innerArgs);

      setPhase('computing-hash');

      // 2. Read next changeId = scheduledChangeCount() + 1.
      const lastChangeId = await readScheduledChangeCount({
        custodyPolicy: config.custodyPolicy,
        account: org.address,
      });
      const expectedChangeId = lastChangeId + 1n;

      // 3. Compute domain separator + schedule hash.
      const domainSeparator = computeDomainSeparator({
        custodyPolicy: config.custodyPolicy,
        chainId: config.chainId,
      });
      const scheduleHash = hashScheduleCustodyChange({
        domainSeparator,
        message: {
          account: org.address,
          action,
          argsHash,
          changeId: expectedChangeId,
        },
      });

      // 4. Alice signs.
      setPhase('signing-schedule');
      const scheduleAssertion = await assertWithPasskey(alicePasskey, scheduleHash);
      const scheduleBlob = encodeWebAuthnSignature(scheduleAssertion);
      const scheduleSigs = packContractSigs([
        { signer: aliceClaim.personAgent, signatureBlob: scheduleBlob },
      ]);

      // 5. Dispatch via Alice.PSA.execute(CustodyPolicy.schedule(...)).
      setPhase('submitting-schedule');
      const scheduleCallData = encodeScheduleCall({
        account: org.address,
        action,
        innerArgs,
        quorumSigs: scheduleSigs,
      });
      const scheduleOuter = encodeExecuteCall({
        target: config.custodyPolicy,
        value: 0n,
        innerData: scheduleCallData,
      });
      const scheduleResult = await executeCallFromAgent({
        sender: aliceClaim.personAgent,
        passkey: alicePasskey,
        callData: scheduleOuter,
      });
      if (!scheduleResult.ok) {
        setStage('error');
        setError(`Schedule failed: ${scheduleResult.reason || scheduleResult.error}`);
        return;
      }
      setScheduleTx(scheduleResult.transactionHash);

      // 6. Read the eta back from chain.
      setPhase('reading-eta');
      const scheduledChange = await readScheduledChange({
        custodyPolicy: config.custodyPolicy,
        account: org.address,
        changeId: expectedChangeId,
      });

      // 7. Compute apply hash.
      const applyHash = hashApplyCustodyChange({
        domainSeparator,
        message: {
          account: org.address,
          action,
          argsHash,
          changeId: expectedChangeId,
          eta: scheduledChange.eta,
        },
      });

      // 8. Alice signs apply.
      setPhase('signing-apply');
      const applyAssertion = await assertWithPasskey(alicePasskey, applyHash);
      const applyBlob = encodeWebAuthnSignature(applyAssertion);
      const applySigs = packContractSigs([
        { signer: aliceClaim.personAgent, signatureBlob: applyBlob },
      ]);

      // 9. Dispatch apply via Alice.PSA.execute(CustodyPolicy.apply(...)).
      setPhase('submitting-apply');
      const applyCallData = encodeApplyCall({
        account: org.address,
        changeId: expectedChangeId,
        quorumSigs: applySigs,
      });
      const applyOuter = encodeExecuteCall({
        target: config.custodyPolicy,
        value: 0n,
        innerData: applyCallData,
      });
      const applyResult = await executeCallFromAgent({
        sender: aliceClaim.personAgent,
        passkey: alicePasskey,
        callData: applyOuter,
      });
      if (!applyResult.ok) {
        setStage('error');
        setError(`Apply failed: ${applyResult.reason || applyResult.error}`);
        return;
      }
      setApplyTx(applyResult.transactionHash);

      // 10. Verify on chain.
      setPhase('verifying');
      const isCust = await readIsCustodian({
        account: org.address,
        signer: bobClaim.personAgent,
      });
      if (!isCust) {
        setStage('error');
        setError(
          `applyCustodyChange tx succeeded (${applyResult.transactionHash}) but Org.isCustodian(${bobClaim.personAgent}) is still false. Refresh the page in a moment to retry the verify.`,
        );
        return;
      }
      setBobCustodyConfirmed(true);
      setStage('success');
    } catch (e) {
      setStage('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section>
      <div className="hero">
        <p className="eyebrow">Act 3 · Admin · <LiveStatusBadge status="live" /></p>
        <h1>Add Bob as a custodian of {orgConfig.name}.</h1>
        <p>
          Alice (the founding custodian) schedules + applies an
          <code> AddCustodian({bobSeat?.name}.PSA) </code> change on the Org\'s
          CustodyPolicy. After this lands, the Org has two custodians but still
          requires only 1 approval (Act 4 bumps it to 2).
        </p>
      </div>

      {bobCustodyConfirmed && !dialogOpen && (
        <section className="card">
          <p className="eyebrow">Already complete</p>
          <h2>Bob is a custodian of {orgConfig.name}.</h2>
          <p className="muted">
            On-chain check: <code>Org.isCustodian(Bob.PSA)</code> = <strong>true</strong>.
            Continue with Act 4 to make the Org require 2 approvals.
          </p>
          <a href="#/" className="primary">← Back to seat picker</a>
        </section>
      )}

      <ConnectionDialog
        open={dialogOpen}
        stage={stage}
        title={`Add ${bobSeat?.name ?? 'Bob'} as a custodian`}
        scopeList={[
          `Alice signs an EIP-712 ScheduleCustodyChangeRequest authorizing AddCustodian(${bobSeat?.name}.PSA) on ${orgConfig.name}.`,
          `Alice signs an EIP-712 ApplyCustodyChangeRequest immediately after (0s safety delay).`,
          `${orgConfig.name}'s custodian set goes from {Alice.PSA} → {Alice.PSA, Bob.PSA}.`,
        ]}
        grantee={`${orgConfig.name} (the Org Smart Agent)`}
        duration="this change is permanent — only a future CustodyAction can reverse it"
        limits={[
          `Auto-promote the Org to 2-of-2 — approvalsRequired stays 1 until Act 4.`,
          `Affect ${bobSeat?.name}'s authority over the Treasury — Acts 4 + 5 set that up.`,
          'Revoke Alice — she stays a custodian until a future RemoveCustodian.',
        ]}
        revokeNote="The Custody Council will be able to RemoveCustodian(Bob) or RotateAllCustodians later via the same schedule/apply pattern."
        onAccept={() => { void runCeremony(); }}
        onDecline={() => {
          setDialogOpen(false);
          onComplete();
        }}
        phaseLabel={PHASE_LABEL[phase]}
        phaseHint={PHASE_HINT[phase]}
        successExtra={
          stage === 'success' ? (
            <>
              <p className="muted">
                Bob.PSA is now a custodian of {orgConfig.name}. Both schedule + apply landed
                on chain.
              </p>
              {scheduleTx && (
                <dl className="kv">
                  <dt>Schedule tx</dt>
                  <dd><code>{shortAddress(scheduleTx)}</code></dd>
                  {applyTx && (
                    <>
                      <dt>Apply tx</dt>
                      <dd><code>{shortAddress(applyTx)}</code></dd>
                    </>
                  )}
                </dl>
              )}
            </>
          ) : undefined
        }
        onContinue={() => {
          setDialogOpen(false);
          onComplete();
        }}
        errorMessage={error ?? undefined}
        onRetry={() => {
          setStage('consent');
          setError(null);
        }}
        onCancel={() => {
          setDialogOpen(false);
          onComplete();
        }}
      />
    </section>
  );
}

