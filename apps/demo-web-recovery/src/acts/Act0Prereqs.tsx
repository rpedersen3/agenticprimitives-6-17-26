import { loadSeats, claimSeat, type SeatClaim } from '../lib/seats';
import { recoverySeats, type SeatId } from '../recovery-config';
import { registerPasskeyForSeat, savePasskeyForSeat } from '../lib/passkey';
import { config } from '../config';
import { useState, useEffect } from 'react';
import { keccak256, encodeAbiParameters, type Address } from 'viem';

/**
 * Act 0 — Prereqs.
 *
 * Two of the three seats (Alice + Bob) must be claimed before Sam can
 * onboard with them as trustees. This act lets the user claim Alice
 * and Bob locally (passkey enrolment + Person.PSA address derivation
 * via the factory's CREATE2 view; no on-chain deploy needed at this
 * stage — Alice's + Bob's PSAs only need to exist on chain when
 * they're asked to actually sign in Act 4, and even then the recovery
 * ceremony validates against Sam's account's custodian set, not
 * against deployed PSAs).
 *
 * For the demo we deploy Alice's + Bob's PSAs eagerly here so the
 * recovery story has real on-chain authorities — same shape as
 * demo-web-pro's seat-claim flow (mode=1, self-trustee bootstrap).
 */
export function Act0Prereqs({ onComplete }: { onComplete: () => void }) {
  const [claimed, setClaimed] = useState(loadSeats());
  const [busy, setBusy] = useState<SeatId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onUpdate = () => setClaimed(loadSeats());
    window.addEventListener('seats:update', onUpdate);
    return () => window.removeEventListener('seats:update', onUpdate);
  }, []);

  const aliceClaimed = !!claimed['alice'];
  const bobClaimed = !!claimed['bob'];
  const ready = aliceClaimed && bobClaimed;

  const handleClaim = async (seatId: SeatId) => {
    setBusy(seatId);
    setError(null);
    try {
      const seat = recoverySeats.find((s) => s.id === seatId)!;
      const passkey = await registerPasskeyForSeat(seatId, seat.name);
      // Persist the passkey credential locally so signing in Act 4 can
      // find it. registerPasskeyForSeat only creates the WebAuthn
      // credential; the local mirror has to be saved explicitly.
      savePasskeyForSeat(seatId, passkey);
      if (!config.factoryAddress || !config.rpcUrl || !config.chainId || !config.entryPoint || !config.demoA2aUrl) {
        setError('Deployment config missing — set VITE_FACTORY_ADDRESS / VITE_RPC_URL / VITE_CHAIN_ID / VITE_ENTRY_POINT / VITE_DEMO_A2A_URL.');
        return;
      }
      const pia = passkeyIdentity(passkey.pubKeyX, passkey.pubKeyY);

      // Deploy the Person Smart Agent ON CHAIN now. Mode=1 with
      // self-trustee bootstrap (mirrors demo-web-pro's pattern). Sam's
      // recovery in Act 4 dispatches a userOp FROM Alice's or Bob's
      // PSA — that PSA has to exist when the ERC-4337 EntryPoint
      // validates the op (otherwise AA20 "account not deployed").
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
          trustees: [pia],
          initialPasskeyCredentialIdDigest: passkey.credentialIdDigest,
          initialPasskeyX: passkey.pubKeyX.toString(),
          initialPasskeyY: passkey.pubKeyY.toString(),
          timelockOverrides: [0, 0, 0, 0, 1, 0, 0],
          salt: '0',
        }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      if (!res.ok || body.ok !== true) {
        setError(typeof body.error === 'string' ? body.error : `deploy HTTP ${res.status}`);
        return;
      }
      const personAgent = body.deployedAddress as Address;
      const claim: SeatClaim = {
        seatId,
        personAgent,
        authMethods: [{
          kind: 'passkey',
          credentialIdDigest: passkey.credentialIdDigest,
          pubKeyX: passkey.pubKeyX,
          pubKeyY: passkey.pubKeyY,
          pia,
        }],
        claimedAt: new Date().toISOString(),
      };
      claimSeat(claim);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card act-section">
      <h2>Act 0 · Recovery trustees</h2>
      <p className="act-intro">
        Before Sam can onboard, his recovery trustees — Alice + Bob — need their own
        canonical Smart Agents. Each one enrolls a passkey credential on this device;
        the credential is a control facet of that trustee's Smart Agent. We deploy
        their Smart Agents now so they can co-sign Sam's credential recovery in Act 4.
      </p>
      <div className="seat-grid">
        {recoverySeats
          .filter((s) => s.id !== 'sam')
          .map((s) => {
            const isClaimed = !!claimed[s.id];
            return (
              <div key={s.id} className={`seat-card${isClaimed ? ' claimed' : ''}`}>
                <div className="seat-name">{s.name}</div>
                <div className="seat-blurb">{s.blurb}</div>
                {isClaimed ? (
                  <div className="seat-status">✓ enrolled</div>
                ) : (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => handleClaim(s.id)}
                  >
                    {busy === s.id ? 'Enrolling…' : `Enroll ${s.name}'s passkey`}
                  </button>
                )}
              </div>
            );
          })}
      </div>
      {error && <div className="act-error">{error}</div>}
      <div className="act-footer">
        <button type="button" disabled={!ready} onClick={onComplete}>
          Continue to Act 1 →
        </button>
      </div>
    </section>
  );
}

function passkeyIdentity(x: bigint, y: bigint): Address {
  const h = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [x, y]));
  return ('0x' + h.slice(-40)) as Address;
}
