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
 *      `CustodyAction.AddPasskeyCredential(Bob)` on the Org via
 *      Alice.PSA.execute(CustodyPolicy.scheduleCustodyChange(...)).
 *      The quorum sig is a single v=0 ERC-1271 slot pointing at
 *      Alice.PSA + a WebAuthn assertion blob over the EIP-712 hash.
 *   C. The Org was deployed with safetyDelay = 0s (Act 2), so we can
 *      apply immediately. We read the change\'s eta from chain to be
 *      safe.
 *   D. Alice applies the change via Alice.PSA.execute(CustodyPolicy
 *      .applyCustodyChange(...)). The CustodyPolicy then dispatches
 *      Org.executeFromModule(Org, 0, encode addPasskeyCredential(Bob)).
 *   E. Verify Org.isCustodian(Bob.PIA) == true.
 *
 * 🟢 LIVE end-to-end. The EIP-712 hashes + quorum-sig packing are real
 * on-chain mechanics; nothing simulated.
 */

import { useEffect, useState } from 'react';
import type { Hex } from 'viem';
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
import { loadOrg } from '../../lib/demo-state';
import { getPasskeyForSeat } from '../../lib/passkey';
import {
  CustodyAction,
  buildAddCustodianArgs,
  buildAddPasskeyCredentialArgs,
} from '@agenticprimitives/account-custody';
import { scheduleAndApply } from '../../lib/custody-ceremony';
import {
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
  'signing-schedule': 'Confirming schedule via your enrolled method…',
  'submitting-schedule': 'Submitting scheduled change…',
  'reading-eta': 'Reading change eta from chain…',
  'signing-apply': 'Confirming apply via your enrolled method…',
  'submitting-apply': 'Applying the change…',
  'verifying': 'Verifying Bob is now a custodian…',
};

const PHASE_HINT: Record<WorkingPhase, string | undefined> = {
  'computing-hash': 'Building the ScheduleCustodyChangeRequest hash the CustodyPolicy will verify.',
  'signing-schedule': 'Alice signs the EIP-712 hash. For passkey: v=2 quorum slot (direct WebAuthn). For SIWE: v=27/28 quorum slot via wagmi.signTypedData. Either way, Alice\'s identity is a custodian of the Org.',
  'submitting-schedule': 'Alice\'s PSA dispatches scheduleCustodyChange via the CustodyPolicy module. Paymaster pays gas.',
  'reading-eta': 'The Org was deployed with a 1s safety delay — eta is already reached.',
  'signing-apply': 'Same signer, same shape, different EIP-712 typehash (ApplyCustodyChangeRequest).',
  'submitting-apply': 'CustodyPolicy.applyCustodyChange dispatches Org.executeFromModule → addPasskey(Bob\'s credentialId). The PIA-as-custodian flag flips on as a side effect.',
  'verifying': 'Reading Org.isCustodian(Bob\'s PIA) from chain to confirm the change landed.',
};

export function Act3BobJoins({ onComplete }: { onComplete: () => void }) {
  const { signTypedDataAsync } = useSignTypedData();
  const { address: walletAddress } = useAccount();
  const connectors = useConnectors();
  const getWalletAddress = () => walletAddress as `0x${string}` | undefined;
  /**
   * Open MetaMask's account picker so the user can switch to whichever
   * account matches the signer's seat. Resolves to the post-switch
   * address (or undefined if the user dismissed the picker).
   */
  const promptSwitchWalletAccount = async (): Promise<`0x${string}` | undefined> => {
    const injected = connectors.find((c) => c.id === 'injected') ?? connectors[0];
    if (!injected) return undefined;
    try {
      // Talk to MetaMask's injected provider directly. We DO NOT
      // disconnect + reconnect via wagmi — that races wagmi's own
      // state machine and trips "Connector already connected".
      // `wallet_requestPermissions` always opens the account picker.
      // After the user picks, read the address via eth_accounts;
      // wagmi's useAccount updates on its own via accountsChanged.
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
        return undefined; // user dismissed picker
      }
      const accounts = (await provider.request({
        method: 'eth_accounts',
      })) as string[] | undefined;
      return (accounts?.[0] as `0x${string}` | undefined) ?? undefined;
    } catch {
      return undefined;
    }
  };
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
      // If every Bob identity is already a custodian (e.g. Act 3
      // already completed), close the dialog and show the summary
      // card. Must check passkey PIA AND SIWE EOA — Bob may have
      // enrolled either or both, and a SIWE-only Bob was missed by
      // the earlier passkey-only probe so the dialog kept re-opening
      // after a clean run.
      if (!bobClaim) return;
      const bobPasskeyAuth = getPasskeyAuth(bobClaim);
      const bobSiweAuth = getSiweAuth(bobClaim);
      const bobIdents: `0x${string}`[] = [
        ...(bobPasskeyAuth ? [bobPasskeyAuth.pia] : []),
        ...(bobSiweAuth ? [bobSiweAuth.eoa] : []),
      ];
      if (bobIdents.length === 0) return;
      const checks = await Promise.all(
        bobIdents.map((id) => readIsCustodian({ account: org.address, signer: id })),
      );
      if (checks.every(Boolean)) {
        setBobCustodyConfirmed(true);
        setDialogOpen(false);
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
        <p>The Org\'s only passkey custodian is needed to sign for the AddPasskeyCredential change.</p>
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
            <code> AddPasskeyCredential(Bob) </code> change on the Org.
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

  // Stale Org deployed before the safety-delay-fix path (or with a
  // value tall enough to break the same-session demo flow). The
  // schedule step would still work but the apply step would revert
  // with "ProposalNotReady" for an hour. 1-2 seconds is acceptable
  // — Base Sepolia mines every ~2s so the eta passes before the
  // apply userOp gets bundled.
  if (safetyDelaySeconds !== null && safetyDelaySeconds > 10) {
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
            AddPasskeyCredential change on the Org\'s behalf.
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
    const alicePasskeyAuth = getPasskeyAuth(aliceClaim);
    const aliceSiweAuth = getSiweAuth(aliceClaim);
    if (!alicePasskeyAuth && !aliceSiweAuth) {
      setStage('error');
      setError('Alice has no enrolled auth method — re-claim her seat.');
      return;
    }
    // Passkey is only needed if Alice will sign via WebAuthn. For SIWE-only
    // Alice we'll sign via wagmi and relay through the worker.
    const alicePasskey = alicePasskeyAuth ? (getPasskeyForSeat(aliceSeat.id) ?? undefined) : undefined;
    if (alicePasskeyAuth && !alicePasskey) {
      setStage('error');
      setError(`${aliceSeat.name}'s passkey enrolment is missing on this device. Reclaim her seat with the same passkey.`);
      return;
    }

    setStage('working');
    setError(null);

    if (!bobSeat) {
      setStage('error');
      setError('Org config has no second seat — check ORG_SEAT_LABELS env.');
      return;
    }
    const bobPasskeyAuth = getPasskeyAuth(bobClaim);
    const bobSiweAuth = getSiweAuth(bobClaim);
    const bobPasskey = bobPasskeyAuth ? (getPasskeyForSeat(bobSeat.id) ?? undefined) : undefined;
    if (bobPasskeyAuth && !bobPasskey) {
      setStage('error');
      setError(`${bobSeat.name}'s passkey enrolment is missing on this device.`);
      return;
    }
    if (!bobPasskeyAuth && !bobSiweAuth) {
      setStage('error');
      setError('Bob has no enrolled identity — re-claim his seat with passkey and/or wallet.');
      return;
    }

    try {
      // Register EVERY one of Bob's enrolled identities on the Org. If
      // both are enrolled (passkey + SIWE), run two ceremonies in
      // sequence — one AddPasskeyCredential, one AddCustodian. Skip
      // identities that are already on chain (e.g. partial prior run).
      let lastScheduleTx: `0x${string}` | null = null;
      let lastApplyTx: `0x${string}` | null = null;

      if (bobPasskeyAuth) {
        const already = await readIsCustodian({
          account: org.address,
          signer: bobPasskeyAuth.pia,
        });
        if (!already) {
          const step = await scheduleAndApply({
            account: org.address,
            action: CustodyAction.AddPasskeyCredential,
            innerArgs: buildAddPasskeyCredentialArgs(
              bobPasskeyAuth.credentialIdDigest,
              bobPasskeyAuth.pubKeyX,
              bobPasskeyAuth.pubKeyY,
            ),
            signers: [{
              seat: aliceClaim,
              passkey: alicePasskey,
              signTypedDataAsync: async (a) =>
                (await signTypedDataAsync({
                  domain: a.domain,
                  types: a.types,
                  primaryType: a.primaryType,
                  message: a.message,
                  account: a.account,
                })) as Hex,
              getWalletAddress,
              promptSwitchWalletAccount,
            }],
            setPhase: setPhase as (p: 'computing-hash' | 'signing-schedule' | 'submitting-schedule' | 'reading-eta' | 'signing-apply' | 'submitting-apply') => void,
          });
          if ('error' in step) {
            setStage('error');
            setError(`AddPasskey(Bob) on Org: ${step.error}`);
            return;
          }
          lastScheduleTx = step.scheduleTx;
          lastApplyTx = step.applyTx;
        }
      }

      if (bobSiweAuth) {
        const already = await readIsCustodian({
          account: org.address,
          signer: bobSiweAuth.eoa,
        });
        if (!already) {
          const step = await scheduleAndApply({
            account: org.address,
            action: CustodyAction.AddCustodian,
            innerArgs: buildAddCustodianArgs(bobSiweAuth.eoa),
            signers: [{
              seat: aliceClaim,
              passkey: alicePasskey,
              signTypedDataAsync: async (a) =>
                (await signTypedDataAsync({
                  domain: a.domain,
                  types: a.types,
                  primaryType: a.primaryType,
                  message: a.message,
                  account: a.account,
                })) as Hex,
              getWalletAddress,
              promptSwitchWalletAccount,
            }],
            setPhase: setPhase as (p: 'computing-hash' | 'signing-schedule' | 'submitting-schedule' | 'reading-eta' | 'signing-apply' | 'submitting-apply') => void,
          });
          if ('error' in step) {
            setStage('error');
            setError(`AddCustodian(Bob.EOA) on Org: ${step.error}`);
            return;
          }
          lastScheduleTx = step.scheduleTx;
          lastApplyTx = step.applyTx;
        }
      }

      if (lastScheduleTx) setScheduleTx(lastScheduleTx);
      if (lastApplyTx) setApplyTx(lastApplyTx);

      // Verify every Bob identity is now a custodian on Org.
      setPhase('verifying');
      const bobIdentities: `0x${string}`[] = [
        ...(bobPasskeyAuth ? [bobPasskeyAuth.pia] : []),
        ...(bobSiweAuth ? [bobSiweAuth.eoa] : []),
      ];
      const verifyResults = await Promise.all(
        bobIdentities.map((id) =>
          readIsCustodian({ account: org.address, signer: id, waitForTrue: true }),
        ),
      );
      if (!verifyResults.every(Boolean)) {
        setStage('error');
        setError(
          `Bob's identities aren't all on Org yet — refresh in a moment: ${bobIdentities
            .map((id, i) => `${id.slice(0, 10)}…=${verifyResults[i] ? '✓' : '✗'}`)
            .join(' · ')}`,
        );
        return;
      }
      setBobCustodyConfirmed(true);
      setStage('success');
      // Kick TreasuryShell's act-progress probe immediately so the
      // next-action CTA advances without waiting for the interval tick.
      try { window.dispatchEvent(new Event('chain-state:update')); } catch {}
    } catch (e) {
      setStage('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section>
      <div className="hero">
        <p className="eyebrow">Act 3 · Admin · <LiveStatusBadge status="live" /></p>
        <h1>Add Bob\'s identities as custodians of {orgConfig.name}.</h1>
        <p>
          Alice (the founding custodian) schedules + applies a CustodyAction per
          identity Bob enrolled — <code>AddPasskeyCredential</code> for his passkey
          PIA, <code>AddCustodian</code> for his wallet EOA. After this lands, the
          Org recognizes every Bob identity but still requires only 1 approval
          (Act 4 bumps it to 2).
        </p>
      </div>

      {bobCustodyConfirmed && !dialogOpen && (
        <section className="card">
          <p className="eyebrow">Already complete</p>
          <h2>Bob is a custodian of {orgConfig.name}.</h2>
          <p className="muted">
            On-chain check: <code>Org.isCustodian(Bob\'s identity)</code> = <strong>true</strong>{' '}
            for every method Bob enrolled. Continue with Act 4 to make the Org require 2 approvals.
          </p>
          <a href="#/" className="primary">← Back to seat picker</a>
        </section>
      )}

      <ConnectionDialog
        open={dialogOpen}
        stage={stage}
        title={`Add ${bobSeat?.name ?? 'Bob'} as a custodian`}
        scopeList={[
          `Alice signs an EIP-712 ScheduleCustodyChangeRequest per ${bobSeat?.name} identity (AddPasskeyCredential and/or AddCustodian).`,
          `Alice signs an EIP-712 ApplyCustodyChangeRequest immediately after (0s safety delay).`,
          `${orgConfig.name}'s custodian set grows from {Alice's identities} → {Alice's + ${bobSeat?.name}'s identities}.`,
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
                Every identity Bob enrolled is now a custodian of {orgConfig.name}. Schedule + apply landed
                on chain (one ceremony per identity).
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
        onSwitchWallet={async () => {
          await promptSwitchWalletAccount();
        }}
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

