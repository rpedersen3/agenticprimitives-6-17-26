// Match→agreement swimlane timeline logic (production UX Wave 5, design spec §15a "Match And Agreement
// Timeline" + §15b/§15b.1 disclosure; the mockup `demo-gs-deep-match-agreement.svg`). Mirrors demo-gs's
// `agreement-timeline.ts`, mapped to the demo-jp four-actor model. PURE — no network, no localStorage, no
// React: it derives the ordered lifecycle milestones for ONE member match, each placed on the correct
// actor swimlane and marked done / current / upcoming from a small member-readable status. The component
// (`AgreementTimeline.tsx`) renders these; this file is only logic, so it is unit-testable
// (`__tests__/agreement-timeline.test.ts`).
//
// HONESTY NOTE (Waves 3/4 doctrine + spec 248): the member can only read signals their own grant
// entitles them to — the existence of a match, and the contact-exchange (consent) state. There is NO
// member-entitled on-chain "agreement issued" signal (GC issuance lives in GC's vault; the member sees
// only the on-chain commitment via the operator board, not from their own dashboard). So the "JP forwards
// draft", "GC issues agreement credential" + "optional public assertion" milestones stay honest stubs —
// `upcoming`, never fabricated as done. The four lane keys are the domain's fixed parties; no faith
// literals leak here beyond them (display copy stays in the app + brand module).

/** The four fixed actor swimlanes (design spec §15a). Top→bottom visual lane order. */
export type TimelineLane = 'adopter' | 'broker' | 'facilitator' | 'issuer';

export const LANE_ORDER: TimelineLane[] = ['adopter', 'broker', 'facilitator', 'issuer'];

/** Display label per lane (the protocol parties; white-label product names stay in the app brand). */
export const LANE_LABEL: Record<TimelineLane, string> = {
  adopter: 'Adopter',
  broker: 'JP (broker)',
  facilitator: 'Facilitator',
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
  /** The lifecycle phase this milestone is reached at (drives done/current). */
  reachedAt: MatchPhase;
  /** True for milestones the member cannot read an entitled signal for (honest stub — never auto-done).
   *  Drives the "not visible from your home" hint in the component. */
  stub?: boolean;
}

/** Coarse member-readable phase of a single match → agreement. Ranked by how far it has progressed.
 *  This is intentionally small: it is exactly what the member's OWN grant entitles them to observe. */
export type MatchPhase =
  | 'declared' // adoption declared / facilitator request on file
  | 'matched' // JP surfaced this counter-party
  | 'consented' // contact exchanged — both sides consented (the one bilateral signal the member reads)
  | 'issued'; // GC issued the agreement credential — NOT member-readable (honest stub; never reached here)

/** The member-readable inputs the panel already holds (mirrors `AdopterRequestStatus`-style data). */
export interface MatchTimelineInput {
  /** A facilitator request / adoption declaration is on file (the match was requested). */
  requested: boolean;
  /** This counter-party is a surfaced JP match. */
  matched: boolean;
  /** Contact exchange accepted for this match — the bilateral-consent signal the member can read. */
  consented: boolean;
}

const PHASE_RANK: Record<MatchPhase, number> = {
  declared: 0,
  matched: 1,
  consented: 2,
  issued: 3,
};

/** The canonical milestone backbone (design spec §15a / the Match→Agreement mermaid). `reachedAt` is the
 *  phase that marks the milestone DONE. Order is the visual sequence. The draft / issuance / public-
 *  assertion milestones are member-unreadable stubs (see HONESTY NOTE) so they never auto-mark done. */
const MILESTONES: Array<Omit<TimelineStep, 'state'>> = [
  { key: 'declared', lane: 'adopter', label: 'Adoption declared', reachedAt: 'declared' },
  { key: 'propose', lane: 'broker', label: 'JP proposes match', reachedAt: 'matched' },
  { key: 'consent', lane: 'facilitator', label: 'Both parties consent · contact exchanged', reachedAt: 'consented' },
  { key: 'draft', lane: 'broker', label: 'JP forwards draft', reachedAt: 'issued', stub: true },
  { key: 'issue', lane: 'issuer', label: 'Global Church issues agreement', reachedAt: 'issued', stub: true },
  { key: 'assert', lane: 'issuer', label: 'Optional public assertion', reachedAt: 'issued', stub: true },
];

/** Resolve the coarse member-readable phase from the panel inputs. Pure. */
export function matchPhase(input: MatchTimelineInput): MatchPhase {
  if (!input.requested) return 'declared';
  if (input.consented) return 'consented';
  if (input.matched) return 'matched';
  return 'declared';
}

/** True once the phase has reached/passed the milestone's `reachedAt`. */
function isReached(phase: MatchPhase, reachedAt: MatchPhase): boolean {
  return PHASE_RANK[phase] >= PHASE_RANK[reachedAt];
}

/** Derive the ordered swimlane milestones for one member match. Pure. The first not-done, non-stub
 *  milestone is `current`. Stub milestones (member-unreadable draft / issuance / assertion) are NEVER
 *  marked done and NEVER claim `current` — they sit as `upcoming` honest placeholders. */
export function agreementTimeline(input: MatchTimelineInput): TimelineStep[] {
  const phase = matchPhase(input);
  let currentAssigned = false;
  return MILESTONES.map((m) => {
    const done = !m.stub && isReached(phase, m.reachedAt);
    let state: StepState;
    if (done) {
      state = 'done';
    } else if (!currentAssigned && !m.stub) {
      state = 'current';
      currentAssigned = true;
    } else {
      state = 'upcoming';
    }
    return { ...m, state };
  });
}
