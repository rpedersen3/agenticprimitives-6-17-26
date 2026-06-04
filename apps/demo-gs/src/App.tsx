// demo-gs shell (spec 250). Persona-driven: Pete (GCO) posts needs + requests connections; Jane
// (broker) runs the board + sees the public signal; Expert (KC) publishes an offering + accepts
// requests. The Need → Offering → IntentMatch → Agreement loop is visible end-to-end. v1 is
// fixture-driven (localStorage store); the seams are shaped for the deferred demo-sso / vault /
// graph / registry phases (spec 250 §20).

import { useState, useSyncExternalStore } from 'react';
import { PERSONA_META, actingAgents, loadPersona, savePersona, type Persona } from './lib/personas';
import { allAgreements, allNeeds, allOfferings, needsForOrg, offeringsForPerson, resetStore, subscribe, version } from './lib/store';
import { RoleSwitcher } from './components/RoleSwitcher';
import { GcoNeedWizard } from './components/GcoNeedWizard';
import { ExpertOfferingWizard } from './components/ExpertOfferingWizard';
import { MatchBoard } from './components/MatchBoard';
import { AgreementsPanel } from './components/AgreementsPanel';
import { PublicSignalPanel } from './components/PublicSignalPanel';
import { SubstrateClaimsPanel } from './components/SubstrateClaimsPanel';
import { Card, Pill, SectionHead } from './components/ui';

export function App() {
  const [persona, setPersona] = useState<Persona>(loadPersona() ?? 'pete');
  // Re-render on any store change (a real demo-sso/vault/graph would back this).
  useSyncExternalStore(subscribe, version, version);

  const select = (p: Persona) => { setPersona(p); savePersona(p); };
  const me = actingAgents(persona);
  const meta = PERSONA_META[persona];

  return (
    <>
      <header className="topbar">
        <div className="wrap">
          <div className="brand">
            <span className="brand-glyph" aria-hidden="true">🎛️</span>
            <span>Global Switchboard<small>skills · needs · offerings · matches</small></span>
          </div>
          <span className="powered">powered by <b>agentic primitives</b></span>
        </div>
      </header>

      <div className="wrap" style={{ padding: '1.5rem 1.25rem 0' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          <RoleSwitcher active={persona} onSelect={select} />
          <button onClick={resetStore} style={{ fontSize: '.76rem', color: 'var(--c-g400)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>reset demo data</button>
        </div>

        <Card style={{ marginBottom: '1.25rem', background: 'var(--c-primary-subtle)', borderColor: 'var(--c-primary-border)' }}>
          <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '1.4rem' }} aria-hidden="true">{meta.glyph}</span>
            <div>
              <strong style={{ fontSize: '.95rem' }}>{meta.label} · {meta.org}</strong>
              <p style={{ fontSize: '.82rem', color: 'var(--c-g600)', marginTop: '.15rem' }}>{meta.blurb}</p>
            </div>
            <span style={{ marginLeft: 'auto', fontSize: '.72rem', color: 'var(--c-g500)' }}>
              <Pill tone="neutral">Need → Offering → IntentMatch → Agreement</Pill>
            </span>
          </div>
        </Card>

        <div style={{ display: 'grid', gap: '1.25rem', paddingBottom: '2rem' }}>
          {persona === 'pete' && <PeteView person={me.person} org={me.org!} />}
          {persona === 'jane' && <JaneView personaActor={me.person} />}
          {persona === 'expert' && <ExpertView person={me.person} />}
        </div>
      </div>

      <footer>
        <div className="wrap">
          <span>demo-gs · Global Switchboard pattern demo · spec 250</span>
          <span>Sibling of demo-jp · fixture-driven (Phase 0/1)</span>
        </div>
      </footer>
    </>
  );
}

function PeteView({ person, org }: { person: `0x${string}`; org: `0x${string}` }) {
  const myNeeds = needsForOrg(org);
  return (
    <>
      <GcoNeedWizard />
      <Card>
        <SectionHead eyebrow="GCO · my needs" title="Posted needs" sub="Needs your organization has declared. The broker scores them against expert offerings on the match board below." />
        {myNeeds.length === 0 && <p style={{ fontSize: '.86rem', color: 'var(--c-g500)' }}>None yet.</p>}
        {myNeeds.map((n) => (
          <div key={n.id} style={{ display: 'flex', gap: '.5rem', alignItems: 'center', padding: '.4rem 0', borderBottom: '1px solid var(--c-g100)', fontSize: '.86rem', flexWrap: 'wrap' }}>
            <Pill tone={n.status === 'fulfilled' ? 'live' : n.status === 'open' ? 'ok' : 'warn'}>{n.status}</Pill>
            <span style={{ flex: 1 }}>{n.title}</span>
            {n.requiredSkills.map((s) => <span key={s.gcUri} style={{ fontSize: '.74rem', color: 'var(--c-g400)' }}>{s.label}</span>)}
          </div>
        ))}
      </Card>
      <MatchBoard needs={myNeeds} requestAsPerson={person} />
      <AgreementsPanel agreements={allAgreements()} role="pete" actorPerson={person} />
      <PublicSignalPanel needs={allNeeds()} offerings={allOfferings()} />
    </>
  );
}

function JaneView({ personaActor }: { personaActor: `0x${string}` }) {
  return (
    <>
      <Card style={{ background: 'var(--c-g50)' }}>
        <SectionHead eyebrow="Broker · intent spine" title="Global Switchboard broker" sub="You see all open needs + offerings, the explainable match board, and the public skill-gap signal. The agreement is the audit backbone for every brokered connection." />
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          <Pill tone="ok">{allNeeds().filter((n) => n.status !== 'fulfilled').length} active needs</Pill>
          <Pill tone="ok">{allOfferings().filter((o) => o.status === 'active').length} active offerings</Pill>
          <Pill tone="live">{allAgreements().length} agreements</Pill>
        </div>
      </Card>
      <MatchBoard needs={allNeeds()} />
      <AgreementsPanel agreements={allAgreements()} role="jane" actorPerson={personaActor} />
      <PublicSignalPanel needs={allNeeds()} offerings={allOfferings()} />
    </>
  );
}

function ExpertView({ person }: { person: `0x${string}` }) {
  const myOfferings = offeringsForPerson(person);
  const myAgreements = allAgreements().filter((a) => a.kcPersonAgentId.includes(person.toLowerCase()) || a.kcPersonAgentId.endsWith(person));
  const openNeeds = allNeeds().filter((n) => n.status === 'open');
  return (
    <>
      <ExpertOfferingWizard />
      <Card>
        <SectionHead eyebrow="KC · my offerings" title="Published offerings" />
        {myOfferings.length === 0 && <p style={{ fontSize: '.86rem', color: 'var(--c-g500)' }}>None yet — publish one above.</p>}
        {myOfferings.map((o) => (
          <div key={o.id} style={{ display: 'flex', gap: '.5rem', alignItems: 'center', padding: '.4rem 0', borderBottom: '1px solid var(--c-g100)', fontSize: '.86rem', flexWrap: 'wrap' }}>
            <Pill tone={o.status === 'active' ? 'live' : 'neutral'}>{o.capacity?.availabilityStatus ?? o.status}</Pill>
            <span style={{ flex: 1 }}>{o.headline}</span>
            {o.offeredSkills.slice(0, 4).map((s) => <span key={s.gcUri} style={{ fontSize: '.74rem', color: 'var(--c-g400)' }}>{s.label}</span>)}
          </div>
        ))}
      </Card>
      <SubstrateClaimsPanel offerings={myOfferings} />
      <AgreementsPanel agreements={myAgreements} role="expert" actorPerson={person} />
      <Card>
        <SectionHead eyebrow="Open needs" title="Where the demand is" sub="Public open needs you could serve. Switch to Jane to see the scored match board." />
        {openNeeds.map((n) => (
          <div key={n.id} style={{ display: 'flex', gap: '.5rem', alignItems: 'center', padding: '.35rem 0', fontSize: '.85rem', flexWrap: 'wrap' }}>
            <span style={{ flex: 1 }}>{n.title}</span>
            {n.requiredSkills.map((s) => <Pill key={s.gcUri} tone="ok">{s.label}</Pill>)}
            {n.geoFacets.map((g) => <Pill key={g.uri}>{g.label}</Pill>)}
          </div>
        ))}
      </Card>
    </>
  );
}
