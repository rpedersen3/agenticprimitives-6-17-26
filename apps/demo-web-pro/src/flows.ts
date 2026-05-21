/**
 * demo-web-pro flow registry.
 *
 * Each entry IS a capability the app currently supports end-to-end against
 * live contracts. Stubs and aspirational copy live in specs/docs, not in
 * this UI. As each new capability becomes wireable (chain + SDK + UX), add
 * an entry here.
 *
 * Status field is intentionally narrow:
 *   - 'live'      — the chain write/read actually executes against deployed contracts
 *   - 'in-flight' — partially wired; some path works but caveats apply (use sparingly)
 *
 * Anything weaker than 'in-flight' does NOT belong in this registry.
 */

export type FlowStatus = 'live' | 'in-flight';

export type FlowSlug = 'create-account' | 'view-account';

export interface FlowMeta {
  slug: FlowSlug;
  title: string;
  oneLiner: string;
  status: FlowStatus;
  /** T1 Read · T3 Value · T4 Admin etc. — labels the highest-risk
   *  primitive the flow exercises. Helps users predict the blast radius. */
  risk: 'T1 Read' | 'T4 Admin';
  /** Path relative to apps/demo-web-pro/ for the developer-facing walkthrough. */
  guidePath: string;
  /** Step labels for the StepRail at the top of the flow. */
  steps: string[];
}

export const FLOWS: FlowMeta[] = [
  {
    slug: 'create-account',
    title: 'Create AgentAccount',
    oneLiner:
      'Deploy a new smart account in any of the four modes (single / hybrid / threshold / org). Factory installs the ThresholdValidator in the same tx so admin actions work immediately.',
    status: 'live',
    risk: 'T4 Admin',
    guidePath: 'docs/multi-sig/flows/create-account.md',
    steps: ['Connect', 'Configure', 'Review', 'Deploy'],
  },
  {
    slug: 'view-account',
    title: 'Inspect AgentAccount state',
    oneLiner:
      'Paste any deployed AgentAccount address and see its owners, mode, per-tier thresholds, guardian set, recovery threshold, and installed modules. Read-only — no wallet required.',
    status: 'live',
    risk: 'T1 Read',
    guidePath: 'docs/multi-sig/flows/view-account.md',
    steps: ['Enter address', 'Read state'],
  },
];

export function flowBySlug(slug: string | undefined): FlowMeta | undefined {
  if (!slug) return undefined;
  return FLOWS.find((f) => f.slug === slug);
}
