import { useState } from 'react';
import { keccak256, encodeAbiParameters, type Address } from 'viem';
import { registerPasskeyForSeat, savePasskeyForSeat } from '../lib/passkey';
import { loadRecoveryState, saveRecoveryState } from '../lib/recovery-state';

/**
 * Act 3 — Sam registers a replacement passkey.
 *
 * WebAuthn ceremony only. We compute the new PIA off-chain (PIA =
 * keccak256(abi.encode(x, y))[12:32]) and stash it in recovery state.
 * The replacement isn't an authority yet — Act 4 is what installs it
 * via T6 RecoverAccount.
 */
export function Act3ReplacePasskey({ onComplete }: { onComplete: () => void }) {
  const recovery = loadRecoveryState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(!!recovery.replacementCredentialIdDigest);

  const handleRegister = async () => {
    setBusy(true);
    setError(null);
    try {
      // We use a synthetic seatId so the replacement passkey can be
      // looked up under a name that won't collide with Sam's lost one
      // in passkey.ts's local store.
      const newPasskey = await registerPasskeyForSeat('sam-replacement', 'Sam (replacement)');
      // Persist locally so the assertion flow can find it later (Act 5
      // verification + any future "log in as recovered Sam" path).
      savePasskeyForSeat('sam-replacement', newPasskey);
      const pia = passkeyIdentity(newPasskey.pubKeyX, newPasskey.pubKeyY);
      saveRecoveryState({
        replacementCredentialIdDigest: newPasskey.credentialIdDigest,
        replacementPubKeyX: newPasskey.pubKeyX.toString(),
        replacementPubKeyY: newPasskey.pubKeyY.toString(),
        replacementPia: pia,
      });
      setRegistered(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card act-section">
      <h2>Act 3 · Register a replacement credential</h2>
      <p className="act-intro">
        Sam creates a brand-new passkey credential on his current device. It is
        staged — not yet authoritative. Until Act 4's trustee-quorum custody
        ceremony adds it to Sam's Smart Agent and removes the lost credential, the
        Smart Agent's on-chain custodian set still only recognizes the original.
        Pre-registering here lets Act 4 do the rotation atomically (add new +
        remove old in one transaction) so there's no half-recovered state.
      </p>
      {registered ? (
        <div className="act-success">
          <div>✓ Replacement passkey registered.</div>
          <ul className="trustee-list">
            <li>New credential digest: <code>{recovery.replacementCredentialIdDigest}</code></li>
            <li>New PIA: <code>{recovery.replacementPia}</code></li>
          </ul>
        </div>
      ) : (
        <button type="button" disabled={busy} onClick={handleRegister}>
          {busy ? 'Awaiting passkey ceremony…' : 'Register replacement passkey'}
        </button>
      )}
      {error && <div className="act-error">{error}</div>}
      <div className="act-footer">
        <button type="button" disabled={!registered} onClick={onComplete}>
          Continue to Act 4 →
        </button>
      </div>
    </section>
  );
}

function passkeyIdentity(x: bigint, y: bigint): Address {
  const h = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [x, y]));
  return ('0x' + h.slice(-40)) as Address;
}
