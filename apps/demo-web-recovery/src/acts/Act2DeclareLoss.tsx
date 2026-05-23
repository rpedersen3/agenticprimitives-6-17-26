import { loadSeats } from '../lib/seats';
import { loadRecoveryState, saveRecoveryState } from '../lib/recovery-state';
import { useState } from 'react';

/**
 * Act 2 — Sam declares his passkey lost.
 *
 * UI-only — no chain action. We mark Sam's original passkey as
 * "unavailable" in recovery state and refuse to use it for signing
 * from this point forward. The on-chain credential record is still
 * present (production can't delete a platform passkey from a
 * website); recovery in Act 4 rotates AUTHORITY away from it.
 */
export function Act2DeclareLoss({ onComplete }: { onComplete: () => void }) {
  const seats = loadSeats();
  const sam = seats['sam'];
  const recovery = loadRecoveryState();
  const [declared, setDeclared] = useState(!!recovery.declaredLostAt);

  if (!sam) {
    return (
      <section className="card act-section">
        <h2>Act 2 · Sam's passkey is lost</h2>
        <p className="act-error">Sam isn't onboarded yet (Act 1).</p>
      </section>
    );
  }

  const samPasskey = sam.authMethods.find((m) => m.kind === 'passkey');
  if (!samPasskey || samPasskey.kind !== 'passkey') {
    return (
      <section className="card act-section">
        <h2>Act 2 · Sam's passkey is lost</h2>
        <p className="act-error">Sam has no passkey enrolled.</p>
      </section>
    );
  }

  const handleDeclareLost = () => {
    saveRecoveryState({
      lostCredentialIdDigest: samPasskey.credentialIdDigest,
      declaredLostAt: new Date().toISOString(),
    });
    setDeclared(true);
  };

  return (
    <section className="card act-section">
      <h2>Act 2 · Sam's passkey is lost</h2>
      <p className="act-intro">
        Sam can no longer access his passkey (lost device, factory reset, broken
        biometric, whatever). The on-chain record of the passkey still exists —
        but Sam isn't able to produce a WebAuthn assertion against it any more.
        Recovery in Act 4 will rotate his Smart Agent's custody away from it.
      </p>
      <ul className="trustee-list">
        <li>Original credential digest: <code>{samPasskey.credentialIdDigest}</code></li>
        <li>Original PIA: <code>{samPasskey.pia}</code></li>
        <li>Status after this act: <strong>declared lost</strong> (UI marker only)</li>
      </ul>
      {!declared ? (
        <button type="button" onClick={handleDeclareLost}>
          Mark Sam's passkey as lost
        </button>
      ) : (
        <div className="act-success">
          ✓ Marked lost at {recovery.declaredLostAt}. The demo will refuse to sign
          with Sam's original passkey from here on.
        </div>
      )}
      <div className="act-footer">
        <button type="button" disabled={!declared} onClick={onComplete}>
          Continue to Act 3 →
        </button>
      </div>
    </section>
  );
}
