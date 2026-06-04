// KC offering→request→agreement lifecycle logic (production UX Wave D, design spec §11 summary +
// §15a KC primary-task states). PURE — no network, no localStorage: it derives the KC's position in the
// supply lifecycle from the entitled-view data the App already holds (whether the KC has published an
// offering, and the member's own agreements). The App owns the I/O; this file is only logic, so it is
// unit-testable (`kc-lifecycle.test.ts`). Mirrors `gco-lifecycle.ts`.
//
// The five rail steps mirror the §11 hierarchy + the mockup (`demo-gs-kc-dashboard.svg`): Connected ·
// Offering published · Requests received · Connection accepted · Agreement. We also surface a single
// `position` the next-best-action card branches on.

import type { GsAgreement } from '../domain/gs-status';

/** A generic lifecycle rail step (shared with `LifecycleRail`). */
export interface LifecycleStep {
  key: string;
  label: string;
  done: boolean;
  current: boolean;
}

/** The KC's coarse lifecycle position — what to nudge the user toward next. */
export type KcLifecyclePosition =
  | 'no-offering' // connected, nothing published yet
  | 'offering-published' // a published offering, no requests yet
  | 'requests-pending' // an incoming connection request awaits the KC's response
  | 'accepted' // the KC accepted a request (confirmed/ongoing) — the connection is live
  | 'agreement-issued'; // a concluded/fulfilled agreement exists

export interface KcLifecycle {
  position: KcLifecyclePosition;
  steps: LifecycleStep[];
}

/** A request awaiting the KC's accept/decline. */
const REQUESTED = new Set(['proposed', 'requested']);
/** Accepted — the connection is live (the KC accepted; contact released). */
const ACCEPTED = new Set(['confirmed', 'ongoing']);
/** Concluded — the agreement reached its end state. */
const CONCLUDED = new Set(['gco_concluded', 'kc_concluded', 'fulfilled']);

/** Derive the KC lifecycle (rail steps + coarse position) from the connected state. Pure.
 *  `hasOffering` = the KC has published an offering to its own vault. */
export function kcLifecycle(
  { hasOffering, agreements }: { hasOffering: boolean; agreements: GsAgreement[] },
): KcLifecycle {
  const hasConcluded = agreements.some((a) => CONCLUDED.has(a.status));
  const hasAccepted = hasConcluded || agreements.some((a) => ACCEPTED.has(a.status));
  // A request was "received" once any agreement exists past a pure proposal — an open request now, or a
  // request that has already been accepted/concluded (it was received at some point).
  const hasRequest = hasAccepted || agreements.some((a) => REQUESTED.has(a.status));
  // An OPEN request still awaiting the KC's response (drives the requests-pending position).
  const hasOpenRequest = agreements.some((a) => REQUESTED.has(a.status));

  const position: KcLifecyclePosition =
    !hasOffering ? 'no-offering'
      : hasConcluded ? 'agreement-issued'
        : hasAccepted ? 'accepted'
          : hasOpenRequest ? 'requests-pending'
            : 'offering-published';

  // Build the rail; `current` is the first not-done step.
  const flags = [
    { key: 'connected', label: 'Connected', done: true },
    { key: 'offering', label: 'Offering published', done: hasOffering },
    { key: 'requests', label: 'Requests received', done: hasRequest },
    { key: 'accepted', label: 'Connection accepted', done: hasAccepted },
    { key: 'agreement', label: 'Agreement', done: hasConcluded },
  ];
  const firstPending = flags.findIndex((f) => !f.done);
  const steps: LifecycleStep[] = flags.map((f, i) => ({ ...f, current: i === firstPending }));

  return { position, steps };
}
