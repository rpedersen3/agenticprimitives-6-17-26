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
import type { Address, Hex } from 'viem';
import { useAccount, useConnectors, useSignTypedData } from 'wagmi';
import { orgConfig } from '../../org-config';
import {
  loadActiveSeat,
  loadSeats,
  setActiveSeat,
  getPasskeyAuth,
  getSiweAuth,
  type SeatClaim,
} from '../../lib/seats';
import { loadOrg, loadTreasury } from '../../lib/demo-state';
import { getPasskeyForSeat } from '../../lib/passkey';
import {
  CustodyAction,
  buildAddCustodianArgs,
  buildAddPasskeyCredentialArgs,
  buildChangeApprovalsRequiredArgs,
} from '@agenticprimitives/custody';
import { readApprovalsRequired, readIsCustodian } from '../../lib/chain-reads';
import { scheduleAndApply, type CeremonyResult, type CeremonyPhase } from '../../lib/custody-ceremony';
import { ConnectionDialog, type ConnectionStage } from '../components/ConnectionDialog';
import { LiveStatusBadge } from '../components/LiveStatusBadge';
import { shortAddress } from '../../components';
import { config } from '../../config';

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
  'signing-schedule': 'Signing schedule…',
  'submitting-schedule': 'Submitting scheduled change…',
  'reading-eta': 'Reading change eta from chain…',
  'signing-apply': 'Signing apply…',
  'submitting-apply': 'Applying the change…',
  'verifying': 'Verifying on chain…',
};


export function Act4TwoPersonControl({ onComplete }: { onComplete: () => void }) {
  const { signTypedDataAsync } = useSignTypedData();
  const { address: walletAddress } = useAccount();
  const connectors = useConnectors();
  const getWalletAddress = () => walletAddress as `0x${string}` | undefined;
  const promptSwitchWalletAccount = async (): Promise<`0x${string}` | undefined> => {
    const injected = connectors.find((c) => c.id === 'injected') ?? connectors[0];
    if (!injected) return undefined;
    try {
      // Provider-direct picker — see Act3BobJoins for full rationale.
      // No wagmi disconnect/connect (which races state).
      const provider = (await injected.getProvider()) as
        | { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }
        | undefined;
      if (!provider?.request) return undefined;
      try {
        await provider.request({
          method: 'wallet_requestPermissions',
          params: [{ eth_accounts: {} }],
        });
      } catch {
        return undefined;
      }
      const accounts = (await provider.request({
        method: 'eth_accounts',
      })) as string[] | undefined;
      return (accounts?.[0] as `0x${string}` | undefined) ?? undefined;
    } catch {
      return undefined;
    }
  };
  const std = async (a: { domain: unknown; types: unknown; primaryType: string; message: unknown }) =>
    (await signTypedDataAsync({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      domain: a.domain as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      types: a.types as any,
      primaryType: a.primaryType,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      message: a.message as any,
    })) as Hex;
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

  // Pre-flight: only short-circuit when BOTH effects are on chain —
  // every Bob identity is a Treasury custodian (step 1) AND the Org's
  // T4 quorum is ≥ 2 (step 2). If only step 1 is done (e.g. a prior
  // session bumped Treasury but never raised the Org quorum), the
  // dialog stays open so `runCeremony` can run step 2 alone — the
  // inner `already` guards skip the no-op work.
  // Step 1 detection checks passkey PIA AND SIWE EOA — earlier code
  // only checked PIA, so SIWE-only Bob never marked the act complete.
  useEffect(() => {
    const probe = async () => {
      if (!org || !treasury || !bobClaim || !config.custodyPolicy) return;
      const bobPa = getPasskeyAuth(bobClaim);
      const bobSiwe = getSiweAuth(bobClaim);
      const bobIdents: `0x${string}`[] = [
        ...(bobPa ? [bobPa.pia] : []),
        ...(bobSiwe ? [bobSiwe.eoa] : []),
      ];
      if (bobIdents.length === 0) return;
      const [treasuryChecks, orgT4] = await Promise.all([
        Promise.all(
          bobIdents.map((id) => readIsCustodian({ account: treasury.address, signer: id })),
        ),
        readApprovalsRequired({
          custodyPolicy: config.custodyPolicy,
          account: org.address,
          tier: 4,
        }),
      ]);
      if (treasuryChecks.every(Boolean) && orgT4 >= 2) {
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
    const alicePasskeyAuth = getPasskeyAuth(aliceClaim);
    const aliceSiweAuth = getSiweAuth(aliceClaim);
    if (!alicePasskeyAuth && !aliceSiweAuth) {
      setStage('error');
      setError('Alice has no enrolled auth method — re-claim her seat.');
      return;
    }
    const alicePasskey = alicePasskeyAuth ? (getPasskeyForSeat(aliceSeat.id) ?? undefined) : undefined;
    if (alicePasskeyAuth && !alicePasskey) {
      setStage('error');
      setError(`${aliceSeat.name}\'s passkey enrolment is missing from this device.`);
      return;
    }
    const bobPasskeyMethod = getPasskeyAuth(bobClaim);
    const bobPasskey = bobPasskeyMethod ? (getPasskeyForSeat(bobSeat.id) ?? undefined) : undefined;
    if (bobPasskeyMethod && !bobPasskey) {
      setStage('error');
      setError(`${bobSeat.name}\'s passkey enrolment is missing from this device.`);
      return;
    }

    setStage('working');
    setError(null);

    try {
      // Step A: register EACH of Bob's enrolled identities on Treasury.
      // Per the 2026-05-22 product decision ("register both"), if Bob
      // has passkey + SIWE, we run two ceremonies — one AddPasskeyCredential,
      // one AddCustodian — sequenced, both Alice-signed.
      setActiveStep('add-bob-treasury');
      const bobPasskeyAuth = bobPasskeyMethod;
      const bobSiweAuth = getSiweAuth(bobClaim);
      let lastStep1: CeremonyResult | null = null;
      if (bobPasskeyAuth) {
        const already = await readIsCustodian({
          account: treasury.address,
          signer: bobPasskeyAuth.pia,
        });
        if (!already) {
          const step = await scheduleAndApply({
            account: treasury.address,
            action: CustodyAction.AddPasskeyCredential,
            innerArgs: buildAddPasskeyCredentialArgs(
              bobPasskeyAuth.credentialIdDigest,
              bobPasskeyAuth.pubKeyX,
              bobPasskeyAuth.pubKeyY,
            ),
            signers: [{
              seat: aliceClaim,
              passkey: alicePasskey,
              signTypedDataAsync: std,
              getWalletAddress,
              promptSwitchWalletAccount,
            }],
            setPhase,
          });
          if ('error' in step) {
            setStage('error');
            setError(`Step 1a (AddPasskey Bob on Treasury): ${step.error}`);
            return;
          }
          lastStep1 = step;
        }
      }
      if (bobSiweAuth) {
        const already = await readIsCustodian({
          account: treasury.address,
          signer: bobSiweAuth.eoa,
        });
        if (!already) {
          const step = await scheduleAndApply({
            account: treasury.address,
            action: CustodyAction.AddCustodian,
            innerArgs: buildAddCustodianArgs(bobSiweAuth.eoa),
            signers: [{
              seat: aliceClaim,
              passkey: alicePasskey,
              signTypedDataAsync: std,
              getWalletAddress,
              promptSwitchWalletAccount,
            }],
            setPhase,
          });
          if ('error' in step) {
            setStage('error');
            setError(`Step 1b (AddCustodian Bob.EOA on Treasury): ${step.error}`);
            return;
          }
          lastStep1 = step;
        }
      }
      if (lastStep1) setStep1Result(lastStep1);

      // Verify every Bob identity is now a custodian on Treasury.
      setPhase('verifying');
      const bobIdentities: Address[] = [
        ...(bobPasskeyAuth ? [bobPasskeyAuth.pia] : []),
        ...(bobSiweAuth ? [bobSiweAuth.eoa] : []),
      ];
      const verifyResults = await Promise.all(
        bobIdentities.map((id) =>
          readIsCustodian({ account: treasury.address, signer: id, waitForTrue: true }),
        ),
      );
      if (!verifyResults.every(Boolean)) {
        setStage('error');
        setError(
          `Bob's identities aren't all on Treasury yet: ${bobIdentities
            .map((id, i) => `${shortAddress(id)}=${verifyResults[i] ? '✓' : '✗'}`)
            .join(' · ')}`,
        );
        return;
      }

      // Step B: ChangeApprovalsRequired(T4, 2) on Org.
      //
      // Critical: raising the threshold from N→M (M > N) requires M
      // signatures, not the current N. Otherwise a lone signer could
      // raise + lower the quorum freely. Concretely: the on-chain
      // CustodyPolicy emits `AdminInsufficientQuorum(supplied=1,
      // required=2)` if we only send Alice's sig. We collect BOTH
      // Alice + Bob here. Bob's signer dispatches via whichever auth
      // method he claimed with (passkey preferred, else SIWE).
      setActiveStep('bump-org-threshold');
      const step2 = await scheduleAndApply({
        account: org.address,
        action: CustodyAction.ChangeApprovalsRequired,
        innerArgs: buildChangeApprovalsRequiredArgs(4, 2),
        signers: [
          {
            seat: aliceClaim,
            passkey: alicePasskey,
            signTypedDataAsync: std,
            getWalletAddress,
            promptSwitchWalletAccount,
          },
          {
            seat: bobClaim,
            passkey: bobPasskey,
            signTypedDataAsync: std,
            getWalletAddress,
            promptSwitchWalletAccount,
          },
        ],
        setPhase,
      });
      if ('error' in step2) {
        setStage('error');
        setError(`Step 2 (ChangeApprovalsRequired on Org): ${step2.error}`);
        return;
      }
      setStep2Result(step2);

      setStage('success');
      try { window.dispatchEvent(new Event('chain-state:update')); } catch {}
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
            Register <strong>{bobSeat.name}\'s identities</strong> on the Treasury —
            one CustodyAction per enrolled method (passkey + wallet). Afterward
            the Treasury recognizes both Alice\'s and Bob\'s identities as custodians.
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
            ? `Step 1 / 2 — registering ${bobSeat.name}\'s identities on the Treasury.`
            : `Step 2 / 2 — bumping ${orgConfig.name}\'s T4 threshold.`
        }
        successExtra={
          stage === 'success' ? (
            <>
              <p className="muted">
                {orgConfig.name} now requires 2 approvals for T4 admin
                changes. The Treasury recognizes both Alice\'s and Bob\'s identities.
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
        onSwitchWallet={async () => { await promptSwitchWalletAccount(); }}
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
