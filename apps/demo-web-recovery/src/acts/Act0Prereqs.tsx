import { loadSeats, claimSeat, type SeatClaim } from '../lib/seats';
import { recoverySeats, type SeatId } from '../recovery-config';
import { config } from '../config';
import { useState, useEffect } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { enrollCredential, directDeploy, seatBoundToEoa, type EnrollChoice } from '../lib/enroll';
import { claimPsaName, claimPsaNameViaEoa } from '../lib/claim-psa-name';
import { setCachedName } from '../lib/name-cache';
import { EnrollmentChoice } from '../components/EnrollmentChoice';
import { SmartAgentInfo } from '../components/SmartAgentInfo';

/**
 * Act 0 — Prereqs. Alice + Bob (Sam's recovery trustees) each enroll a
 * credential — a passkey OR a wallet (SIWE/EOA) — and get a canonical
 * Smart Agent deployed (self-trustee bootstrap, mode=1). Their enrolled
 * identity (PIA or EOA) co-signs Sam's credential recovery in Act 4.
 *
 * Wallet path: connect the EOA for the seat you're claiming, enroll,
 * then switch MetaMask accounts before claiming the other seat (Alice
 * and Bob must bind different EOAs).
 */
export function Act0Prereqs({ onComplete }: { onComplete: () => void }) {
  const [claimed, setClaimed] = useState(loadSeats());
  const [busy, setBusy] = useState<SeatId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<EnrollChoice>('passkey');
  const { address: walletAddress } = useAccount();
  const { data: walletClient } = useWalletClient();

  useEffect(() => {
    const onUpdate = () => setClaimed(loadSeats());
    window.addEventListener('seats:update', onUpdate);
    return () => window.removeEventListener('seats:update', onUpdate);
  }, []);

  const ready = !!claimed['alice'] && !!claimed['bob'];

  const handleClaim = async (seatId: SeatId) => {
    setBusy(seatId);
    setError(null);
    try {
      if (!config.factoryAddress || !config.rpcUrl || !config.chainId || !config.demoA2aUrl) {
        setError('Deployment config missing — set VITE_FACTORY_ADDRESS / VITE_RPC_URL / VITE_CHAIN_ID / VITE_DEMO_A2A_URL.');
        return;
      }
      const seat = recoverySeats.find((s) => s.id === seatId)!;
      // Distinct-wallet guard: each seat needs its OWN EOA, else two
      // seats deploy to the same CREATE2 address.
      if (choice === 'siwe') {
        if (!walletAddress) {
          setError('Connect a wallet account for this seat first.');
          return;
        }
        const clash = seatBoundToEoa(walletAddress as `0x${string}`, seatId);
        if (clash) {
          setError(
            `This wallet (${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}) is already ${clash}'s. ` +
              `Click "Use different account", switch MetaMask to a fresh account for ${seat.name}, then retry.`,
          );
          return;
        }
      }
      const cred = await enrollCredential({
        seatId,
        name: seat.name,
        choice,
        eoa: walletAddress as `0x${string}` | undefined,
      });
      // Self-trustee bootstrap: the seat's own identity is its trustee.
      const personAgent = await directDeploy({
        credential: cred,
        trustees: [cred.identity],
        timelockOverrides: [0, 0, 0, 0, 1, 0, 0],
      });
      const claim: SeatClaim = {
        seatId,
        personAgent,
        authMethods: [cred.authMethod],
        claimedAt: new Date().toISOString(),
      };
      claimSeat(claim);

      // Best-effort: claim <seatId>.demo.agent for this trustee's Smart
      // Agent + set it primary. AWAITED for the EOA path because the
      // batch must be signed by THIS seat's wallet account before the
      // user switches MetaMask to the next seat. Failure is non-fatal —
      // the seat stays enrolled; the card just shows the address.
      try {
        if (cred.passkey) {
          const r = await claimPsaName({ baseLabel: seatId, personAgent, passkey: cred.passkey });
          if (r.ok) setCachedName(personAgent, r.name);
        } else if (walletClient && cred.authMethod.kind === 'siwe') {
          const r = await claimPsaNameViaEoa({
            baseLabel: seatId,
            personAgent,
            walletClient,
            account: cred.identity,
          });
          if (r.ok) setCachedName(personAgent, r.name);
        }
      } catch { /* best-effort name claim */ }
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
        canonical Smart Agents. Each enrolls a credential — a passkey OR a wallet —
        which becomes a control facet of that trustee's Smart Agent. We deploy their
        Smart Agents now so they can co-sign Sam's credential recovery in Act 4.
      </p>
      <EnrollmentChoice choice={choice} onChoice={setChoice} idPrefix="trustee" />
      {choice === 'siwe' && (
        <p className="act-intro" style={{ fontSize: 13, opacity: 0.8 }}>
          Connect Alice's account → enroll Alice; then <em>Use different account</em>,
          switch to Bob's account → enroll Bob.
        </p>
      )}
      <div className="seat-grid">
        {recoverySeats
          .filter((s) => s.id !== 'sam')
          .map((s) => {
            const claim = claimed[s.id];
            const method = claim?.authMethods[0];
            const credLabel = method
              ? method.kind === 'passkey'
                ? 'passkey'
                : `wallet ${method.eoa.slice(0, 6)}…${method.eoa.slice(-4)}`
              : '';
            return (
              <div key={s.id} className={`seat-card${claim ? ' claimed' : ''}`}>
                <div className="seat-name">{s.name}</div>
                <div className="seat-blurb">{s.blurb}</div>
                {claim ? (
                  <div className="seat-status">
                    <div>✓ enrolled</div>
                    <SmartAgentInfo address={claim.personAgent} credLabel={credLabel} />
                  </div>
                ) : (
                  <button type="button" disabled={busy !== null} onClick={() => handleClaim(s.id)}>
                    {busy === s.id
                      ? 'Enrolling…'
                      : choice === 'siwe'
                        ? `Enroll ${s.name}'s wallet`
                        : `Enroll ${s.name}'s passkey`}
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
