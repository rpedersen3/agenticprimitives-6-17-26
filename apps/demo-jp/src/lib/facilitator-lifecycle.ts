// Facilitator setup→coverage→match→agreement lifecycle logic (production UX Wave 4, design spec §11
// "Facilitator Workspace" + §15a "Facilitator Workspace" primary-task states). Mirrors Wave 3's
// `adopter-lifecycle.ts` (and demo-gs's `kc-lifecycle.ts`).
//
// PURE — no network, no localStorage: it derives the facilitator's position in the lifecycle from data
// the FacilitatorIntranet already holds (the Impact profile + JP facilitator record via
// `facilitatorSteps`, plus the match state the workspace resolves from `matchAdoptersForFacilitator`).
// The component owns the I/O; this file is only logic, so it is unit-testable
// (`facilitator-lifecycle.test.ts`).
//
// The rail steps mirror the §11 checklist: Facilitator org · Profile/WEA · ADOPT MOU · Coverage
// declared · Matches. We also surface a single `position` the next-best-action card branches on.

import type { ImpactProfile, JpFacilitatorRecord } from './vault';
import { facilitatorSteps } from './vault';
import type { RailStep } from '../components/LifecycleRail';

/** The facilitator's coarse lifecycle position — what to nudge the user toward next (spec §15a). */
export type FacilitatorLifecyclePosition =
  | 'setup-needed' // org / profile / WEA / MOU still missing
  | 'coverage-draft' // setup done, coverage not yet declared (the §15a coverage-draft/empty state)
  | 'coverage-published' // coverage declared + available for JP matching, no adopter matches yet
  | 'matches-empty' // coverage published, JP surfaced no matching adopters (the §15a matches-empty state)
  | 'matches-pending' // matched adopters are present and need review
  | 'agreement-requested'; // a match is moving toward consent / an agreement

/** Where the facilitator's match surface stands, resolved by the workspace from the JP board. */
export interface FacilitatorMatchStatus {
  /** JP has surfaced at least one matched adopter for this facilitator's declared coverage. */
  matched: boolean;
  /** A match has moved toward / into an agreement (consent / contact exchange / issued). */
  agreement: boolean;
}

export interface FacilitatorLifecycle {
  position: FacilitatorLifecyclePosition;
  steps: RailStep[];
}

/** Derive the facilitator lifecycle (rail steps + coarse position) from the entitled-view data. Pure.
 *  - `facilitatorSteps()` supplies the setup steps (profile/WEA, MOU, coverage) + their `satisfied`
 *    flags. The "Facilitator org" step is optional (facilitators may act as their person SA), so it is
 *    `done` when an org is present and never becomes the blocking `current` step on its own.
 *  - `hasFacilitatorOrg` reflects whether a `jp-facilitator-org` is selected (the §11 "facilitator
 *    organization" card — non-blocking).
 *  - `match` supplies the match/agreement tail. */
export function facilitatorLifecycle({
  impact,
  record,
  hasFacilitatorOrg,
  match,
}: {
  impact: ImpactProfile;
  record: JpFacilitatorRecord;
  hasFacilitatorOrg: boolean;
  match: FacilitatorMatchStatus;
}): FacilitatorLifecycle {
  const setup = facilitatorSteps(impact, record);
  const profileOk = setup.find((s) => s.step === 'profile-on-file')?.satisfied ?? false;
  const weaOk = setup.find((s) => s.step === 'wea-on-file')?.satisfied ?? false;
  const mouOk = setup.find((s) => s.step === 'mou')?.satisfied ?? false;
  const coverageOk = setup.find((s) => s.step === 'coverage')?.satisfied ?? false;

  // "Setup" = profile/WEA/MOU; coverage is the primary task, surfaced as its own rail step + position.
  const preCoverageComplete = profileOk && weaOk && mouOk;

  const position: FacilitatorLifecyclePosition = !preCoverageComplete
    ? 'setup-needed'
    : !coverageOk
      ? 'coverage-draft'
      : match.agreement
        ? 'agreement-requested'
        : match.matched
          ? 'matches-pending'
          : 'matches-empty';

  // Build the rail; `current` is the first not-done step. The org step is optional, so it is marked
  // done when an org is present and never becomes the blocking `current` step on its own.
  const flags: { key: string; label: string; done: boolean }[] = [
    { key: 'org', label: 'Facilitator org', done: hasFacilitatorOrg },
    { key: 'profile', label: 'Profile / WEA', done: profileOk && weaOk },
    { key: 'mou', label: 'ADOPT MOU', done: mouOk },
    { key: 'coverage', label: 'Coverage declared', done: coverageOk },
    { key: 'matches', label: 'Matches', done: match.matched },
  ];

  // The optional org step must not capture `current` — find the first blocking (non-org) pending step.
  const firstBlocking = flags.findIndex((f) => f.key !== 'org' && !f.done);
  const steps: RailStep[] = flags.map((f, i) => ({ ...f, current: i === firstBlocking }));

  return { position, steps };
}
