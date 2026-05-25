import { useEffect, useState } from 'react';
import { useAccount, useConnectors, useSignTypedData } from 'wagmi';
import { CustodyAction, buildRecoverAccountArgs } from '@agenticprimitives/custody';
import { loadSeats, getPasskeyAuth, type SeatClaim } from '../lib/seats';
import { loadRecoveryState, saveRecoveryState, credentialLabel } from '../lib/recovery-state';
import { getPasskeyForSeat } from '../lib/passkey';
import { scheduleAndApply, type CeremonyPhase, type CeremonySigner } from '../lib/custody-ceremony';
import { promptSwitchWalletAccount } from '../components/EnrollmentChoice';
import { NameDisplay } from '../components/NameDisplay';

/**
 * Act 4 — Alice + Bob 2-of-2 recover Sam.
 *
 * Builds AgentAccountRecoveryArgs from the recorded credential kinds:
 * a lost passkey → `removePasskeyCredentialIdDigests`; a lost EOA →
 * `removeOwners`; likewise the replacement → `addPasskeys` / `addOwners`.
 * Each trustee signs with whatever they enrolled — passkey (gasless v=2
 * WebAuthn slot) or wallet (ECDSA via signTypedData). The custody
 * ceremony packs both into the quorum.
 */
export function Act4Recovery({ onComplete }: { onComplete: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<CeremonyPhase | null>(null);
  const [phaseSigner, setPhaseSigner] = useState<number | null>(null);
  const [waitTargetSec, setWaitTargetSec] = useState<number | null>(null);
  const [waitRemainingSec, setWaitRemainingSec] = useState<number | null>(null);

  const { address: walletAddress } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const connectors = useConnectors();

  useEffect(() => {
    if (waitTargetSec === null) {
      setWaitRemainingSec(null);
      return;
    }
    const tick = () => {
      const r = Math.max(0, waitTargetSec - Math.floor(Date.now() / 1000));
      setWaitRemainingSec(r);
      if (r === 0) setWaitTargetSec(null);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [waitTargetSec]);

  const seats = loadSeats();
  const recovery = loadRecoveryState();
  const alice = seats['alice'];
  const bob = seats['bob'];
  const sam = seats['sam'];

  const alreadyApplied = !!recovery.applyTx;

  if (!alice || !bob || !sam) {
    return (
      <section className="card act-section">
        <h2>Act 4 · Recovery</h2>
        <p className="act-error">Missing seats. Restart from Act 0.</p>
      </section>
    );
  }
  if (!recovery.replacementCredential) {
    return (
      <section className="card act-section">
        <h2>Act 4 · Recovery</h2>
        <p className="act-error">Sam hasn't staged a replacement credential yet (Act 3).</p>
      </section>
    );
  }
  if (!recovery.lostCredential) {
    return (
      <section className="card act-section">
        <h2>Act 4 · Recovery</h2>
        <p className="act-error">Sam hasn't declared his original credential lost yet (Act 2).</p>
      </section>
    );
  }

  /** Build a ceremony signer from a trustee seat's enrolled method. */
  const buildSigner = (seat: SeatClaim): CeremonySigner => {
    if (getPasskeyAuth(seat)) {
      const passkey = getPasskeyForSeat(seat.seatId);
      if (!passkey) {
        throw new Error(`${seat.seatId}'s passkey credential is missing on this device.`);
      }
      return { seat, passkey };
    }
    // SIWE/EOA trustee — sign via the connected wallet.
    return {
      seat,
      signTypedDataAsync: (a) =>
        signTypedDataAsync(a as Parameters<typeof signTypedDataAsync>[0]),
      getWalletAddress: () => walletAddress as `0x${string}` | undefined,
      promptSwitchWalletAccount: () => promptSwitchWalletAccount(connectors),
    };
  };

  const handleRecover = async () => {
    setBusy(true);
    setError(null);
    try {
      const lost = recovery.lostCredential!;
      const repl = recovery.replacementCredential!;

      // Atomic add-new + remove-old, generalised across credential kinds.
      const innerArgs = buildRecoverAccountArgs({
        addOwners: repl.kind === 'eoa' ? [repl.address] : [],
        removeOwners: lost.kind === 'eoa' ? [lost.address] : [],
        addPasskeys:
          repl.kind === 'passkey'
            ? [{ credentialIdDigest: repl.credentialIdDigest, x: BigInt(repl.pubKeyX), y: BigInt(repl.pubKeyY) }]
            : [],
        removePasskeyCredentialIdDigests: lost.kind === 'passkey' ? [lost.credentialIdDigest] : [],
      });

      let signers: CeremonySigner[];
      try {
        signers = [buildSigner(alice), buildSigner(bob)];
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }

      const result = await scheduleAndApply({
        account: sam.personAgent,
        action: CustodyAction.RecoverAccount,
        innerArgs,
        signers,
        setPhase: (p, idx) => {
          setPhase(p);
          setPhaseSigner(typeof idx === 'number' ? idx : null);
        },
        onWaitTarget: (etaUnix) => setWaitTargetSec(etaUnix),
      });
      if ('error' in result) {
        setError(result.error);
        return;
      }
      saveRecoveryState({
        scheduleTx: result.scheduleTx,
        applyTx: result.applyTx,
        recoveredAt: new Date().toISOString(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setPhase(null);
      setPhaseSigner(null);
      setWaitTargetSec(null);
    }
  };

  return (
    <section className="card act-section">
      <h2>Act 4 · Credential recovery (trustee quorum)</h2>
      <p className="act-intro">
        Custody-policy-governed credential rotation — <em>not</em> a delegation.
        Alice and Bob both sign the T6 <code>RecoverAccount</code> schedule (with
        their passkey or wallet), the demo's short safety delay elapses, then both
        sign the apply. The atomic transaction binds Sam's replacement credential and
        retires the lost one. Sam's Smart Agent address, name, profile, and any
        delegations are unchanged.
      </p>
      <ul className="trustee-list">
        <li>
          Canonical Smart Agent: <strong><NameDisplay address={sam.personAgent} /></strong>{' '}
          <code>{sam.personAgent}</code> (unchanged after recovery)
        </li>
        <li>Retire credential: <strong>{credentialLabel(recovery.lostCredential)}</strong></li>
        <li>Add credential: <strong>{credentialLabel(recovery.replacementCredential)}</strong></li>
        <li>Trustees: <strong>Alice + Bob</strong> (each signs with their enrolled passkey or wallet)</li>
        <li>Recovery mode: <strong>trustee-quorum</strong> (2-of-2)</li>
        <li>Authorized by: <strong>custody policy</strong> · <code>CustodyAction.RecoverAccount</code></li>
      </ul>
      {!alreadyApplied ? (
        <button type="button" disabled={busy} onClick={handleRecover}>
          {busy ? phaseLabel(phase, phaseSigner, waitRemainingSec) : 'Run recovery ceremony (Alice + Bob each sign twice)'}
        </button>
      ) : (
        <div className="act-success">
          <div>✓ Recovery applied.</div>
          <ul className="trustee-list">
            <li>Schedule tx: <code>{recovery.scheduleTx}</code></li>
            <li>Apply tx: <code>{recovery.applyTx}</code></li>
          </ul>
        </div>
      )}
      {error && <div className="act-error">{error}</div>}
      <div className="act-footer">
        <button type="button" disabled={!alreadyApplied} onClick={onComplete}>
          Continue to Act 5 →
        </button>
      </div>
    </section>
  );
}

function phaseLabel(
  phase: CeremonyPhase | null,
  signerIndex: number | null,
  waitRemainingSec: number | null,
): string {
  if (!phase) return 'Running…';
  const who = signerIndex === 0 ? 'Alice' : signerIndex === 1 ? 'Bob' : '';
  switch (phase) {
    case 'computing-hash': return 'Computing payload hash…';
    case 'signing-schedule': return `${who || 'Signing'} signs T6 schedule…`;
    case 'submitting-schedule': return 'Submitting schedule tx…';
    case 'reading-eta':
      if (waitRemainingSec !== null && waitRemainingSec > 0) return `Waiting ${waitRemainingSec}s for safety delay…`;
      return 'Waiting for safety delay…';
    case 'signing-apply': return `${who || 'Signing'} signs T6 apply…`;
    case 'submitting-apply': return 'Submitting apply tx…';
  }
}
