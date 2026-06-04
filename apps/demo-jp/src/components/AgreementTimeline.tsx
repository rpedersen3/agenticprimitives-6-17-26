// Match→agreement actor-swimlane timeline for ONE member match (production UX Wave 5, design spec §15a
// "Match And Agreement Timeline" + §15b/§15b.1 disclosure; the mockup `demo-gs-deep-match-agreement.svg`).
// MUI, mirroring demo-gs's Wave-E `AgreementTimeline.tsx` mapped to the demo-jp four-actor model.
// Presentational + role-aware: it FRAMES the viewer (the panel passes its member `role`) but never
// changes entitlement — the store already scopes what each member can read. Four lanes
// (Adopter · JP broker · Facilitator · Global Church issuer) carry the lifecycle milestones; a
// who-can-see-what panel states the §15b.1 visibility rules; a contact reveal appears only post-consent
// (reusing the existing contact-exchange gate, passed in); an opt-in public-assertion note appears once
// an agreement could be issued.
//
// NO ADMIN LINKS HERE. The spec §15a mentions "demo shortcuts to Jill/Pete admin surfaces", but the
// user's standing rule (mirrored from demo-gs Wave E) overrides it: NO admin links / data on member
// (adopter / facilitator) pages — Pete/Jill are reachable ONLY from the header "Admin" dropdown. So this
// member-facing timeline deliberately renders no Jill/Pete jump links.
//
// HONESTY (spec 248): the draft / issuance / public-assertion milestones are member-unreadable stubs
// (see `agreement-timeline.ts`) — shown as honest "not visible from your home" placeholders, never
// fabricated as done. The vault boundary is owner-keyed today; record-level scope is the intended model,
// enforceable with spec 248.

import { Box, Typography } from '@mui/material';
import { JP } from '../lib/brand';
import {
  agreementTimeline, LANE_LABEL, LANE_ORDER,
  type MatchTimelineInput, type StepState, type TimelineLane,
} from '../lib/agreement-timeline';

/** The member viewer role (adopter / facilitator workspaces). Frames the copy; never changes access. */
export type TimelineRole = 'adopter' | 'facilitator';

const DOT: Record<StepState, { bg: string; border: string; ring: string }> = {
  done: { bg: 'var(--c-primary)', border: 'var(--c-primary)', ring: 'none' },
  current: { bg: 'var(--c-primary)', border: 'var(--c-primary)', ring: '0 0 0 3px var(--c-primary-subtle)' },
  upcoming: { bg: '#fff', border: 'var(--c-g300)', ring: 'none' },
};

/** The counter-party display name for the lane subtitle (the OTHER party, framed for the viewer). */
function laneSubLabel(lane: TimelineLane, role: TimelineRole, partyLabel?: string): string | undefined {
  // The viewer's own lane is labelled "you"; the matched counter-party's lane shows its label.
  if (role === 'adopter') {
    if (lane === 'adopter') return 'you';
    if (lane === 'facilitator') return partyLabel;
  } else {
    if (lane === 'facilitator') return 'you';
    if (lane === 'adopter') return partyLabel;
  }
  return undefined; // broker + issuer are operator surfaces, not parties on the member's view
}

export function AgreementTimeline({
  role, input, partyLabel, contactRevealed, contactNode,
}: {
  /** The member viewer's workspace role. */
  role: TimelineRole;
  /** The member-readable match state (requested / matched / consented). */
  input: MatchTimelineInput;
  /** The matched counter-party's display label (for the counter-party's lane subtitle). */
  partyLabel?: string;
  /** True once contact exchange has happened (post-consent). Gated by the panel — never pre-consent. */
  contactRevealed: boolean;
  /** The already-rendered released-contact block (reuses the panel's ContactExchangeWidget output). */
  contactNode?: React.ReactNode;
}) {
  const steps = agreementTimeline(input);
  const byLane = (lane: TimelineLane) => steps.filter((s) => s.lane === lane);

  return (
    <Box sx={{ mt: 1.5, display: 'grid', gap: 2 }}>
      {/* Actor swimlanes */}
      <Box sx={{ display: 'grid', gap: 1 }}>
        {LANE_ORDER.map((lane) => {
          const sub = laneSubLabel(lane, role, partyLabel);
          const laneSteps = byLane(lane);
          return (
            <Box
              key={lane}
              sx={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 190px) 1fr', gap: 1, alignItems: 'center' }}
            >
              <Box sx={{ borderRight: '2px solid var(--c-g100)', pr: 1 }}>
                <Typography sx={{ fontSize: '.78rem', fontWeight: 800, color: 'var(--c-g700)' }}>
                  {LANE_LABEL[lane]}
                </Typography>
                {sub && (
                  <Typography sx={{ fontSize: '.72rem', color: 'var(--c-g400)' }}>{sub}</Typography>
                )}
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {laneSteps.length === 0 && (
                  <Typography component="span" sx={{ fontSize: '.74rem', color: 'var(--c-g300)' }}>—</Typography>
                )}
                {laneSteps.map((s) => (
                  <Box key={s.key} component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                    <Box
                      aria-hidden
                      component="span"
                      sx={{
                        width: 12, height: 12, borderRadius: 999, flex: '0 0 auto',
                        background: DOT[s.state].bg, border: `2px solid ${DOT[s.state].border}`, boxShadow: DOT[s.state].ring,
                      }}
                    />
                    <Typography
                      component="span"
                      sx={{
                        fontSize: '.76rem',
                        fontWeight: s.state === 'upcoming' ? 400 : 700,
                        color: s.state === 'upcoming' ? 'var(--c-g400)' : 'var(--c-g800)',
                      }}
                    >
                      {s.label}
                      {s.stub && (
                        <Box
                          component="span"
                          sx={{ ml: 0.5, fontSize: '.64rem', fontWeight: 700, color: 'var(--c-g300)', fontStyle: 'italic' }}
                        >
                          (not visible from your home)
                        </Box>
                      )}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Contact reveal — only when the exchange has happened (post-consent). Reuses the panel's block. */}
      {contactRevealed && contactNode}

      {/* Who-can-see-what — the §15b.1 visibility rules, framed for the viewer's member role. */}
      <WhoCanSeeWhat role={role} />

      {/* Opt-in public assertion — non-functional explainer. */}
      <PublicAssertionNote />
    </Box>
  );
}

// ─── Who-can-see-what ────────────────────────────────────────────────────────

/** The §15a/§15b.1 visibility rules as a compact, honest list, framed for the member's role. */
function WhoCanSeeWhat({ role }: { role: TimelineRole }) {
  const youAre = role === 'adopter' ? 'As the adopter, you' : 'As the facilitator, you';
  const youSee = role === 'adopter'
    ? 'see your own adoption + the scoped facilitator slices JP released to you; you never browse other adopters or the JP broker pool.'
    : 'see your own coverage + the scoped adopter slices JP released to you; you never browse other facilitators or unreleased adopter requests.';

  return (
    <Box sx={{ ...subPanel, background: '#f0f9ff', borderColor: '#bae6fd' }}>
      <Typography
        variant="overline"
        sx={{ display: 'block', color: '#0369a1', fontWeight: 800, letterSpacing: '.08em', lineHeight: 1.4 }}
      >
        Who can see what
      </Typography>
      <Box component="ul" sx={{ m: '.45rem 0 0', pl: '1.1rem', fontSize: '.78rem', color: '#075985', lineHeight: 1.55 }}>
        <li><strong>{youAre}</strong> {youSee}</li>
        <li>Your profile, documents, and contact stay <strong>private</strong> in your {JP.impactName} vault — the default is the owner-keyed private credential.</li>
        <li>{JP.org} <strong>brokers</strong> the match and may see the agreement <strong>draft</strong> for brokerage in the current model — never your raw vault.</li>
        <li>Global Church <strong>issues</strong> the agreement credential but does <strong>not</strong> broker or read member data.</li>
        <li><strong>The public never sees person↔org links.</strong> A public assertion is <strong>explicit + opt-in</strong> only.</li>
      </Box>
      <Typography sx={{ fontSize: '.7rem', color: '#0369a1', mt: 1, fontStyle: 'italic' }}>
        Today the vault boundary is owner-keyed — a grant opens the owner’s vault namespace; record-level
        scope is the intended model, enforceable with spec 248. This is a demo: don’t read it as enforced
        production access.
      </Typography>
    </Box>
  );
}

// ─── Public assertion (opt-in, non-functional) ──────────────────────────────

function PublicAssertionNote() {
  return (
    <Box sx={{ ...subPanel, background: 'var(--c-primary-subtle)', borderColor: 'var(--c-primary-border)' }}>
      <Typography
        variant="overline"
        sx={{ display: 'block', color: 'var(--c-primary-active)', fontWeight: 800, letterSpacing: '.08em', lineHeight: 1.4 }}
      >
        Optional public assertion
      </Typography>
      <Typography sx={{ fontSize: '.78rem', color: 'var(--c-primary-active)', mt: 0.5, lineHeight: 1.55 }}>
        Once an agreement is issued, both parties <strong>may choose</strong> to publish a public assertion of the
        relationship — <strong>never automatic, never person↔org links</strong>. It’s opt-in only, and nothing is
        published unless both sides explicitly agree.
      </Typography>
      <Box
        component="button"
        disabled
        title="No on-chain assertion is wired in this demo."
        sx={{
          mt: 1, borderRadius: '10px', px: 1.6, py: 0.8, fontSize: '.78rem', fontWeight: 700,
          border: '1.5px solid var(--c-primary-border)', background: '#fff', color: 'var(--c-g400)', cursor: 'not-allowed',
        }}
      >
        Publish a public assertion (coming soon)
      </Box>
    </Box>
  );
}

const subPanel = {
  border: '1px solid var(--c-g200)', borderRadius: '12px', p: '.7rem .85rem', background: 'var(--c-g50)',
} as const;
