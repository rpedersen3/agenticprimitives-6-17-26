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

import { TreasuryShell } from './treasury/TreasuryShell';
import { useNamingClaimListener } from './lib/use-agent-naming';

export function App() {
  // Listen for the cross-component `naming:claimed` event so cached
  // NameDisplay reads refresh the moment a claim propagates on chain.
  // See `claim-psa-name.ts` for the dispatch side.
  useNamingClaimListener();
  return <TreasuryShell />;
}
