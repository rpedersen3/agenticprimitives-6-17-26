/**
 * demo-web-pro — Treasury Service Agent demo (spec 211).
 *
 * The capability gallery that lived here through phase 6c is replaced
 * by an act-ladder demo of a two-admin organization (Acme Construction)
 * and its Treasury Service Agent. See:
 *
 *   - spec 211 — Treasury Service Agent demo
 *   - spec 212 — agent-centric delegation (the load-bearing principle)
 *   - spec 213 — custody-layer carve-out (vocabulary firewall)
 *
 * The shell is implemented in `treasury/TreasuryShell.tsx`. Old
 * capability flows (create-account / view-account / admin-actions /
 * enroll-passkey) still live under `flows/` for reference but are no
 * longer routed from the app shell — they\'ll be absorbed into the
 * Treasury acts during phases 6f.2–6f.7 and deleted once superseded.
 */

import { useEffect } from 'react';
import { TreasuryShell } from './treasury/TreasuryShell';
import { useNamingClaimListener } from './lib/use-agent-naming';
import { loadSeats } from './lib/seats';
import { listPasskeys } from './lib/passkey';
import { setCachedName } from './lib/name-cache';

export function App() {
  // Listen for the cross-component `naming:claimed` event so cached
  // NameDisplay reads refresh the moment a claim propagates on chain.
  // See `claim-psa-name.ts` for the dispatch side.
  useNamingClaimListener();

  // Rehydrate the name cache from local seat metadata on every boot.
  // Each passkey mirror that knows its `agentName` (set in
  // `registerPasskeyForSeat` when the label was predicted) is paired
  // with the seat's `personAgent` and written into the cache. This
  // populates NameDisplay BEFORE any chain reads — load with names
  // already on screen, no flash of truncated addresses.
  useEffect(() => {
    const seats = loadSeats();
    const passkeys = listPasskeys();
    for (const [seatId, pk] of Object.entries(passkeys)) {
      const claim = seats[seatId];
      if (claim?.personAgent && pk.agentName) {
        setCachedName(claim.personAgent, pk.agentName);
      }
    }
  }, []);

  return <TreasuryShell />;
}
