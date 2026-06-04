// Match→agreement actor-swimlane timeline for ONE agreement (production UX Wave E, design spec §15a
// "Match And Agreement Timeline" + §15b/§15b.1 disclosure; the mockup `demo-gs-deep-match-agreement.svg`).
// Presentational + role-aware: it FRAMES the viewer (the panel passes its `role`) but never changes
// entitlement (the store already scopes which agreements each role sees). Four lanes
// (GCO Org · Global Switchboard broker · KC Expert · Global Church issuer) carry the lifecycle
// milestones; a concept-join row surfaces the canonical skills that drove the connection (the cross-app
// payoff, spec §3) with a best-effort on-chain verification badge; a who-can-see-what panel states the
// §15b.1 visibility rules; an opt-in public-assertion note appears once fulfilled. Contact is revealed
// only when the agreement carries it (post-accept) — never before.

import { useEffect, useState } from 'react';
import type { GsAgreement } from '../domain/gs-status';
import { CONNECTION_STATUS_LABEL } from '../domain/gs-status';
import type { Persona } from '../lib/personas';
import { skillByUri } from '../data/taxonomy';
import { skillOnChain } from '../lib/chain';
import { agentName } from '../lib/names';
import {
  agreementTimeline, isOffRamp, LANE_LABEL, LANE_ORDER, type StepState, type TimelineLane,
} from '../lib/agreement-timeline';
import { Banner, Pill, shortHex } from './ui';

/** The actor address shown on each lane's header (best-effort; the issuer is operator-side, not on the
 *  agreement record, so it stays generic). */
function laneActor(lane: TimelineLane, a: GsAgreement): string | undefined {
  if (lane === 'gco') return a.gcoOrgAgentId;
  if (lane === 'kc') return a.kcPersonAgentId;
  return undefined; // broker + issuer are operator surfaces, not parties on the record
}

function laneSubLabel(addr?: string): string | undefined {
  if (!addr) return undefined;
  const bare = addr.includes(':') ? addr.split(':').pop()! : addr;
  return agentName(bare) ?? shortHex(bare, 6, 4);
}

const DOT: Record<StepState, { bg: string; border: string; ring: string }> = {
  done: { bg: 'var(--c-primary)', border: 'var(--c-primary)', ring: 'none' },
  current: { bg: 'var(--c-primary)', border: 'var(--c-primary)', ring: '0 0 0 3px var(--c-primary-subtle)' },
  upcoming: { bg: '#fff', border: 'var(--c-g300)', ring: 'none' },
};

export function AgreementTimeline({ agreement, role }: {
  agreement: GsAgreement;
  role: Persona;
}) {
  const steps = agreementTimeline(agreement);
  // Per-lane ordered milestones (the visual swimlane layout).
  const byLane = (lane: TimelineLane) => steps.filter((s) => s.lane === lane);

  return (
    <div style={{ marginTop: '.7rem', display: 'grid', gap: '1rem' }}>
      {/* Actor swimlanes */}
      <div style={{ display: 'grid', gap: '.5rem' }}>
        {LANE_ORDER.map((lane) => {
          const actor = laneActor(lane, agreement);
          const sub = laneSubLabel(actor);
          const laneSteps = byLane(lane);
          return (
            <div key={lane} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 180px) 1fr', gap: '.6rem', alignItems: 'center' }}>
              <div style={{ borderRight: '2px solid var(--c-g100)', paddingRight: '.6rem' }}>
                <div style={{ fontSize: '.74rem', fontWeight: 800, color: 'var(--c-g700)' }}>{LANE_LABEL[lane]}</div>
                {sub && <div style={{ fontSize: '.7rem', color: 'var(--c-g400)' }}>{sub}</div>}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
                {laneSteps.length === 0 && <span style={{ fontSize: '.72rem', color: 'var(--c-g300)' }}>—</span>}
                {laneSteps.map((s) => (
                  <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
                    <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 999, flex: '0 0 auto', background: DOT[s.state].bg, border: `2px solid ${DOT[s.state].border}`, boxShadow: DOT[s.state].ring }} />
                    <span style={{ fontSize: '.74rem', fontWeight: s.state === 'upcoming' ? 400 : 700, color: s.state === 'upcoming' ? 'var(--c-g400)' : 'var(--c-g800)' }}>
                      {s.label}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {isOffRamp(agreement.status) && (
        <Banner tone="warn">This connection ended early ({CONNECTION_STATUS_LABEL[agreement.status]}) — the remaining steps were not reached.</Banner>
      )}

      {/* Concept-join row — the canonical skills that drove the connection (the cross-app payoff). */}
      <ConceptJoinRow agreement={agreement} />

      {/* Contact reveal — only when the agreement carries released contact (post-accept). */}
      {agreement.releasedKcContact && (
        <Banner tone="ok">
          Contact released on accept · GCO: {agreement.releasedGcoContact} · KC: {agreement.releasedKcContact}
          {agreement.channelRef ? ` · channel ${agreement.channelRef.channelId}` : ''}
        </Banner>
      )}

      {/* Who-can-see-what — the §15b.1 visibility rules, framed for the viewer. */}
      <WhoCanSeeWhat role={role} />

      {/* Opt-in public assertion — only once fulfilled; non-functional explainer. */}
      {agreement.status === 'fulfilled' && <PublicAssertionNote />}
    </div>
  );
}

// ─── Concept-join row ────────────────────────────────────────────────────────

/** The matched skills (from the first status event's evidence) as canonical-id chips with a best-effort
 *  on-chain badge. The verification is async + non-blocking (never throws, never blocks render). */
function ConceptJoinRow({ agreement }: { agreement: GsAgreement }) {
  const skillUris = agreement.statusEvents[0]?.evidence?.skillUris ?? [];
  const skills = skillUris.map(skillByUri).filter((s): s is NonNullable<typeof s> => !!s);

  if (skills.length === 0) {
    return (
      <div style={subPanel}>
        <div className="eyebrow">Concept join · matched skills</div>
        <p style={{ fontSize: '.78rem', color: 'var(--c-g500)', marginTop: '.35rem' }}>
          No canonical skill evidence was recorded for this connection.
        </p>
      </div>
    );
  }

  return (
    <div style={subPanel}>
      <div className="eyebrow">Concept join · matched skills</div>
      <p style={{ fontSize: '.78rem', color: 'var(--c-g500)', margin: '.35rem 0 .55rem' }}>
        Needs and offerings cite the same canonical skill ids — they join on concept identity, not free text.
        Labels are display only.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
        {skills.map((s) => <SkillChip key={s.gcUri} label={s.label} skillId={s.skillId} />)}
      </div>
    </div>
  );
}

/** A single canonical-skill chip. Verifies the pinned `(skillId, version 1)` against the live
 *  SkillDefinitionRegistry best-effort: "verified on-chain" when it resolves true, otherwise a neutral
 *  "canonical reference". Never blocks render; swallows network errors. */
function SkillChip({ label, skillId }: { label: string; skillId: `0x${string}` }) {
  const [verified, setVerified] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void skillOnChain({ skillId, version: 1 })
      .then((ok) => { if (live) setVerified(ok); })
      .catch(() => { if (live) setVerified(false); });
    return () => { live = false; };
  }, [skillId]);

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', border: '1px solid var(--c-g200)', borderRadius: 999, padding: '.25rem .6rem', background: '#fff' }}>
      <span style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--c-g800)' }}>{label}</span>
      <code title={skillId} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '.66rem', color: 'var(--c-g400)' }}>
        {shortHex(skillId, 6, 4)}
      </code>
      {verified === true
        ? <Pill tone="live">⛓ verified on-chain</Pill>
        : <Pill tone="neutral">⛓ canonical reference</Pill>}
    </span>
  );
}

// ─── Who-can-see-what ────────────────────────────────────────────────────────

/** The §15a/§15b.1 visibility rules as a compact, honest list. Framed for the viewer's role. */
function WhoCanSeeWhat({ role }: { role: Persona }) {
  const youAre = role === 'gco' ? 'As the GCO org, you'
    : role === 'kc' ? 'As the KC expert, you'
      : role === 'jane' ? 'As the Switchboard broker, you'
        : role === 'pete' ? 'As the Global Church issuer, you' : 'You';
  const youSee = role === 'gco' ? 'see your own posted need + the coarsened public supply; you never see another KC’s raw offering.'
    : role === 'kc' ? 'see your own offering + the coarsened public demand + requests routed to you; you never browse other needs.'
      : role === 'jane' ? 'see both sides — but only through the grant each member issued at sign-in (a revoked grant drops that member).'
        : role === 'pete' ? 'see the agreement + issuance backbone only — never member needs, offerings, or contact.' : '';

  return (
    <div style={{ ...subPanel, background: '#f0f9ff', borderColor: '#bae6fd' }}>
      <div className="eyebrow" style={{ color: '#0369a1' }}>Who can see what</div>
      <ul style={{ margin: '.45rem 0 0', paddingLeft: '1.1rem', fontSize: '.78rem', color: '#075985', lineHeight: 1.55 }}>
        <li><strong>{youAre}</strong> {youSee}</li>
        <li>Members’ needs and offerings are <strong>private</strong> — each lives in its owner’s Global.Church vault.</li>
        <li>The broker sees <strong>both sides</strong> only via the scoped grants members issued; the public sees <strong>only coarsened aggregates</strong>.</li>
        <li><strong>“This KC matched this need” is confidential</strong> — never part of the public feed.</li>
        <li>Global Church <strong>issues</strong> the agreement but does <strong>not</strong> broker or read member data.</li>
        <li>A public assertion is <strong>explicit + opt-in</strong>; <strong>person↔org links are never published</strong>.</li>
      </ul>
      <p style={{ fontSize: '.7rem', color: '#0369a1', marginTop: '.5rem', fontStyle: 'italic' }}>
        Today the vault boundary is owner-keyed — a grant opens the owner’s vault namespace; record-level
        scope is the intended model, enforceable with spec 248 (operator keys are deterministic demo keys).
      </p>
    </div>
  );
}

// ─── Public assertion (opt-in, non-functional) ──────────────────────────────

function PublicAssertionNote() {
  return (
    <div style={{ ...subPanel, background: 'var(--c-primary-subtle)', borderColor: 'var(--c-primary-border)' }}>
      <div className="eyebrow" style={{ color: 'var(--c-primary-active)' }}>Optional public assertion</div>
      <p style={{ fontSize: '.78rem', color: 'var(--c-primary-active)', marginTop: '.35rem', lineHeight: 1.55 }}>
        This connection is fulfilled. Both parties <strong>may choose</strong> to publish a public assertion of the
        connection — <strong>never automatic, never person↔org links</strong>. It’s opt-in only, and nothing is published
        unless both sides explicitly agree.
      </p>
      <button
        disabled
        title="No on-chain assertion is wired in this demo."
        style={{ marginTop: '.5rem', borderRadius: 10, padding: '.4rem .8rem', fontSize: '.78rem', fontWeight: 700, border: '1.5px solid var(--c-primary-border)', background: '#fff', color: 'var(--c-g400)', cursor: 'not-allowed' }}
      >
        Publish a public assertion (coming soon)
      </button>
    </div>
  );
}

const subPanel = { border: '1px solid var(--c-g200)', borderRadius: 12, padding: '.7rem .85rem', background: 'var(--c-g50)' } as const;
