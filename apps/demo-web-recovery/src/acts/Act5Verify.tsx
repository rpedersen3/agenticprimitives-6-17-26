import { useEffect, useState } from 'react';
import { loadSeats } from '../lib/seats';
import { loadRecoveryState, clearRecoveryState, credentialIdentity } from '../lib/recovery-state';
import { readIsCustodian } from '../lib/chain-reads';
import { releaseSeat } from '../lib/seats';
import { NameDisplay } from '../components/NameDisplay';
import type { Address } from 'viem';

/**
 * Act 5 — Verification.
 *
 * On-chain probe: Sam's PSA should now report
 *   isCustodian(replacementPia) == true
 *   isCustodian(oldPia)         == false
 *
 * This is the source-of-truth check that the recovery actually
 * mutated state. UI shows both probes side-by-side.
 */
export function Act5Verify() {
  const seats = loadSeats();
  const recovery = loadRecoveryState();
  const sam = seats['sam'];
  // Old / new on-chain identities come from the recorded credentials
  // (passkey PIA or EOA), so verification works for either kind.
  const oldPia = recovery.lostCredential ? credentialIdentity(recovery.lostCredential) : null;
  const newPia = recovery.replacementCredential ? credentialIdentity(recovery.replacementCredential) : null;

  const [newOk, setNewOk] = useState<boolean | null>(null);
  const [oldOk, setOldOk] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bind to STABLE addresses (strings), not the SeatClaim object —
  // loadSeats() returns a fresh object reference every render, which
  // would re-fire this effect forever and loop the RPC call.
  const samAddr = sam?.personAgent ?? null;
  useEffect(() => {
    if (!samAddr || !newPia || !oldPia) return;
    let cancelled = false;
    setChecking(true);
    Promise.all([
      readIsCustodian({ account: samAddr, signer: newPia, waitForTrue: true }),
      readIsCustodian({ account: samAddr, signer: oldPia }),
    ])
      .then(([nOk, oOk]) => {
        if (cancelled) return;
        setNewOk(nOk);
        setOldOk(oOk);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => { cancelled = true; };
  }, [samAddr, newPia, oldPia]);

  if (!sam) {
    return (
      <section className="card act-section">
        <h2>Act 5 · Verify</h2>
        <p className="act-error">Sam isn't onboarded.</p>
      </section>
    );
  }

  const handleReset = () => {
    if (!confirm('Reset the recovery demo? This clears Sam + recovery state but keeps Alice + Bob.')) return;
    releaseSeat('sam');
    clearRecoveryState();
  };

  const verdictNew = newOk === null ? '⏳' : newOk ? '✓' : '✗';
  const verdictOld = oldOk === null ? '⏳' : oldOk ? '✗ (still on chain!)' : '✓ (removed)';

  return (
    <section className="card act-section">
      <h2>Act 5 · Verify (same Smart Agent, new credential)</h2>
      <p className="act-intro">
        On-chain probes confirm the rotation. The replacement credential's PIA is
        now a custodian of Sam's Smart Agent; the lost credential's PIA is no
        longer recognized. Sam's canonical Smart Agent address is unchanged.
      </p>
      <ul className="trustee-list">
        <li>
          Canonical Smart Agent: <strong><NameDisplay address={sam.personAgent} /></strong>{' '}
          <code>{sam.personAgent}</code> (name + address both unchanged)
        </li>
        <li>New credential PIA <code>{newPia}</code>: <strong>{verdictNew}</strong></li>
        <li>Old credential PIA <code>{oldPia}</code>: <strong>{verdictOld}</strong></li>
        <li>Recovery applied at: {recovery.recoveredAt ?? '(not yet)'}</li>
      </ul>
      {checking && <div>Querying chain…</div>}
      {error && <div className="act-error">{error}</div>}
      {newOk === true && oldOk === false && (
        <div className="act-success">
          ✓ Credential recovery verified. Sam's canonical Smart Agent identity is
          unchanged — same address, same name, same profile, same delegations.
          The control-credential set rotated through the SA's custody policy.
        </div>
      )}
      <div className="act-footer">
        <button type="button" onClick={handleReset}>Reset recovery demo</button>
      </div>
    </section>
  );
}
