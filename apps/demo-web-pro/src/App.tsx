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
import { useAgentNamingClient, useNamingClaimListener } from './lib/use-agent-naming';
import { loadSeats } from './lib/seats';
import { listPasskeys } from './lib/passkey';
import { loadOrg, loadTreasury } from './lib/demo-state';
import { setCachedName, getCachedName } from './lib/name-cache';
import type { Address } from 'viem';

export function App() {
  // Listen for the cross-component `naming:claimed` event so cached
  // NameDisplay reads refresh the moment a claim propagates on chain.
  useNamingClaimListener();

  const namingClient = useAgentNamingClient();

  // Rehydrate the name cache on boot in two passes:
  //
  //   1. SYNCHRONOUS: pair each local passkey's stored `agentName` with
  //      its seat's `personAgent`. Hits the cache before first render
  //      — instant name on every NameDisplay.
  //
  //   2. ASYNCHRONOUS: for every known SA (seats + org + treasury),
  //      call `universalResolver.reverseResolveString(SA)`. This
  //      covers SIWE-only seats (no passkey storage to seed from) and
  //      catches any name that landed on chain via a previous run /
  //      partial claim. ~4 readContract calls total at boot — bounded.
  useEffect(() => {
    const seats = loadSeats();
    const passkeys = listPasskeys();

    // Pass 1 — local passkey metadata.
    for (const [seatId, pk] of Object.entries(passkeys)) {
      const claim = seats[seatId];
      if (claim?.personAgent && pk.agentName) {
        setCachedName(claim.personAgent, pk.agentName);
      }
    }

    // Pass 2 — chain reverse-resolve for every known SA the cache
    // doesn't already have.
    if (!namingClient) return;
    const addresses: Address[] = [];
    for (const claim of Object.values(seats)) {
      if (claim?.personAgent && !getCachedName(claim.personAgent)) {
        addresses.push(claim.personAgent);
      }
    }
    const org = loadOrg();
    if (org?.address && !getCachedName(org.address)) addresses.push(org.address);
    const treasury = loadTreasury();
    if (treasury?.address && !getCachedName(treasury.address)) addresses.push(treasury.address);

    let cancelled = false;
    void (async () => {
      for (const addr of addresses) {
        if (cancelled) return;
        try {
          const name = await namingClient.reverseResolve(addr);
          if (!cancelled && name) setCachedName(addr, name);
        } catch {
          // Ignore — single missing name doesn't block the others.
        }
      }
    })();
    return () => { cancelled = true; };
  }, [namingClient]);

  return <TreasuryShell />;
}
