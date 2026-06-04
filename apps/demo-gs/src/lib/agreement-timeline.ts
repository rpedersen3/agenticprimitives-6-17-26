// Match→agreement swimlane timeline logic (production UX Wave E, design spec §15a "Match And Agreement
// Timeline" + the mockup `demo-gs-deep-match-agreement.svg`). PURE — no network, no localStorage, no
// React: it derives the ordered lifecycle milestones for ONE agreement, each placed on the correct actor
// swimlane and marked done / current / upcoming from the agreement's current `status`. The component
// (`AgreementTimeline.tsx`) renders these; this file is only logic, so it is unit-testable
// (`agreement-timeline.test.ts`). No app/faith literals leak in here beyond the four actor lane keys,
// which are the domain's fixed parties.

import type { GsAgreement, GsConnectionStatus } from '../domain/gs-status';

/** The four fixed actor swimlanes (spec 250 §15a). The order is the visual top→bottom lane order. */
export type TimelineLane = 'gco' | 'broker' | 'kc' | 'issuer';

export const LANE_ORDER: TimelineLane[] = ['gco', 'broker', 'kc', 'issuer'];

/** The display label per lane (the protocol parties; white-label product copy stays in the app shell). */
export const LANE_LABEL: Record<TimelineLane, string> = {
  gco: 'GCO Org',
  broker: 'Global Switchboard (broker)',
  kc: 'KC Expert',
  issuer: 'Global Church (issuer)',
};

export type StepState = 'done' | 'current' | 'upcoming';

/** One milestone on the timeline, placed on a lane and marked done / current / upcoming. */
export interface TimelineStep {
  /** Stable key. */
  key: string;
  lane: TimelineLane;
  label: string;
  state: StepState;
  /** The lifecycle status this milestone is reached at (drives done/current). */
  reachedAt: GsConnectionStatus;
}

/** The canonical milestone backbone (mockup steps 1–7; "ongoing → fulfilled" is one terminal step).
 *  `reachedAt` is the lifecycle status that marks this milestone DONE. Order is the visual sequence. */
const MILESTONES: Array<Omit<TimelineStep, 'state'>> = [
  { key: 'need', lane: 'gco', label: 'Need posted', reachedAt: 'requested' },
  { key: 'score', lane: 'broker', label: 'Scores via grants', reachedAt: 'requested' },
  { key: 'propose', lane: 'broker', label: 'Proposes match', reachedAt: 'requested' },
  { key: 'request', lane: 'gco', label: 'Requests connection', reachedAt: 'requested' },
  { key: 'accept', lane: 'kc', label: 'Accepts → contact released', reachedAt: 'confirmed' },
  { key: 'issue', lane: 'issuer', label: 'Issues agreement', reachedAt: 'confirmed' },
  { key: 'fulfil', lane: 'issuer', label: 'Ongoing → fulfilled', reachedAt: 'fulfilled' },
];

/** Lifecycle statuses ranked by how far the agreement has progressed. Decline/conclude are terminal
 *  off-ramps that branch but don't advance the happy-path milestones past where they branched. */
const RANK: Record<GsConnectionStatus, number> = {
  proposed: 0,
  requested: 1,
  gco_declined: 1, // branched off a request — keeps the request-era milestones, no further progress
  kc_declined: 1,
  confirmed: 2,
  ongoing: 3,
  gco_concluded: 3,
  kc_concluded: 3,
  fulfilled: 4,
};

/** The rank at which a milestone's `reachedAt` status is considered reached. */
const REACH_RANK: Record<GsConnectionStatus, number> = {
  proposed: 0, requested: 1, gco_declined: 1, kc_declined: 1,
  confirmed: 2, ongoing: 3, gco_concluded: 3, kc_concluded: 3, fulfilled: 4,
};

/** True once the agreement has reached/passed the milestone's `reachedAt` status. */
function isReached(status: GsConnectionStatus, reachedAt: GsConnectionStatus): boolean {
  return RANK[status] >= REACH_RANK[reachedAt];
}

/** A terminal decline/conclude that closes the happy path early (no milestone becomes current). */
export function isOffRamp(status: GsConnectionStatus): boolean {
  return status === 'gco_declined' || status === 'kc_declined'
    || status === 'gco_concluded' || status === 'kc_concluded';
}

/** Derive the ordered swimlane milestones for one agreement. Pure. The first not-done milestone is
 *  `current` (unless the agreement has taken a terminal off-ramp, in which case nothing is current). */
export function agreementTimeline(agreement: Pick<GsAgreement, 'status'>): TimelineStep[] {
  const { status } = agreement;
  const offRamp = isOffRamp(status);
  let currentAssigned = false;
  return MILESTONES.map((m) => {
    const done = isReached(status, m.reachedAt);
    let state: StepState;
    if (done) state = 'done';
    else if (!currentAssigned && !offRamp) { state = 'current'; currentAssigned = true; }
    else state = 'upcoming';
    return { ...m, state };
  });
}
