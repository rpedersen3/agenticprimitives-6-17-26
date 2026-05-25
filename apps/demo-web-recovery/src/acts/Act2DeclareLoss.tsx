import { loadSeats } from '../lib/seats';
import {
  loadRecoveryState,
  saveRecoveryState,
  credentialLabel,
  type RecoveryCredential,
} from '../lib/recovery-state';
import { useState } from 'react';

/**
 * Act 2 — Sam declares his control credential lost.
 *
 * UI-only — no chain action. Works for either credential kind: a lost
 * passkey OR a lost wallet/EOA. We record the lost credential in
 * recovery state and refuse to sign with it from here on. The on-chain
 * custodian record is untouched; Act 4 rotates AUTHORITY away from it.
 */
export function Act2DeclareLoss({ onComplete }: { onComplete: () => void }) {
  const seats = loadSeats();
  const sam = seats['sam'];
  const recovery = loadRecoveryState();
  const [declared, setDeclared] = useState(!!recovery.declaredLostAt);

  if (!sam) {
    return (
      <section className="card act-section">
        <h2>Act 2 · Sam's credential is lost</h2>
        <p className="act-error">Sam isn't onboarded yet (Act 1).</p>
      </section>
    );
  }

  const method = sam.authMethods[0];
  if (!method) {
    return (
      <section className="card act-section">
        <h2>Act 2 · Sam's credential is lost</h2>
        <p className="act-error">Sam has no enrolled credential.</p>
      </section>
    );
  }

  const lost: RecoveryCredential =
    method.kind === 'passkey'
      ? {
          kind: 'passkey',
          credentialIdDigest: method.credentialIdDigest,
          pia: method.pia,
          pubKeyX: method.pubKeyX.toString(),
          pubKeyY: method.pubKeyY.toString(),
        }
      : { kind: 'eoa', address: method.eoa };

  const handleDeclareLost = () => {
    saveRecoveryState({ lostCredential: lost, declaredLostAt: new Date().toISOString() });
    setDeclared(true);
  };

  return (
    <section className="card act-section">
      <h2>Act 2 · Sam's credential is lost</h2>
      <p className="act-intro">
        Sam can no longer use his control credential — a lost passkey device, or a
        wallet whose key he no longer has. His Smart Agent's identity is unchanged:
        the SA address still exists, still holds its delegations, still owns its name.
        Only the control credential is unusable. Act 4 rotates it out through the
        trustee-quorum custody policy.
      </p>
      <ul className="trustee-list">
        <li>Lost credential: <strong>{credentialLabel(lost)}</strong></li>
        <li>
          {lost.kind === 'passkey'
            ? <>Digest: <code>{lost.credentialIdDigest}</code></>
            : <>EOA: <code>{lost.address}</code></>}
        </li>
        <li>Status after this act: <strong>declared lost</strong> (UI marker only)</li>
      </ul>
      {!declared ? (
        <button type="button" onClick={handleDeclareLost}>
          Mark Sam's credential as lost
        </button>
      ) : (
        <div className="act-success">
          ✓ Marked lost at {recovery.declaredLostAt}. The demo refuses to sign with
          Sam's original credential from here on.
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
