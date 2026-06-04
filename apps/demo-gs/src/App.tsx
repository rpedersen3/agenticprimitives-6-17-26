// demo-gs shell (spec 250). 4 roles mirroring demo-jp: a GCO Organization (demand; a person creates
// an org that holds the GCO role + posts Needs), a KC Expert (supply; an individual person with
// skills), Jane/Global Switchboard (broker), Pete/Global Church (issuer). New GCO orgs + KC people
// can be CREATED in-app (the Adopter/Facilitator analog). The Need → Offering → IntentMatch →
// Agreement loop is visible end-to-end. v1 is fixture-driven; Phase 1 swaps creation for demo-sso.

import { useState, useSyncExternalStore } from 'react';
import { PERSONA_META, actingAgents, loadPersona, savePersona, type Persona } from './lib/personas';
import { allAgreements, allNeeds, allOfferings, needsForOrg, offeringsForPerson, resetStore, subscribe, version } from './lib/store';
import {
  activeGco, activeKc, createGco, createKc, gcoMembers, kcMembers, membersVersion, setActiveGco, setActiveKc, subscribeMembers,
} from './lib/members';
import { RoleSwitcher } from './components/RoleSwitcher';
import { MemberPicker } from './components/MemberPicker';
import { GcoNeedWizard } from './components/GcoNeedWizard';
import { ExpertOfferingWizard } from './components/ExpertOfferingWizard';
import { MatchBoard } from './components/MatchBoard';
import { AgreementsPanel } from './components/AgreementsPanel';
import { PublicSignalPanel } from './components/PublicSignalPanel';
import { SubstrateClaimsPanel } from './components/SubstrateClaimsPanel';
import { Card, Pill, SectionHead } from './components/ui';

export function App() {
  const [persona, setPersona] = useState<Persona>(loadPersona() ?? 'gco');
  // Re-render on any store / member change (a real demo-sso/vault/graph would back this).
  useSyncExternalStore(subscribe, version, version);
  useSyncExternalStore(subscribeMembers, membersVersion, membersVersion);

  const select = (p: Persona) => { setPersona(p); savePersona(p); };
  // For gco/kc the identity is the ACTIVE created member; operators use their fixed org.
  const me = persona === 'gco' ? { person: activeGco().person, org: activeGco().org }
    : persona === 'kc' ? { person: activeKc().person }
    : actingAgents(persona);
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
          {persona === 'gco' && <GcoView />}
          {persona === 'kc' && <KcView />}
          {persona === 'jane' && <JaneView personaActor={me.person} />}
          {persona === 'pete' && <PeteView personaActor={me.person} />}
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

// The GCO Organization (demand). A connected person CREATES an org that holds the GCO role + posts
// Needs; you act as its signatory. New GCO orgs can be created + switched between (demo-jp Adopter).
function GcoView() {
  const gco = activeGco();
  const myNeeds = needsForOrg(gco.org);
  return (
    <>
      <MemberPicker
        eyebrow="GCO Organization · demand"
        title="Your GCO organization"
        sub="A connected person creates an organization that takes the GCO (Great Commission Organization) role — you act as its signatory, and the ORG posts the Needs. Create another, or switch between them."
        options={gcoMembers().map((m) => ({ id: m.id, label: `${m.orgName} · signatory ${m.signatory}` }))}
        activeId={gco.id}
        onSelect={setActiveGco}
        createLabel="Create a GCO organization"
        fields={[{ key: 'signatory', placeholder: 'Signatory name (the person)' }, { key: 'orgName', placeholder: 'GCO org name (e.g. Hope Church Missions Team)' }]}
        onCreate={(v) => createGco(v.signatory!, v.orgName!)}
      />
      <GcoNeedWizard ownerOrg={gco.org} signatory={gco.person} />
      <Card>
        <SectionHead eyebrow="GCO Org · my needs" title="Posted needs" sub={`Needs ${gco.orgName} has declared. The Switchboard scores them against KC offerings on the match board below — request a connection to start an agreement.`} />
        {myNeeds.length === 0 && <p style={{ fontSize: '.86rem', color: 'var(--c-g500)' }}>None yet — post one above.</p>}
        {myNeeds.map((n) => (
          <div key={n.id} style={{ display: 'flex', gap: '.5rem', alignItems: 'center', padding: '.4rem 0', borderBottom: '1px solid var(--c-g100)', fontSize: '.86rem', flexWrap: 'wrap' }}>
            <Pill tone={n.status === 'fulfilled' ? 'live' : n.status === 'open' ? 'ok' : 'warn'}>{n.status}</Pill>
            <span style={{ flex: 1 }}>{n.title}</span>
            {n.requiredSkills.map((s) => <span key={s.gcUri} style={{ fontSize: '.74rem', color: 'var(--c-g400)' }}>{s.label}</span>)}
          </div>
        ))}
      </Card>
      <MatchBoard needs={myNeeds} requestAsPerson={gco.person} />
      <AgreementsPanel agreements={allAgreements()} role="gco" actorPerson={gco.person} />
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

// The KC Expert (supply) — an INDIVIDUAL person agent with skills (the facilitator analog).
// Publishes an Offering + accepts requests. New KC people can be created + matched against.
function KcView() {
  const kc = activeKc();
  const myOfferings = offeringsForPerson(kc.person);
  const myAgreements = allAgreements().filter((a) => a.kcPersonAgentId.toLowerCase().includes(kc.person.toLowerCase()));
  const openNeeds = allNeeds().filter((n) => n.status === 'open');
  return (
    <>
      <MemberPicker
        eyebrow="KC Expert · supply"
        title="Your KC expert"
        sub="A KC Expert is an INDIVIDUAL person agent with skills — we create new expert people whose skills the Switchboard matches against. Create another, or switch between them."
        options={kcMembers().map((m) => ({ id: m.id, label: m.name }))}
        activeId={kc.id}
        onSelect={setActiveKc}
        createLabel="Create a KC expert"
        fields={[{ key: 'name', placeholder: 'KC expert name (e.g. Alex — Bible Translation)' }]}
        onCreate={(v) => createKc(v.name!)}
      />
      <ExpertOfferingWizard owner={kc.person} ownerName={kc.name} />
      <Card>
        <SectionHead eyebrow="KC Expert · my offerings" title="Published offerings" />
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
      <AgreementsPanel agreements={myAgreements} role="kc" actorPerson={kc.person} />
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

// Global Church — the ISSUER operator (the same Global Church org as demo-jp; NOT a GCO). Issues
// the connection agreement once the GCO org + KC have agreed, then runs it through its lifecycle.
function PeteView({ personaActor }: { personaActor: `0x${string}` }) {
  return (
    <>
      <Card style={{ background: 'var(--c-g50)' }}>
        <SectionHead eyebrow="Issuer · Global Church" title="Issuance desk" sub="Global Church is the ISSUER org (the same as demo-jp — NOT a GCO). Once the GCO organization and a KC expert have confirmed a connection, Global Church issues the agreement here and it runs through its lifecycle (issue → ongoing → fulfilled)." />
        <Pill tone="live">{allAgreements().length} agreement(s) on record</Pill>
      </Card>
      <AgreementsPanel agreements={allAgreements()} role="pete" actorPerson={personaActor} />
      <PublicSignalPanel needs={allNeeds()} offerings={allOfferings()} />
    </>
  );
}
