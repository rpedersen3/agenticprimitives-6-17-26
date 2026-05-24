import { useState } from 'react';
import { keccak256, encodeAbiParameters, type Address, type Hex } from 'viem';
import { loadSeats, claimSeat, type SeatClaim } from '../lib/seats';
import { registerPasskeyForSeat, savePasskeyForSeat } from '../lib/passkey';
import { config } from '../config';

/**
 * Act 1 — Sam onboards as a recovery-capable Person.
 *
 * Sam registers a passkey, then deploys his PSA via the worker's
 * direct-deploy endpoint with:
 *   - mode = 1 (CustodyPolicy installed)
 *   - custodians = [Sam.PIA]
 *   - trustees = [Alice.PIA, Bob.PIA]
 *   - recoveryApprovals = floor(2/2)+1 = 2  (factory default)
 *
 * This is the canonical recovery-capable shape — Sam alone controls
 * day-to-day; Alice + Bob together can rotate his custody if his
 * passkey is lost.
 */
export function Act1SamOnboard({ onComplete }: { onComplete: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deployedAddress, setDeployedAddress] = useState<Address | null>(() => {
    return loadSeats()['sam']?.personAgent ?? null;
  });

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

  const alicePia = passkeyAuthOf(alice).pia;
  const bobPia = passkeyAuthOf(bob).pia;

  const handleOnboard = async () => {
    setBusy(true);
    setError(null);
    try {
      const passkey = await registerPasskeyForSeat('sam', 'Sam');
      savePasskeyForSeat('sam', passkey);
      const samPia = passkeyIdentity(passkey.pubKeyX, passkey.pubKeyY);

      // Sam deploys with Alice + Bob as recovery trustees. The factory
      // computes recoveryApprovals as floor(N_trustees/2)+1 = 2-of-2.
      if (!config.demoA2aUrl) throw new Error('demo-a2a URL not configured');
      const { ensureCsrfToken, csrfHeaders } = await import('../lib/csrf');
      await ensureCsrfToken();
      const baseTrimmed = config.demoA2aUrl.replace(/\/$/, '');
      const res = await fetch(`${baseTrimmed}/session/direct-deploy`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({
          mode: 1,
          custodians: [],
          trustees: [alicePia, bobPia],
          initialPasskeyCredentialIdDigest: passkey.credentialIdDigest,
          initialPasskeyX: passkey.pubKeyX.toString(),
          initialPasskeyY: passkey.pubKeyY.toString(),
          // T4=1s admin / T6=10s recovery — demo-only shortcuts so the
          // user doesn't wait minutes between schedule + apply. Real
          // product defaults to T4=1h / T6=48h.
          timelockOverrides: [0, 0, 0, 0, 1, 0, 10],
          salt: '0',
        }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      if (!res.ok || body.ok !== true) {
        setError(typeof body.error === 'string' ? body.error : `HTTP ${res.status}`);
        return;
      }
      const samAccount = body.deployedAddress as Address;
      const claim: SeatClaim = {
        seatId: 'sam',
        personAgent: samAccount,
        authMethods: [{
          kind: 'passkey',
          credentialIdDigest: passkey.credentialIdDigest,
          pubKeyX: passkey.pubKeyX,
          pubKeyY: passkey.pubKeyY,
          pia: samPia,
        }],
        claimedAt: new Date().toISOString(),
      };
      claimSeat(claim);
      setDeployedAddress(samAccount);
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
        Sam's canonical Smart Agent is deployed with a passkey as its control
        credential. Recovery is configured at birth: Alice + Bob together (2-of-2)
        are trustees authorized to rotate Sam's control credential set if his passkey
        is lost. Sam's Smart Agent address is the identity; the passkey is a facet.
      </p>
      <ul className="trustee-list">
        <li>Trustee 1 · Alice <code>{shortAddr(alicePia)}</code></li>
        <li>Trustee 2 · Bob <code>{shortAddr(bobPia)}</code></li>
        <li>Recovery approvals required: <strong>2-of-2</strong></li>
        <li>T6 safety delay: 1 second (demo); production default 48 h</li>
      </ul>
      {!deployedAddress ? (
        <button type="button" disabled={busy} onClick={handleOnboard}>
          {busy ? 'Deploying…' : 'Onboard Sam (enroll passkey + deploy PSA)'}
        </button>
      ) : (
        <div className="act-success">
          ✓ Sam's PSA deployed at <code>{deployedAddress}</code>
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

function passkeyAuthOf(seat: SeatClaim) {
  const m = seat.authMethods.find((m) => m.kind === 'passkey');
  if (!m || m.kind !== 'passkey') throw new Error(`seat ${seat.seatId} has no passkey auth method`);
  return m;
}

function passkeyIdentity(x: bigint, y: bigint): Address {
  const h = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [x, y]));
  return ('0x' + h.slice(-40)) as Address;
}

function shortAddr(a: Address | Hex): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
