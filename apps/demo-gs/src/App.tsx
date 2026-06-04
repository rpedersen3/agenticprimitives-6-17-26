// demo-gs shell (spec 250). 4 roles mirroring demo-jp: a GCO Organization (demand; a person creates
// an org that holds the GCO role + posts Needs), a KC Expert (supply; an individual person with
// skills), Jane/Global Switchboard (broker), Pete/Global Church (issuer). New GCO orgs + KC people
// can be CREATED in-app (the Adopter/Facilitator analog). The Need → Offering → IntentMatch →
// Agreement loop is visible end-to-end. v1 is fixture-driven; Phase 1 swaps creation for demo-sso.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { PERSONA_META, actingAgents, loadPersona, savePersona, type Persona } from './lib/personas';
import { allAgreements, allNeeds, allOfferings, needsForOrg, offeringsForPerson, resetStore, subscribe, version } from './lib/store';
import {
  activeGco, activeKc, attachGcoOrg, createConnectedGcoPerson, createConnectedKc, createGco, createKc, gcoMembers, isEntered, kcMembers, membersVersion, setActiveGco, setActiveKc, setEntered, subscribeMembers,
} from './lib/members';
import { exchangeCode, personAddressFromIdToken, startOrgCreation } from './connect-client';
import { RoleSwitcher } from './components/RoleSwitcher';
import { MemberPicker } from './components/MemberPicker';
import { OnboardPanel, CONNECT_KEY, type ConnectStash } from './components/OnboardPanel';
import { GcoNeedWizard } from './components/GcoNeedWizard';
import { ExpertOfferingWizard } from './components/ExpertOfferingWizard';
import { MatchBoard } from './components/MatchBoard';
import { AgreementsPanel } from './components/AgreementsPanel';
import { PublicSignalPanel } from './components/PublicSignalPanel';
import { SubstrateClaimsPanel } from './components/SubstrateClaimsPanel';
import { SwitchboardBridgePanel } from './components/SwitchboardBridgePanel';
import { Banner, Card, Pill, SectionHead, inputStyle } from './components/ui';
import { personalHome } from './lib/domain';

/** sessionStorage key + stash for the in-flight org-create redirect (GCO step 2). */
const ORG_KEY = 'agenticprimitives:demo-gs:org-create';
interface OrgStash { state: string; orgName: string; authOrigin: string; codeVerifier: string; nonce: string }

export function App() {
  const [persona, setPersona] = useState<Persona>(loadPersona() ?? 'gco');
  // Re-render on any store / member change (a real demo-sso/vault/graph would back this).
  useSyncExternalStore(subscribe, version, version);
  useSyncExternalStore(subscribeMembers, membersVersion, membersVersion);

  const [connectError, setConnectError] = useState<string | null>(null);
  const select = (p: Persona) => { setPersona(p); savePersona(p); };

  // Connect return handler (Phase 1): a person came back from their secure home with ?code&state.
  // TWO ceremonies land here (mirrors demo-jp): (1) the site-login that enrolls the PERSON — KC acts
  // as that individual, a GCO signatory becomes a member with the org still pending; and (2) the
  // later org-create that deploys the GCO org SA — its return ATTACHES the org to the active member.
  useEffect(() => {
    const u = new URL(window.location.href);
    const code = u.searchParams.get('code');
    const retState = u.searchParams.get('state');
    if (!code || !retState) return;
    for (const k of ['code', 'state']) u.searchParams.delete(k);
    window.history.replaceState({}, '', u.toString());

    // Org-create return first — its state won't match the site-login stash.
    let orgStash: Partial<OrgStash> = {};
    try { orgStash = JSON.parse(sessionStorage.getItem(ORG_KEY) ?? '{}'); } catch { /* ignore */ }
    if (orgStash.state && orgStash.state === retState) {
      sessionStorage.removeItem(ORG_KEY);
      if (!orgStash.authOrigin || !orgStash.codeVerifier) { setConnectError('Organization response was incomplete. Please try again.'); return; }
      void (async () => {
        try {
          const tok = await exchangeCode(orgStash.authOrigin!, code, orgStash.codeVerifier!);
          if (!tok.org) throw new Error('no organization was returned from your home');
          attachGcoOrg(tok.org.orgName, tok.org.orgAgent);
          select('gco');
        } catch (e) {
          setConnectError(e instanceof Error ? e.message : String(e));
        }
      })();
      return;
    }

    // Site-login return — enroll the person.
    let stash: Partial<ConnectStash> = {};
    try { stash = JSON.parse(sessionStorage.getItem(CONNECT_KEY) ?? '{}'); } catch { /* ignore */ }
    sessionStorage.removeItem(CONNECT_KEY);
    if (!stash.state || stash.state !== retState || !stash.authOrigin || !stash.codeVerifier || !stash.name) {
      setConnectError("We couldn't verify that sign-in response. Please try again.");
      return;
    }
    void (async () => {
      try {
        const tok = await exchangeCode(stash.authOrigin!, code, stash.codeVerifier!);
        const person = personAddressFromIdToken(tok.idToken);
        if (stash.mode === 'gco') {
          createConnectedGcoPerson(stash.name!, person);
          select('gco');
        } else {
          createConnectedKc(stash.name!, person);
          select('kc');
        }
      } catch (e) {
        setConnectError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

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

        {connectError && <div style={{ marginBottom: '1rem' }}><Banner tone="err">{connectError}</Banner></div>}

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

// Thin "you're inside the member intranet" bar with a sign-out back to the onboarding landing.
function IntranetHeader({ label, role, onSignOut }: { label: string; role: string; onSignOut: () => void }) {
  return (
    <Card style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap', background: 'var(--c-g50)', padding: '.7rem 1rem' }}>
      <span style={{ fontSize: '.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--c-g500)' }}>{role} intranet</span>
      <span style={{ fontSize: '.9rem', fontWeight: 700, color: 'var(--c-g800)' }}>{label}</span>
      <button onClick={onSignOut} style={{ marginLeft: 'auto', fontSize: '.76rem', color: 'var(--c-g500)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
        sign out / register another
      </button>
    </Card>
  );
}

// GCO step 2: the person has connected; now create the ORG that takes the GCO role. The org SA is
// deployed + custodied by the person's ROOT credential at their home (org-create ceremony) — demo-gs
// is never a custodian. On return the org is attached to this member (see App's org-create handler).
function GcoOrgCreate({ gco, onSignOut }: { gco: ReturnType<typeof activeGco>; onSignOut: () => void }) {
  const [orgName, setOrgName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function createOrg() {
    if (!orgName.trim()) { setErr('Name the organization that takes the GCO role.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await startOrgCreation(gco.signatory, orgName.trim());
      const stash: OrgStash = { state: r.state, orgName: orgName.trim(), authOrigin: r.authOrigin, codeVerifier: r.codeVerifier, nonce: r.nonce };
      sessionStorage.setItem(ORG_KEY, JSON.stringify(stash));
      window.location.href = r.url; // → the signatory's home; deploys the org SA; returns with ?code&state
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <>
      <IntranetHeader label={`${gco.signatory} · connected`} role="GCO Organization" onSignOut={onSignOut} />
      <Card style={{ maxWidth: 640 }}>
        <div className="eyebrow">GCO Organization · step 2 of 2</div>
        <h2 style={{ fontSize: '1.35rem', marginTop: '.35rem' }}>Create the organization that holds the GCO role</h2>
        <p style={{ color: 'var(--c-g600)', marginTop: '.6rem', fontSize: '.9rem' }}>
          You&rsquo;re connected as <strong>{gco.signatory}</strong>. Now name the organization (e.g. <em>Hope Church
          Missions Team</em>) — it becomes a Smart Agent that takes the Great Commission Organization role and posts
          the skill Needs. It&rsquo;s deployed + custodied by <strong>your</strong> credential at your home; Global
          Switchboard is never a custodian.
        </p>
        <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '.6rem', maxWidth: 460 }}>
          <input
            type="text" value={orgName} placeholder="GCO organization name (e.g. Hope Church Missions Team)" disabled={busy}
            onChange={(e) => setOrgName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void createOrg(); }}
            style={{ ...inputStyle, padding: '.7rem .9rem', fontSize: '.95rem' }}
          />
          <button className="btn-sso" onClick={createOrg} disabled={!orgName.trim() || busy}>
            <span className="btn-sso-glyph" aria-hidden="true">🏛️</span>
            {busy ? 'Opening your home…' : 'Create the GCO organization'}
          </button>
          {err && <Banner tone="err">{err}</Banner>}
          <span className="soon" style={{ background: 'var(--c-primary-subtle)', borderColor: 'var(--c-primary-border)', color: 'var(--c-primary-active)' }}>
            You&rsquo;ll confirm with your device at <b>{personalHome(gco.signatory)}</b> to deploy the org, then come back here.
          </span>
        </div>
      </Card>
    </>
  );
}

// The GCO Organization (demand). Until the member has registered (connected via Global.Church or
// chosen a sample identity) we show the onboarding landing; then the intranet — a connected person
// CREATES an org that holds the GCO role + posts Needs; you act as its signatory. (demo-jp Adopter.)
function GcoView() {
  if (!isEntered('gco')) return <OnboardPanel kind="gco" onExplore={() => setEntered('gco', true)} />;
  const gco = activeGco();
  // The person connected but hasn't created the org yet (step 2) — run the org-create ceremony.
  if (!gco.org) return <GcoOrgCreate gco={gco} onSignOut={() => setEntered('gco', false)} />;
  const myNeeds = needsForOrg(gco.org);
  return (
    <>
      <IntranetHeader
        label={`${gco.orgName} · signatory ${gco.signatory}`}
        role="GCO Organization"
        onSignOut={() => setEntered('gco', false)}
      />
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
      <SwitchboardBridgePanel />
      <MatchBoard needs={allNeeds()} />
      <AgreementsPanel agreements={allAgreements()} role="jane" actorPerson={personaActor} />
      <PublicSignalPanel needs={allNeeds()} offerings={allOfferings()} />
    </>
  );
}

// The KC Expert (supply) — an INDIVIDUAL person agent with skills (the facilitator analog).
// Onboarding landing until registered; then the intranet: publish an Offering + accept requests.
function KcView() {
  if (!isEntered('kc')) return <OnboardPanel kind="kc" onExplore={() => setEntered('kc', true)} />;
  const kc = activeKc();
  const myOfferings = offeringsForPerson(kc.person);
  const myAgreements = allAgreements().filter((a) => a.kcPersonAgentId.toLowerCase().includes(kc.person.toLowerCase()));
  const openNeeds = allNeeds().filter((n) => n.status === 'open');
  return (
    <>
      <IntranetHeader label={kc.name} role="KC Expert" onSignOut={() => setEntered('kc', false)} />
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
