// Adopter setup→request→match→agreement lifecycle logic (production UX Wave 3, design spec §10
// progress rail + §15a "Adopter Workspace" primary-task states). Mirrors demo-gs's `gco-lifecycle.ts`.
// PURE — no network, no localStorage: it derives the adopter's position in the lifecycle from data the
// AdopterIntranet already holds (the Impact profile + JP adopter record via `adopterSteps`, plus the
// facilitator-request status the App resolves from the JP board). The component owns the I/O; this
// file is only logic.
//
// The rail steps mirror the §10 checklist: Profile on file · Adopter org · ADOPT MOU · WEA (if
// required) · Adoption declared · Facilitator request. We also surface a single `position` the
// next-best-action card branches on.

import type { ImpactProfile, JpAdopterRecord } from './vault';
import { adopterSteps, requiresWea } from './vault';
import type { RailStep } from '../components/LifecycleRail';

/** The adopter's coarse lifecycle position — what to nudge the user toward next (design spec §15a). */
export type AdopterLifecyclePosition =
  | 'setup-needed' // profile / type / MOU / WEA / adoption still missing
  | 'ready-to-request' // adoption declared, facilitator request not yet sent
  | 'under-jp-review' // facilitator request sent, awaiting JP / a match
  | 'match-ready' // JP has surfaced a facilitator match
  | 'agreement'; // a match has progressed toward / into an agreement

/** Where the facilitator request stands, resolved by the App from the JP board + match surface. */
export interface AdopterRequestStatus {
  /** A `NeedFacilitator` intent already exists for this adopter (the request was sent). */
  requested: boolean;
  /** JP has surfaced at least one matched facilitator for this adopter. */
  matched: boolean;
  /** A match has moved toward / into an agreement (consent / issued). */
  agreement: boolean;
}

export interface AdopterLifecycle {
  position: AdopterLifecyclePosition;
  steps: RailStep[];
}

/** Derive the adopter lifecycle (rail steps + coarse position) from the entitled-view data. Pure.
 *  - `adopterSteps()` supplies the setup steps (profile / type / MOU / WEA) + their `satisfied` flags;
 *  - `hasAdopterOrg` reflects whether a `jp-adopter-org` is selected (the §10 "Adopter organization"
 *    step — optional, so it is `done` when present and otherwise non-blocking);
 *  - `request` supplies the facilitator-request tail. */
export function adopterLifecycle({
  impact,
  record,
  hasAdopterOrg,
  request,
}: {
  impact: ImpactProfile;
  record: JpAdopterRecord;
  hasAdopterOrg: boolean;
  request: AdopterRequestStatus;
}): AdopterLifecycle {
  const setup = adopterSteps(impact, record);
  const profileOk = setup.find((s) => s.step === 'profile-on-file')?.satisfied ?? false;
  const mouOk = setup.find((s) => s.step === 'mou')?.satisfied ?? false;
  const weaNeeded = requiresWea(record);
  const weaOk = setup.find((s) => s.step === 'wea-on-file')?.satisfied ?? false;
  const adoptionOk = setup.find((s) => s.step === 'adoption')?.satisfied ?? false;

  const setupComplete = setup.every((s) => s.satisfied);

  const position: AdopterLifecyclePosition = !setupComplete
    ? 'setup-needed'
    : request.agreement
      ? 'agreement'
      : request.matched
        ? 'match-ready'
        : request.requested
          ? 'under-jp-review'
          : 'ready-to-request';

  // Build the rail; `current` is the first not-done step. The adopter-org step is optional, so it is
  // marked done when an org is present and never becomes the blocking `current` step on its own.
  const flags: { key: string; label: string; done: boolean }[] = [
    { key: 'profile', label: 'Profile on file', done: profileOk },
    { key: 'org', label: 'Adopter org', done: hasAdopterOrg },
    { key: 'mou', label: 'ADOPT MOU', done: mouOk },
  ];
  if (weaNeeded) flags.push({ key: 'wea', label: 'WEA', done: weaOk });
  flags.push({ key: 'adoption', label: 'Adoption declared', done: adoptionOk });
  flags.push({ key: 'request', label: 'Facilitator request', done: request.requested });

  // The optional org step must not capture `current` — find the first blocking (non-org) pending step.
  const firstBlocking = flags.findIndex((f) => f.key !== 'org' && !f.done);
  const steps: RailStep[] = flags.map((f, i) => ({ ...f, current: i === firstBlocking }));

  return { position, steps };
}
