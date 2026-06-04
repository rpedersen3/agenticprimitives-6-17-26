// KC request-queue framing (production UX Wave D, design spec §11 "request queue" + the mockup
// `demo-gs-kc-dashboard.svg`). A compact "incoming requests · accept on your terms" header above the
// shared `AgreementsPanel` (role 'kc') — which remains the accept/decline surface. For each OPEN request
// it shows the matched-skill context as the lightweight "why this match": the overlapping skills the
// broker recorded on the request event (`statusEvents[0].evidence.skillUris`), mapped to labels via the
// taxonomy. We deliberately do NOT re-score — the KC can't read the GCO's raw need, so we show only the
// honest overlapping skills that drove the match, not a fabricated full reason breakdown.

import type { GsAgreement } from '../domain/gs-status';
import { skillLabels } from '../domain/score-match';
import { Card, Pill, SectionHead } from './ui';

/** The skills the broker recorded on a request (the overlap that drove the match). */
function matchedSkills(a: GsAgreement): string[] {
  const uris = a.statusEvents[0]?.evidence?.skillUris ?? [];
  return skillLabels(uris);
}

export function KcRequestQueue({ agreements }: { agreements: GsAgreement[] }) {
  const open = agreements.filter((a) => a.status === 'requested' || a.status === 'proposed');
  return (
    <Card style={{ background: 'var(--c-g50)' }}>
      <SectionHead
        eyebrow="Requests · accept on your terms"
        title={open.length === 0 ? 'No open connection requests' : `${open.length} open connection request${open.length === 1 ? '' : 's'}`}
        sub="GCOs whose needs overlap your published skills can request a connection. Your contact is released only when you accept — review the match below and accept or decline on your own terms."
      />
      {open.length === 0 ? (
        <p style={{ fontSize: '.86rem', color: 'var(--c-g500)' }}>
          When a GCO requests a connection, it appears here and in the agreements below — with the overlapping skills that
          drove the match. Publish a strong offering and browse the demand directory to improve your fit.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: '.5rem' }}>
          {open.map((a) => {
            const skills = matchedSkills(a);
            return (
              <div key={a.id} style={{ fontSize: '.82rem', color: 'var(--c-g700)' }}>
                <span style={{ fontWeight: 700, color: 'var(--c-g500)', textTransform: 'uppercase', fontSize: '.7rem', letterSpacing: '.03em' }}>Why this match · overlapping skills</span>
                <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', marginTop: '.3rem' }}>
                  {skills.length > 0
                    ? skills.map((l) => <Pill key={l} tone="ok">{l}</Pill>)
                    : <span style={{ color: 'var(--c-g500)' }}>matched on your offered skills</span>}
                </div>
              </div>
            );
          })}
          <p style={{ fontSize: '.78rem', color: 'var(--c-g500)', marginTop: '.2rem' }}>
            These are the skills the Switchboard recorded for the match — not the GCO&rsquo;s full confidential need, which you
            can&rsquo;t read until you accept. Accept or decline each request in the agreements card below.
          </p>
        </div>
      )}
    </Card>
  );
}
