import { useEffect, useState } from 'react';
import type { Hex } from 'viem';
import { CustodyAction, buildRecoverAccountArgs } from '@agenticprimitives/custody';
import { loadSeats } from '../lib/seats';
import { loadRecoveryState, saveRecoveryState } from '../lib/recovery-state';
import { getPasskeyForSeat } from '../lib/passkey';
import { scheduleAndApply, type CeremonyPhase } from '../lib/custody-ceremony';

/**
 * Act 4 — Alice + Bob 2-of-2 recover Sam.
 *
 * Builds AgentAccountRecoveryArgs with the replacement passkey in
 * `addPasskeys` + the lost credential digest in
 * `removePasskeyCredentialIdDigests`. The atomic apply path means
 * Sam's PSA goes from "old key only" → "new key only" in one
 * transaction; no half-recovered intermediate state.
 *
 * The scheduleAndApply ceremony helper (Wave R1) takes signers as an
 * array. We pass [alice, bob] — both passkey-signers, each producing a
 * v=2 WebAuthn quorum slot. packQuorumSigs sorts ascending by PIA, so
 * the on-chain QuorumEnforcer-style threshold check passes for any
 * (alice, bob) ordering.
 */
export function Act4Recovery({ onComplete }: { onComplete: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<CeremonyPhase | null>(null);
  const [phaseSigner, setPhaseSigner] = useState<number | null>(null);
  const [waitTargetSec, setWaitTargetSec] = useState<number | null>(null);
  const [waitRemainingSec, setWaitRemainingSec] = useState<number | null>(null);

  // Tick the countdown every 250ms while a wait is active.
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
  if (!recovery.replacementCredentialIdDigest || !recovery.replacementPubKeyX || !recovery.replacementPubKeyY) {
    return (
      <section className="card act-section">
        <h2>Act 4 · Recovery</h2>
        <p className="act-error">Sam hasn't registered a replacement passkey yet (Act 3).</p>
      </section>
    );
  }
  if (!recovery.lostCredentialIdDigest) {
    return (
      <section className="card act-section">
        <h2>Act 4 · Recovery</h2>
        <p className="act-error">Sam hasn't declared his original passkey lost yet (Act 2).</p>
      </section>
    );
  }

  const handleRecover = async () => {
    setBusy(true);
    setError(null);
    try {
      const alicePasskey = getPasskeyForSeat('alice');
      const bobPasskey = getPasskeyForSeat('bob');
      if (!alicePasskey || !bobPasskey) {
        setError("Alice's or Bob's local passkey credential is missing on this device.");
        return;
      }

      // Build AgentAccountRecoveryArgs: atomic add-new + remove-old.
      // Wave H2 — single canonical encoder in @agenticprimitives/custody,
      // tested + range-checked. Wire-format mistakes surface here as
      // RangeError instead of opaque on-chain reverts.
      const innerArgs = buildRecoverAccountArgs({
        addPasskeys: [{
          credentialIdDigest: recovery.replacementCredentialIdDigest!,
          x: BigInt(recovery.replacementPubKeyX!),
          y: BigInt(recovery.replacementPubKeyY!),
        }],
        removePasskeyCredentialIdDigests: [recovery.lostCredentialIdDigest!],
      });

      const result = await scheduleAndApply({
        account: sam.personAgent,
        action: CustodyAction.RecoverAccount,
        innerArgs,
        signers: [
          { seat: alice, passkey: alicePasskey },
          { seat: bob, passkey: bobPasskey },
        ],
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
      <h2>Act 4 · Recovery</h2>
      <p className="act-intro">
        Alice and Bob both sign the T6 RecoverAccount schedule, the demo's
        1-second safety delay elapses, then both sign the apply. Sam's PSA
        atomically swaps from his lost passkey to his replacement passkey.
      </p>
      <ul className="trustee-list">
        <li>Target Smart Agent: <code>{sam.personAgent}</code></li>
        <li>Remove credential: <code>{recovery.lostCredentialIdDigest}</code></li>
        <li>Add credential: <code>{recovery.replacementCredentialIdDigest}</code></li>
        <li>New PIA: <code>{recovery.replacementPia}</code></li>
        <li>Required: 2-of-2 trustee approval (Alice + Bob)</li>
      </ul>
      {!alreadyApplied ? (
        <button type="button" disabled={busy} onClick={handleRecover}>
          {busy
            ? phaseLabel(phase, phaseSigner, waitRemainingSec)
            : 'Run recovery ceremony (Alice + Bob each sign twice)'}
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

// Recovery args encoding moved to @agenticprimitives/custody
// (buildRecoverAccountArgs) under Wave H2. The previous inline encoder
// is removed.

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
      if (waitRemainingSec !== null && waitRemainingSec > 0) {
        return `Waiting ${waitRemainingSec}s for safety delay…`;
      }
      return 'Waiting for safety delay…';
    case 'signing-apply': return `${who || 'Signing'} signs T6 apply…`;
    case 'submitting-apply': return 'Submitting apply tx…';
  }
}
