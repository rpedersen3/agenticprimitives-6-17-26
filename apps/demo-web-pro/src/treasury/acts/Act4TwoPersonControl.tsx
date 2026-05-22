/**
 * Act 4 — Set 2-Person Org Control (spec 211 § 5 Act 4 / phase 6f.4).
 *
 * Pre-conditions:
 *   - Org exists with {Alice.PIA, Bob.PIA} as custodians (Act 3).
 *   - Treasury exists with {Alice.PIA} as sole custodian (Act 2.5).
 *   - Org's T4 approvalsRequired is still 1 (set at install when N=1).
 *
 * Two T4 admin actions, signed by Alice alone (Org/Treasury still at
 * 1-of-N), each a full schedule→apply round-trip via the v=2 passkey
 * quorum slot:
 *
 *   A. AddPasskeyCredential(Bob.credentialIdDigest, Bob.x, Bob.y) on
 *      Treasury. After: Treasury custodians = {Alice.PIA, Bob.PIA}.
 *   B. ChangeApprovalsRequired(T4, 2) on the Org. After: Org admin
 *      changes require both Alice + Bob.
 *
 * The "Treasury also bumps to 2-of-2" step is intentionally NOT in this
 * act (spec 211 § 5 Act 4 + § 9 — flagged as a downstream simulated
 * boundary that lights up in phase 6f.7 once steward delegations land).
 *
 * 🟢 LIVE end-to-end.
 */

import { useEffect, useState } from 'react';
import { keccak256, type Hex } from 'viem';
import { orgConfig } from '../../org-config';
import { loadActiveSeat, loadSeats, setActiveSeat, type SeatClaim } from '../../lib/seats';
import { loadOrg, loadTreasury } from '../../lib/demo-state';
import { getPasskeyForSeat, assertWithPasskey, type DemoPasskey } from '../../lib/passkey';
import {
  CustodyAction,
  buildAddPasskeyCredentialArgs,
  buildChangeApprovalsRequiredArgs,
  packQuorumSigs,
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
import {
  readScheduledChangeCount,
  readScheduledChange,
  readIsCustodian,
} from '../../lib/chain-reads';
import { ConnectionDialog, type ConnectionStage } from '../components/ConnectionDialog';
import { LiveStatusBadge } from '../components/LiveStatusBadge';
import { shortAddress } from '../../components';
import { config } from '../../config';
import type { Address } from 'viem';

type Step = 'add-bob-treasury' | 'bump-org-threshold';
type WorkingPhase =
  | 'computing-hash'
  | 'signing-schedule'
  | 'submitting-schedule'
  | 'reading-eta'
  | 'signing-apply'
  | 'submitting-apply'
  | 'verifying';

const PHASE_LABEL: Record<WorkingPhase, string> = {
  'computing-hash': 'Computing EIP-712 hash…',
  'signing-schedule': 'Signing schedule with passkey…',
  'submitting-schedule': 'Submitting scheduled change…',
  'reading-eta': 'Reading change eta from chain…',
  'signing-apply': 'Signing apply with passkey…',
  'submitting-apply': 'Applying the change…',
  'verifying': 'Verifying on chain…',
};

interface CeremonyResult {
  scheduleTx: Hex;
  applyTx: Hex;
}

export function Act4TwoPersonControl({ onComplete }: { onComplete: () => void }) {
  const [stage, setStage] = useState<ConnectionStage>('consent');
  const [phase, setPhase] = useState<WorkingPhase>('computing-hash');
  const [activeStep, setActiveStep] = useState<Step>('add-bob-treasury');
  const [error, setError] = useState<string | null>(null);
  const [step1Result, setStep1Result] = useState<CeremonyResult | null>(null);
  const [step2Result, setStep2Result] = useState<CeremonyResult | null>(null);
  const [dialogOpen, setDialogOpen] = useState(true);
  const [alreadyComplete, setAlreadyComplete] = useState(false);

  const seats = loadSeats();
  const activeSeatId = loadActiveSeat();
  const org = loadOrg();
  const treasury = loadTreasury();
  const aliceSeat = orgConfig.seats.find((s) => s.id === 'alice') ?? orgConfig.seats[0];
  const bobSeat = orgConfig.seats.find((s) => s.id !== 'alice') ?? orgConfig.seats[1];

  const aliceClaim: SeatClaim | undefined = aliceSeat ? seats[aliceSeat.id] : undefined;
  const bobClaim: SeatClaim | undefined = bobSeat ? seats[bobSeat.id] : undefined;
  const aliceIsActive = aliceClaim && activeSeatId === aliceSeat?.id;

  // Pre-flight: if both effects are already on chain, short-circuit.
  useEffect(() => {
    const probe = async () => {
      if (!org || !treasury || !bobClaim) return;
      const isBobTreasury = await readIsCustodian({
        account: treasury.address,
        signer: bobClaim.personIdentity,
      });
      if (isBobTreasury) {
        // Step 1 already done; step 2's verification (Org T4 = 2) would
        // need an additional view we don't currently have. For now, if
        // step 1 is done, assume the act is complete.
        setAlreadyComplete(true);
        setDialogOpen(false);
      }
    };
    void probe();
  }, [org, treasury, bobSeat, bobClaim]);

  if (!org || !treasury) {
    return (
      <section className="card">
        <p className="eyebrow">Act 4 · Admin</p>
        <h1>Org and Treasury need to exist first.</h1>
        <p>Run Acts 2 + 2.5 before this one.</p>
        <a href="#/" className="primary">← Back to seat picker</a>
      </section>
    );
  }
  if (!aliceClaim || !aliceSeat || !bobClaim || !bobSeat) {
    return (
      <section className="card">
        <p className="eyebrow">Act 4 · Admin</p>
        <h1>Both seats must be claimed.</h1>
        <p>Act 3 brings Bob aboard; rerun it first.</p>
        <a href="#/" className="primary">← Back to seat picker</a>
      </section>
    );
  }
  if (!aliceIsActive) {
    return (
      <section>
        <div className="hero">
          <p className="eyebrow">Act 4 · Admin · <LiveStatusBadge status="live" /></p>
          <h1>Switch to {aliceSeat.name} to continue.</h1>
          <p>
            Org + Treasury are still 1-of-N until this act runs. {aliceSeat.name} signs
            both T4 admin actions.
          </p>
        </div>
        <section className="card">
          <button
            type="button"
            className="primary"
            onClick={() => setActiveSeat(aliceSeat.id)}
            data-testid="act4-switch-to-alice"
          >
            Act as {aliceSeat.name} →
          </button>
        </section>
      </section>
    );
  }

  const runCeremony = async () => {
    if (!config.custodyPolicy || !config.chainId) {
      setStage('error');
      setError('Deployment config missing — VITE_CUSTODY_POLICY / VITE_CHAIN_ID.');
      return;
    }
    const alicePasskey = getPasskeyForSeat(aliceSeat.id);
    const bobPasskey = getPasskeyForSeat(bobSeat.id);
    if (!alicePasskey || !bobPasskey) {
      setStage('error');
      setError(`Missing passkey(s) on this device.`);
      return;
    }

    setStage('working');
    setError(null);

    try {
      // Step A: AddPasskeyCredential(Bob) on Treasury.
      setActiveStep('add-bob-treasury');
      const step1 = await scheduleAndApply({
        account: treasury.address,
        action: CustodyAction.AddPasskeyCredential,
        innerArgs: buildAddPasskeyCredentialArgs(
          bobPasskey.credentialIdDigest,
          bobPasskey.pubKeyX,
          bobPasskey.pubKeyY,
        ),
        signer: aliceClaim,
        signerPasskey: alicePasskey,
        setPhase,
      });
      if ('error' in step1) {
        setStage('error');
        setError(`Step 1 (AddPasskey Bob on Treasury): ${step1.error}`);
        return;
      }
      setStep1Result(step1);

      // Verify Bob's PIA landed on Treasury (poll past RPC-replica lag).
      setPhase('verifying');
      const isBobOnTreasury = await readIsCustodian({
        account: treasury.address,
        signer: bobClaim.personIdentity,
        waitForTrue: true,
      });
      if (!isBobOnTreasury) {
        setStage('error');
        setError(
          `Step 1 applyCustodyChange tx succeeded (${step1.applyTx}) but Treasury.isCustodian(${bobClaim.personIdentity}) is still false.`,
        );
        return;
      }

      // Step B: ChangeApprovalsRequired(T4, 2) on Org.
      setActiveStep('bump-org-threshold');
      const step2 = await scheduleAndApply({
        account: org.address,
        action: CustodyAction.ChangeApprovalsRequired,
        innerArgs: buildChangeApprovalsRequiredArgs(4, 2),
        signer: aliceClaim,
        signerPasskey: alicePasskey,
        setPhase,
      });
      if ('error' in step2) {
        setStage('error');
        setError(`Step 2 (ChangeApprovalsRequired on Org): ${step2.error}`);
        return;
      }
      setStep2Result(step2);

      setStage('success');
    } catch (e) {
      setStage('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section>
      <div className="hero">
        <p className="eyebrow">Act 4 · Admin · <LiveStatusBadge status="live" /></p>
        <h1>Set 2-of-2 control over {orgConfig.name}.</h1>
        <p>
          Two T4 admin actions, both signed by {aliceSeat.name}:
        </p>
        <ol>
          <li>
            Add <strong>{bobSeat.name}'s passkey</strong> to the Treasury — afterward
            the Treasury recognizes both Alice's and Bob's passkey identities
            as custodians.
          </li>
          <li>
            Bump the Org's <strong>T4 approvals required</strong> from 1 to 2 —
            afterward every future Org admin change needs both {aliceSeat.name}
            and {bobSeat.name}.
          </li>
        </ol>
      </div>

      {alreadyComplete && !dialogOpen && (
        <section className="card">
          <p className="eyebrow">Already complete</p>
          <h2>{bobSeat.name} is already a Treasury custodian.</h2>
          <a href="#/" className="primary">← Back to seat picker</a>
        </section>
      )}

      <ConnectionDialog
        open={dialogOpen}
        stage={stage}
        title={`Set 2-of-2 on ${orgConfig.name}`}
        scopeList={[
          `Treasury: AddPasskeyCredential(${bobSeat.name}.credentialId) — adds ${bobSeat.name}'s PIA to the Treasury custodian set.`,
          `${orgConfig.name}: ChangeApprovalsRequired(T4, 2) — admin changes now need both ${aliceSeat.name} + ${bobSeat.name}.`,
        ]}
        grantee={`${orgConfig.name} + Treasury`}
        duration="permanent — only future admin actions can reverse"
        limits={[
          `Bump the Treasury's own approvals-required to 2 — that's queued for phase 6f.7.`,
          `Add ${bobSeat.name} to the Org again — he's already there from Act 3.`,
          `Remove ${aliceSeat.name} — both seats stay; this only adds quorum.`,
        ]}
        revokeNote="Future RotateAllCustodians / RemovePasskeyCredential actions can adjust the set later."
        onAccept={() => { void runCeremony(); }}
        onDecline={() => {
          setDialogOpen(false);
          onComplete();
        }}
        phaseLabel={PHASE_LABEL[phase]}
        phaseHint={
          activeStep === 'add-bob-treasury'
            ? `Step 1 / 2 — adding ${bobSeat.name}'s passkey to the Treasury.`
            : `Step 2 / 2 — bumping ${orgConfig.name}'s T4 threshold.`
        }
        successExtra={
          stage === 'success' ? (
            <>
              <p className="muted">
                {orgConfig.name} now requires 2 approvals for T4 admin
                changes. The Treasury recognizes both passkeys.
              </p>
              {step1Result && step2Result && (
                <dl className="kv">
                  <dt>Treasury AddPasskey schedule</dt>
                  <dd><code>{shortAddress(step1Result.scheduleTx)}</code></dd>
                  <dt>Treasury AddPasskey apply</dt>
                  <dd><code>{shortAddress(step1Result.applyTx)}</code></dd>
                  <dt>Org ChangeApprovals schedule</dt>
                  <dd><code>{shortAddress(step2Result.scheduleTx)}</code></dd>
                  <dt>Org ChangeApprovals apply</dt>
                  <dd><code>{shortAddress(step2Result.applyTx)}</code></dd>
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

// ─── Helpers ──────────────────────────────────────────────────────────

interface ScheduleAndApplyArgs {
  account: Address;
  action: CustodyAction;
  innerArgs: Hex;
  signer: SeatClaim;
  signerPasskey: DemoPasskey;
  setPhase: (p: WorkingPhase) => void;
}

async function scheduleAndApply(
  args: ScheduleAndApplyArgs,
): Promise<CeremonyResult | { error: string }> {
  if (!config.custodyPolicy || !config.chainId) {
    return { error: 'custody policy / chain id missing' };
  }
  const { account, action, innerArgs, signer, signerPasskey, setPhase } = args;
  const signerPia = signer.personIdentity;
  const argsHash = keccak256(innerArgs);

  setPhase('computing-hash');
  const lastChangeId = await readScheduledChangeCount({
    custodyPolicy: config.custodyPolicy,
    account,
  });
  let expectedChangeId = lastChangeId + 1n;
  let skipSchedule = false;
  let existingEta: bigint | null = null;
  // Resume: scan recent un-executed matching changes (last 5).
  const scanTo = lastChangeId > 5n ? lastChangeId - 5n : 0n;
  for (let id = lastChangeId; id > scanTo; id--) {
    const sc = await readScheduledChange({
      custodyPolicy: config.custodyPolicy,
      account,
      changeId: id,
    });
    if (
      sc.action === action &&
      sc.args.toLowerCase() === innerArgs.toLowerCase() &&
      !sc.executed &&
      !sc.cancelled
    ) {
      expectedChangeId = id;
      existingEta = sc.eta;
      skipSchedule = true;
      break;
    }
  }

  const domainSeparator = computeDomainSeparator({
    custodyPolicy: config.custodyPolicy,
    chainId: config.chainId,
  });
  const scheduleHash = hashScheduleCustodyChange({
    domainSeparator,
    message: { account, action, argsHash, changeId: expectedChangeId },
  });

  let resolvedEta: bigint;
  let scheduleTx: Hex;
  if (skipSchedule && existingEta !== null) {
    resolvedEta = existingEta;
    scheduleTx = ('0x' + '00'.repeat(32)) as Hex; // resumed; no fresh tx
  } else {
    setPhase('signing-schedule');
    const scheduleAssertion = await assertWithPasskey(signerPasskey, scheduleHash);
    const scheduleSigs = packQuorumSigs([
      {
        type: 'passkey',
        pia: signerPia,
        x: signerPasskey.pubKeyX,
        y: signerPasskey.pubKeyY,
        assertion: scheduleAssertion,
      },
    ]);

    setPhase('submitting-schedule');
    const scheduleCallData = encodeScheduleCall({
      account,
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
      sender: signer.personAgent,
      passkey: signerPasskey,
      callData: scheduleOuter,
    });
    if (!scheduleResult.ok) {
      return { error: scheduleResult.reason || scheduleResult.error };
    }
    scheduleTx = scheduleResult.transactionHash;

    setPhase('reading-eta');
    const scheduledChange = await readScheduledChange({
      custodyPolicy: config.custodyPolicy,
      account,
      changeId: expectedChangeId,
      waitForExistence: true,
    });
    if (scheduledChange.eta === 0n) {
      return { error: 'schedule landed but the change is not visible to the read-RPC yet — refresh + retry' };
    }
    resolvedEta = scheduledChange.eta;
  }

  const applyHash = hashApplyCustodyChange({
    domainSeparator,
    message: { account, action, argsHash, changeId: expectedChangeId, eta: resolvedEta },
  });

  setPhase('signing-apply');
  const applyAssertion = await assertWithPasskey(signerPasskey, applyHash);
  const applySigs = packQuorumSigs([
    {
      type: 'passkey',
      pia: signerPia,
      x: signerPasskey.pubKeyX,
      y: signerPasskey.pubKeyY,
      assertion: applyAssertion,
    },
  ]);

  setPhase('submitting-apply');
  const applyCallData = encodeApplyCall({
    account,
    changeId: expectedChangeId,
    quorumSigs: applySigs,
  });
  const applyOuter = encodeExecuteCall({
    target: config.custodyPolicy,
    value: 0n,
    innerData: applyCallData,
  });
  const applyResult = await executeCallFromAgent({
    sender: signer.personAgent,
    passkey: signerPasskey,
    callData: applyOuter,
  });
  if (!applyResult.ok) {
    return { error: applyResult.reason || applyResult.error };
  }
  return { scheduleTx, applyTx: applyResult.transactionHash };
}
