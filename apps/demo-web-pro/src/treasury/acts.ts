/**
 * Act ladder definition (spec 211 § 5).
 *
 * Each act is a phase in the demo. Status reflects what's IMPLEMENTED,
 * not what's specced. As phase 6f.* lands, statuses upgrade from
 * `not-started` → `simulated` → `live`.
 */

export type ActStatus = 'not-started' | 'simulated' | 'live';

export type Modality = 'Bootstrap' | 'Admin' | 'Stewardship';

export interface ActDef {
  /** 0-indexed ordinal — also the position in the progress rail. */
  id: number;
  /** Stable hash-route slug. */
  slug: string;
  /** Short label for the rail. */
  title: string;
  /** Per spec 212 § 2.2 authority modality. */
  modality: Modality | 'Read-only';
  /** Implementation status. */
  status: ActStatus;
  /** One-line "what this act does." */
  oneLiner: string;
}

export const ACTS: ActDef[] = [
  {
    id: 1,
    slug: 'create-alice',
    title: 'Act 1 — Alice joins',
    modality: 'Bootstrap',
    status: 'live',
    oneLiner: 'Claim the Alice seat. Register a passkey. Deploy Alice\'s Person Smart Agent (gasless).',
  },
  {
    id: 2,
    slug: 'create-org',
    title: 'Act 2 — Create Org',
    modality: 'Bootstrap',
    status: 'live',
    oneLiner: 'Founder\'s Person Smart Agent deploys Acme Construction in hybrid mode.',
  },
  {
    id: 3,
    slug: 'create-treasury',
    title: 'Act 2.5 — Create Treasury',
    modality: 'Admin',
    status: 'live',
    oneLiner: 'Deploy Acme Treasury, owned by the Org. Org→Treasury delegation simulated.',
  },
  {
    id: 4,
    slug: 'bob-joins',
    title: 'Act 3 — Bob joins',
    modality: 'Admin',
    status: 'live',
    oneLiner: 'Bob claims his seat. Alice schedules + applies AddCustodian(Bob.PSA) on the Org.',
  },
  {
    id: 5,
    slug: 'two-person-control',
    title: 'Act 4 — Two-person control',
    modality: 'Admin',
    status: 'not-started',
    oneLiner: 'Org approvalsRequired ← 2. Treasury Add Steward(Bob).',
  },
  {
    id: 6,
    slug: 'delegate-treasury',
    title: 'Act 5 — Delegate Treasury',
    modality: 'Admin',
    status: 'not-started',
    oneLiner: 'Treasury issues stewardship delegations to Alice + Bob\'s Person Agents.',
  },
  {
    id: 7,
    slug: 'dashboard',
    title: 'Act 6 — Org Dashboard',
    modality: 'Read-only',
    status: 'not-started',
    oneLiner: 'Live snapshot of the four-agent picture + audit trail.',
  },
];

export function actBySlug(slug: string | undefined): ActDef | undefined {
  if (!slug) return undefined;
  return ACTS.find((a) => a.slug === slug);
}
