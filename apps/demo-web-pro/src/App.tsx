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

export function App() {
  return <TreasuryShell />;
}
