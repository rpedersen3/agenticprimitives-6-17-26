import { useState } from 'react';
import { type Address } from 'viem';
import { useAccount, useWalletClient } from 'wagmi';
import { loadSeats, claimSeat, type SeatClaim } from '../lib/seats';
import { enrollCredential, directDeploy, primaryIdentity, seatBoundToEoa, type EnrollChoice } from '../lib/enroll';
import { claimPsaName, claimPsaNameViaEoa } from '../lib/claim-psa-name';
import { setCachedName } from '../lib/name-cache';
import { NameDisplay } from '../components/NameDisplay';
import { EnrollmentChoice } from '../components/EnrollmentChoice';
import { config } from '../config';

/**
 * Act 1 — Sam onboards as a recovery-capable Person, via passkey OR
 * wallet (SIWE/EOA). His PSA deploys with:
 *   - mode = 1 (CustodyPolicy installed)
 *   - custodian = Sam's enrolled identity (PIA or EOA)
 *   - trustees = Alice's + Bob's enrolled identities (PIA or EOA)
 *   - recoveryApprovals = floor(2/2)+1 = 2  (factory default)
 *
 * Sam alone controls day-to-day; Alice + Bob together can rotate his
 * credential set if he loses access (Act 4).
 */
export function Act1SamOnboard({ onComplete }: { onComplete: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<EnrollChoice>('passkey');
  const [deployedAddress, setDeployedAddress] = useState<Address | null>(() => {
    return loadSeats()['sam']?.personAgent ?? null;
  });
  const [psaName, setPsaName] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const { address: walletAddress } = useAccount();
  const { data: walletClient } = useWalletClient();

  const seats = loadSeats();
  const alice = seats['alice'];
  const bob = seats['bob'];

  if (!alice || !bob) {
    return (
      <section className="card act-section">
        <h2>Act 1 · Sam joins</h2>
        <p className="act-error">Alice and Bob must be enrolled first (Act 0).</p>
      </section>
    );
  }

  const aliceId = primaryIdentity(alice);
  const bobId = primaryIdentity(bob);

  const handleOnboard = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!config.demoA2aUrl) throw new Error('demo-a2a URL not configured');
      // Sam needs his OWN wallet — distinct from Alice's and Bob's, or
      // his PSA collides with a trustee's CREATE2 address.
      if (choice === 'siwe') {
        if (!walletAddress) {
          setError('Connect Sam\'s wallet account first.');
          return;
        }
        const clash = seatBoundToEoa(walletAddress as `0x${string}`, 'sam');
        if (clash) {
          setError(
            `This wallet (${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}) is already ${clash}'s. ` +
              `Switch MetaMask to a fresh account for Sam, then retry.`,
          );
          return;
        }
      }
      const cred = await enrollCredential({
        seatId: 'sam',
        name: 'Sam',
        choice,
        eoa: walletAddress as `0x${string}` | undefined,
      });
      // T4=1s admin / T6=10s recovery — demo-only short delays.
      const samAccount = await directDeploy({
        credential: cred,
        trustees: [aliceId, bobId],
        timelockOverrides: [0, 0, 0, 0, 1, 0, 10],
      });
      const claim: SeatClaim = {
        seatId: 'sam',
        personAgent: samAccount,
        authMethods: [cred.authMethod],
        claimedAt: new Date().toISOString(),
      };
      claimSeat(claim);
      setDeployedAddress(samAccount);

      // Best-effort name claim — passkey (gasless) or EOA (wallet signs
      // the userOpHash). Sam is the last enrolment, so the connected
      // account stays Sam's through the claim. Failure is non-fatal.
      if (cred.passkey) {
        const pk = cred.passkey;
        void (async () => {
          const result = await claimPsaName({ baseLabel: 'sam', personAgent: samAccount, passkey: pk });
          if (result.ok) {
            setPsaName(result.name);
            setCachedName(samAccount, result.name);
          } else {
            setNameError(result.reason);
          }
        })();
      } else if (walletClient && cred.authMethod.kind === 'siwe') {
        const wc = walletClient;
        const eoa = cred.identity;
        void (async () => {
          const result = await claimPsaNameViaEoa({ baseLabel: 'sam', personAgent: samAccount, walletClient: wc, account: eoa });
          if (result.ok) {
            setPsaName(result.name);
            setCachedName(samAccount, result.name);
          } else {
            setNameError(result.reason);
          }
        })();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card act-section">
      <h2>Act 1 · Sam joins (recovery-capable)</h2>
      <p className="act-intro">
        Sam's canonical Smart Agent is deployed with a passkey OR a wallet as its
        control credential. Recovery is configured at birth: Alice + Bob together
        (2-of-2) are trustees authorized to rotate Sam's control credential set if he
        loses access. Sam's Smart Agent address is the identity; the credential is a facet.
      </p>
      <ul className="trustee-list">
        <li>Trustee 1 · Alice <code>{shortAddr(aliceId)}</code></li>
        <li>Trustee 2 · Bob <code>{shortAddr(bobId)}</code></li>
        <li>Recovery approvals required: <strong>2-of-2</strong></li>
        <li>T6 safety delay: 10 seconds (demo); production default 48 h</li>
      </ul>
      {!deployedAddress ? (
        <>
          <EnrollmentChoice choice={choice} onChoice={setChoice} idPrefix="sam" />
          <button type="button" disabled={busy} onClick={handleOnboard}>
            {busy
              ? 'Deploying…'
              : choice === 'siwe'
                ? 'Onboard Sam (connect wallet + deploy PSA)'
                : 'Onboard Sam (enroll passkey + deploy PSA)'}
          </button>
        </>
      ) : (
        <div className="act-success">
          ✓ Sam's PSA deployed at <code>{deployedAddress}</code>
          <div style={{ marginTop: 6, fontSize: 13 }}>
            <span style={{ opacity: 0.7 }}>Name (facet):</span>{' '}
            {psaName ? (
              <strong><NameDisplay address={deployedAddress} /></strong>
            ) : nameError ? (
              <span style={{ color: '#b45309' }}>⚠ auto-claim skipped — {nameError}</span>
            ) : (
              <NameDisplay address={deployedAddress} />
            )}
          </div>
        </div>
      )}
      {error && <div className="act-error">{error}</div>}
      <div className="act-footer">
        <button type="button" disabled={!deployedAddress} onClick={onComplete}>
          Continue to Act 2 →
        </button>
      </div>
    </section>
  );
}

function shortAddr(a: Address): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
