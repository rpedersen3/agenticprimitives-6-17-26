import { useState } from 'react';
import { useAccount } from 'wagmi';
import { registerPasskeyForSeat, savePasskeyForSeat } from '../lib/passkey';
import {
  loadRecoveryState,
  saveRecoveryState,
  credentialLabel,
  type RecoveryCredential,
} from '../lib/recovery-state';
import { passkeyIdentity, type EnrollChoice } from '../lib/enroll';
import { EnrollmentChoice } from '../components/EnrollmentChoice';

/**
 * Act 3 — Sam stages a replacement credential.
 *
 * Either a brand-new passkey on this device OR a new wallet/EOA. It is
 * NOT authoritative yet — Act 4's trustee-quorum ceremony installs it
 * (add new + remove old, atomic). For the passkey path we compute the
 * PIA off-chain; for the wallet path the EOA is the owner to add.
 */
export function Act3ReplacePasskey({ onComplete }: { onComplete: () => void }) {
  const recovery = loadRecoveryState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<EnrollChoice>('passkey');
  const registered = !!recovery.replacementCredential;
  const { address: walletAddress } = useAccount();

  const handleRegister = async () => {
    setBusy(true);
    setError(null);
    try {
      let replacement: RecoveryCredential;
      if (choice === 'siwe') {
        if (!walletAddress) throw new Error('Connect the replacement wallet account first.');
        if (
          recovery.lostCredential?.kind === 'eoa' &&
          recovery.lostCredential.address.toLowerCase() === walletAddress.toLowerCase()
        ) {
          throw new Error('Replacement wallet must differ from the lost one — switch MetaMask accounts.');
        }
        replacement = { kind: 'eoa', address: walletAddress };
      } else {
        const newPasskey = await registerPasskeyForSeat('sam-replacement', 'Sam (replacement)');
        savePasskeyForSeat('sam-replacement', newPasskey);
        replacement = {
          kind: 'passkey',
          credentialIdDigest: newPasskey.credentialIdDigest,
          pia: passkeyIdentity(newPasskey.pubKeyX, newPasskey.pubKeyY),
          pubKeyX: newPasskey.pubKeyX.toString(),
          pubKeyY: newPasskey.pubKeyY.toString(),
        };
      }
      saveRecoveryState({ replacementCredential: replacement });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card act-section">
      <h2>Act 3 · Stage a replacement credential</h2>
      <p className="act-intro">
        Sam creates a brand-new control credential — a new passkey on this device,
        or a different wallet account. It's staged, not yet authoritative. Act 4's
        trustee-quorum custody ceremony adds it to Sam's Smart Agent and removes the
        lost credential atomically, so there's no half-recovered state.
      </p>
      {registered ? (
        <div className="act-success">
          <div>✓ Replacement credential staged.</div>
          <ul className="trustee-list">
            <li>New credential: <strong>{credentialLabel(recovery.replacementCredential)}</strong></li>
          </ul>
        </div>
      ) : (
        <>
          <EnrollmentChoice choice={choice} onChoice={setChoice} idPrefix="replacement" />
          <button type="button" disabled={busy} onClick={handleRegister}>
            {busy
              ? 'Staging…'
              : choice === 'siwe'
                ? 'Stage replacement wallet'
                : 'Register replacement passkey'}
          </button>
        </>
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
