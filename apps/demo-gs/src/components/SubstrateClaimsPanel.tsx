// Phase 3 — shows a KC's offered skills + regions expressed as the real substrate's CLAIM
// CREDENTIALS (spec 251). Each is a self-issued VC pointing to an on-chain definition
// (skillId / featureId, version), held in the KC's vault. This is the bridge between the
// Switchboard domain projection and the generic agent-skills / geo-features substrate.

import { useMemo } from 'react';
import type { ExpertOffering } from '../domain/gs-types';
import { skillByUri } from '../data/taxonomy';
import { offeringGeoClaims, offeringSkillClaims } from '../lib/substrate';
import { Card, Mono, Pill, SectionHead, shortHex } from './ui';

export function SubstrateClaimsPanel({ offerings }: { offerings: ExpertOffering[] }) {
  const rows = useMemo(
    () => offerings.map((o) => ({ offering: o, skills: offeringSkillClaims(o), geo: offeringGeoClaims(o) })),
    [offerings],
  );

  return (
    <Card>
      <SectionHead
        eyebrow="Substrate · skills + geo (spec 251)"
        title="Your vault claim credentials"
        sub="Your offered skills + regions, expressed as the generic substrate's claim credentials. Each is a self-issued VC that points to an on-chain definition (skillId / featureId) and lives in YOUR vault — private until you consent to share. The on-chain registries hold only the neutral definitions; the association to you stays off chain."
      />
      {rows.length === 0 && <p style={{ fontSize: '.86rem', color: 'var(--c-g500)' }}>Publish an offering to mint skill/geo claims.</p>}
      {rows.map(({ offering, skills, geo }) => (
        <div key={offering.id} style={{ border: '1px solid var(--c-g200)', borderRadius: 12, padding: '.85rem 1rem', marginBottom: '.7rem' }}>
          <div style={{ fontSize: '.88rem', fontWeight: 700, marginBottom: '.5rem' }}>{offering.headline}</div>

          <h4 style={head}>Skill claims · relation hasSkill</h4>
          {skills.map((c) => {
            const skillUri = offering.offeredSkills.find((s) => s.skillId === c.credentialSubject.definition.skillId);
            return (
              <div key={c.credentialSubject.claimId} style={claimRow}>
                <Pill tone="ok">{skillUri ? skillByUri(skillUri.gcUri)?.label ?? skillUri.label : 'skill'}</Pill>
                <span style={meta}>skillId <Mono>{shortHex(c.credentialSubject.definition.skillId, 8, 6)}</Mono> v{c.credentialSubject.definition.version}</span>
                <Pill tone="neutral">{c.credentialSubject.visibility}</Pill>
                <span style={meta}>claim <Mono>{shortHex(c.credentialSubject.claimId, 6, 4)}</Mono></span>
              </div>
            );
          })}

          {geo.length > 0 && (
            <>
              <h4 style={{ ...head, marginTop: '.7rem' }}>Geo claims · relation servesWithin</h4>
              {geo.map((c) => (
                <div key={c.credentialSubject.claimId} style={claimRow}>
                  <Pill>{(offering.geoFacets ?? []).find((g) => g.featureId === c.credentialSubject.feature.featureId)?.label ?? 'region'}</Pill>
                  <span style={meta}>featureId <Mono>{shortHex(c.credentialSubject.feature.featureId, 8, 6)}</Mono> v{c.credentialSubject.feature.version}</span>
                  <Pill tone="neutral">{c.credentialSubject.visibility}</Pill>
                </div>
              ))}
            </>
          )}
        </div>
      ))}
    </Card>
  );
}

const head: React.CSSProperties = { fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--c-g500)', margin: '0 0 .35rem' };
const claimRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', padding: '.2rem 0', fontSize: '.8rem' };
const meta: React.CSSProperties = { color: 'var(--c-g500)' };
