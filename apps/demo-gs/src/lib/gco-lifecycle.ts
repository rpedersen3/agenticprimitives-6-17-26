// GCO need→match→agreement lifecycle logic (production UX Wave C, design spec §10 progress rail +
// §15a primary-task states). PURE — no network, no localStorage: it derives the GCO's position in the
// demand lifecycle from the entitled-view data the App already holds (the GCO session, the org's own
// needs, and the member's own agreements). The App owns the I/O; this file is only logic, so it is
// unit-testable (`gco-lifecycle.test.ts`).
//
// The five rail steps mirror the §10 checklist + the mockup: Org created · Need posted · Match reviewed
// · Connection requested · Agreement issued. We also surface a single `position` the next-best-action
// card branches on.

import type { GcoNeedIntent } from '../domain/gs-types';
import type { GsAgreement } from '../domain/gs-status';

/** The GCO's coarse lifecycle position — what to nudge the user toward next. */
export type GcoLifecyclePosition =
  | 'org-pending' // person connected, org not created yet (no session)
  | 'no-need' // org ready, nothing posted
  | 'need-posted' // a live need exists, no connection requested yet
  | 'request-pending' // a connection was requested, awaiting the KC
  | 'agreement-issued'; // a confirmed/ongoing/fulfilled agreement exists

/** A generic lifecycle rail step (shared with `LifecycleRail`; Wave D reuses the rail). */
export interface LifecycleStep {
  key: string;
  label: string;
  done: boolean;
  current: boolean;
}

export interface GcoLifecycle {
  position: GcoLifecyclePosition;
  steps: LifecycleStep[];
}

/** An agreement that has progressed past a pure request (the KC accepted / it is live or done). */
const ISSUED = new Set(['confirmed', 'ongoing', 'gco_concluded', 'kc_concluded', 'fulfilled']);
/** An open request awaiting the KC's response. */
const REQUESTED = new Set(['proposed', 'requested']);

/** Derive the GCO lifecycle (rail steps + coarse position) from the connected state. Pure.
 *  `hasOrg` = a real GCO session exists (the org SA + broker grant were minted). */
export function gcoLifecycle(
  { hasOrg, needs, agreements }: { hasOrg: boolean; needs: GcoNeedIntent[]; agreements: GsAgreement[] },
): GcoLifecycle {
  const liveNeeds = needs.filter((n) => n.status !== 'withdrawn');
  const hasNeed = liveNeeds.length > 0;
  const hasIssued = agreements.some((a) => ISSUED.has(a.status));
  const hasRequest = hasIssued || agreements.some((a) => REQUESTED.has(a.status));
  // "Match reviewed" is implied once a connection has been requested (you reviewed a match to request
  // it) or once a need is marked matched/requested — there is no discrete review event in the demo data.
  const matchReviewed =
    hasRequest || liveNeeds.some((n) => n.status === 'matched' || n.status === 'requested' || n.status === 'agreement_active');

  const position: GcoLifecyclePosition =
    !hasOrg ? 'org-pending'
      : hasIssued ? 'agreement-issued'
        : hasRequest ? 'request-pending'
          : hasNeed ? 'need-posted'
            : 'no-need';

  // Build the rail; `current` is the first not-done step.
  const flags = [
    { key: 'org', label: 'Org created', done: hasOrg },
    { key: 'need', label: 'Need posted', done: hasNeed },
    { key: 'match', label: 'Match reviewed', done: matchReviewed },
    { key: 'request', label: 'Connection requested', done: hasRequest },
    { key: 'agreement', label: 'Agreement issued', done: hasIssued },
  ];
  const firstPending = flags.findIndex((f) => !f.done);
  const steps: LifecycleStep[] = flags.map((f, i) => ({ ...f, current: i === firstPending }));

  return { position, steps };
}
