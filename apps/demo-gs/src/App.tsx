// demo-gs shell (spec 250 + spec 252 Wave 2). 4 roles mirroring demo-jp: a GCO Organization (demand;
// a person creates an org that holds the GCO role + posts Needs), a KC Expert (supply; an individual
// person with skills), Jane/Global Switchboard (broker), Pete/Global Church (issuer).
//
// Wave 2 = STRICT least-privilege. Members come ONLY from a real Connect sign-in; there are no sample
// identities. Member-owned data (KC offerings, GCO needs) lives in each member's OWN vault; the store
// hydrates the ACTIVE identity's ENTITLED view (own data + a coarsened public feed). Jane (the broker)
// sees the full member view via the grants members issued her; Pete (issuer) sees agreements only.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { PERSONA_META, actingAgents, loadPersona, savePersona, type Persona } from './lib/personas';
import { ensureSwitchboardDeployed } from './lib/onchain';
import {
  allAgreements, allNeeds, allOfferings, hydrate, isHydrated, loadError, publicNeedEntries,
  publicOfferingEntries, setActiveContext, subscribe, version,
} from './lib/store';
import {
  clearSession, loadSession, setSession, sessionsVersion, subscribeSessions, type MemberSession,
} from './lib/session';
import { registerMember } from './lib/member-vault';
import { exchangeCode, personAddressFromIdToken, startOrgCreation } from './connect-client';
import { RoleSwitcher } from './components/RoleSwitcher';
import { OnboardPanel, CONNECT_KEY, type ConnectStash } from './components/OnboardPanel';
import { GcoNeedWizard } from './components/GcoNeedWizard';
import { ExpertOfferingWizard } from './components/ExpertOfferingWizard';
import { MatchBoard } from './components/MatchBoard';
import { AgreementsPanel } from './components/AgreementsPanel';
import { PublicSignalPanel } from './components/PublicSignalPanel';
import { SubstrateClaimsPanel } from './components/SubstrateClaimsPanel';
import { SwitchboardBridgePanel } from './components/SwitchboardBridgePanel';
import { DirectoryPanel } from './components/DirectoryPanel';
import { Banner, Card, Pill, SectionHead } from './components/ui';
import { personalHome } from './lib/domain';

/** sessionStorage key + stash for the in-flight org-create redirect (GCO step 2). */
const ORG_KEY = 'agenticprimitives:demo-gs:org-create';
interface OrgStash { state: string; signatory: string; orgName: string; authOrigin: string; codeVerifier: string; nonce: string }

export function App() {
  const [persona, setPersona] = useState<Persona>(loadPersona() ?? 'gco');
  const [connectError, setConnectError] = useState<string | null>(null);
  // A GCO signatory who finished step 1 (site-login) but hasn't created the org yet. Not a session
  // (no org SA / grant yet) — a transient between the two ceremonies, kept in component state.
  const [pendingGco, setPendingGco] = useState<{ signatory: string } | null>(null);

  // Re-render on store / session change.
  useSyncExternalStore(subscribe, version, version);
  useSyncExternalStore(subscribeSessions, sessionsVersion, sessionsVersion);

  // Activate a persona's entitled context (re-hydrates the store from the right vault(s)). Members
  // carry their session; operators (jane/pete) have none.
  const activate = (p: Persona) =>
    setActiveContext({ persona: p, session: p === 'kc' || p === 'gco' ? loadSession(p) : null });
  const select = (p: Persona) => {
    setPersona(p);
    savePersona(p);
    void activate(p).catch(() => { /* surfaced via loadError() */ });
  };

  // Initial hydrate for the starting persona.
  useEffect(() => {
    void activate(persona).catch(() => { /* surfaced via loadError() */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Connect return handler (Wave 2): a person came back from their secure home with ?code&state.
  // TWO ceremonies land here: (1) site-login that enrolls the PERSON (KC = the member; GCO signatory =
  // step 1 of the org flow); (2) the org-create that deploys the GCO org SA + mints its broker grant.
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
          // The org-create MUST have minted the org→Switchboard broker grant (we asked for it). No
          // silent fallback — without it Jane can never read this GCO's needs (ADR-0013).
          if (!tok.org.brokerDelegation) {
            throw new Error('your home did not return the Switchboard access grant for this organization — please retry the org creation');
          }
          const session: MemberSession = {
            kind: 'gco', sa: tok.org.orgAgent, name: orgStash.signatory!, orgName: tok.org.orgName,
            signatory: orgStash.signatory!, grant: tok.org.brokerDelegation,
          };
          setSession(session);
          setPendingGco(null); // org created — leave the step-2 transient
          await registerMember({ kind: 'gco', sa: tok.org.orgAgent, name: tok.org.orgName, orgName: tok.org.orgName, signatory: orgStash.signatory!, delegation: tok.org.brokerDelegation });
          setPersona('gco'); savePersona('gco');
          await setActiveContext({ persona: 'gco', session });
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
          // Step 1 done — the person is enrolled (we don't need the person SA; the org SA + its broker
          // grant come from step 2). Stash the signatory name so GcoOrgCreate can launch the ceremony.
          void person;
          setPendingGco({ signatory: stash.name! });
          setPersona('gco'); savePersona('gco');
        } else {
          // KC: the site-login `tok.delegation` IS the grant (person → DEMO_GS_DELEGATE). No grant =
          // no vault access; surface it (ADR-0013, no silent fallback).
          if (!tok.delegation) throw new Error('your home did not return a Switchboard access grant — please retry sign-in');
          const session: MemberSession = { kind: 'kc', sa: person, name: stash.name!, grant: tok.delegation };
          setSession(session);
          await registerMember({ kind: 'kc', sa: person, name: stash.name!, delegation: tok.delegation });
          setPersona('kc'); savePersona('kc');
          await setActiveContext({ persona: 'kc', session });
        }
      } catch (e) {
        setConnectError(e instanceof Error ? e.message : String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        {loadError() && <div style={{ marginBottom: '1rem' }}><Banner tone="err">Couldn&rsquo;t reach the vault: {loadError()}. This view may be out of date until it reconnects.</Banner></div>}
        {!isHydrated() && !loadError() && (
          <div style={{ marginBottom: '1rem', fontSize: '.78rem', color: 'var(--c-g500)' }}>
            ⟳ loading your entitled view from the vault…
          </div>
        )}

        <div style={{ display: 'grid', gap: '1.25rem', paddingBottom: '2rem' }}>
          {persona === 'gco' && <GcoView pendingGco={pendingGco} onClearPending={() => setPendingGco(null)} />}
          {persona === 'kc' && <KcView />}
          {persona === 'jane' && <JaneView />}
          {persona === 'pete' && <PeteView />}
        </div>
      </div>

      <footer>
        <div className="wrap">
          <span>demo-gs · Global Switchboard pattern demo · spec 250 / 252</span>
          <span>Sibling of demo-jp · member-owned vaults (Wave 2)</span>
        </div>
      </footer>
    </>
  );
}

// Thin "you're inside the member intranet" bar with a sign-out (clears the session credential).
function IntranetHeader({ label, role, onSignOut }: { label: string; role: string; onSignOut: () => void }) {
  return (
    <Card style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap', background: 'var(--c-g50)', padding: '.7rem 1rem' }}>
      <span style={{ fontSize: '.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--c-g500)' }}>{role} intranet</span>
      <span style={{ fontSize: '.9rem', fontWeight: 700, color: 'var(--c-g800)' }}>{label}</span>
      <button onClick={onSignOut} style={{ marginLeft: 'auto', fontSize: '.76rem', color: 'var(--c-g500)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
        sign out
      </button>
    </Card>
  );
}

// GCO step 2: the person is connected (pendingGco set); now create the ORG that takes the GCO role.
// The org SA is deployed + custodied by the person's ROOT credential at their home, AND the home mints
// an org→Switchboard broker grant (we pass grantOrg) so Jane can read this org's needs. On return the
// App's org-create handler builds the gco session + registers the member.
function GcoOrgCreate({ signatory, onSignOut }: { signatory: string; onSignOut: () => void }) {
  const [orgName, setOrgName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function createOrg() {
    if (!orgName.trim()) { setErr('Name the organization that takes the GCO role.'); return; }
    setBusy(true); setErr(null);
    try {
      // grantOrg = Jane's REAL deployed Switchboard org SA (NOT the local predicted address) → the home
      // mints tok.org.brokerDelegation (this org SA → Switchboard) that Jane reads the org's needs through.
      const switchboardSa = (await ensureSwitchboardDeployed()).sa;
      const r = await startOrgCreation(signatory, orgName.trim(), 'gs-gco-org', switchboardSa);
      const stash: OrgStash = { state: r.state, signatory, orgName: orgName.trim(), authOrigin: r.authOrigin, codeVerifier: r.codeVerifier, nonce: r.nonce };
      sessionStorage.setItem(ORG_KEY, JSON.stringify(stash));
      window.location.href = r.url; // → the signatory's home; deploys the org SA; returns with ?code&state
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <>
      <IntranetHeader label={`${signatory} · connected`} role="GCO Organization" onSignOut={onSignOut} />
      <Card style={{ maxWidth: 640 }}>
        <div className="eyebrow">GCO Organization · step 2 of 2</div>
        <h2 style={{ fontSize: '1.35rem', marginTop: '.35rem' }}>Create the organization that holds the GCO role</h2>
        <p style={{ color: 'var(--c-g600)', marginTop: '.6rem', fontSize: '.9rem' }}>
          You&rsquo;re connected as <strong>{signatory}</strong>. Now name the organization (e.g. <em>Hope Church
          Missions Team</em>) — it becomes a Smart Agent that takes the Great Commission Organization role and posts
          the skill Needs. It&rsquo;s deployed + custodied by <strong>your</strong> credential at your home; Global
          Switchboard is never a custodian, and it reads your needs only through the scoped grant you mint now.
        </p>
        <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '.6rem', maxWidth: 460 }}>
          <input
            type="text" value={orgName} placeholder="GCO organization name (e.g. Hope Church Missions Team)" disabled={busy}
            onChange={(e) => setOrgName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void createOrg(); }}
            style={{ padding: '.7rem .9rem', fontSize: '.95rem', borderRadius: 10, border: '1.5px solid var(--c-g300)', background: '#fff' }}
          />
          <button className="btn-sso" onClick={() => void createOrg()} disabled={!orgName.trim() || busy}>
            <span className="btn-sso-glyph" aria-hidden="true">🏛️</span>
            {busy ? 'Opening your home…' : 'Create the GCO organization'}
          </button>
          {err && <Banner tone="err">{err}</Banner>}
          <span className="soon" style={{ background: 'var(--c-primary-subtle)', borderColor: 'var(--c-primary-border)', color: 'var(--c-primary-active)' }}>
            You&rsquo;ll confirm with your device at <b>{personalHome(signatory)}</b> to deploy the org + mint the grant, then come back here.
          </span>
        </div>
      </Card>
    </>
  );
}

// The GCO Organization (demand). No session → onboarding landing. Connected but org not yet created
// (pendingGco) → the org-create ceremony. Connected with a session → the org intranet: post Needs to
// your OWN org vault, browse the COARSENED public supply, see YOUR agreements.
function GcoView({ pendingGco, onClearPending }: { pendingGco: { signatory: string } | null; onClearPending: () => void }) {
  const session = loadSession('gco');
  if (!session) {
    if (pendingGco) return <GcoOrgCreate signatory={pendingGco.signatory} onSignOut={onClearPending} />;
    return <OnboardPanel kind="gco" />;
  }
  const org = session.sa;
  const myNeeds = allNeeds();
  return (
    <>
      <IntranetHeader
        label={`${session.orgName ?? session.name} · signatory ${session.signatory ?? session.name}`}
        role="GCO Organization"
        onSignOut={() => { clearSession('gco'); void setActiveContext({ persona: 'gco', session: null }); }}
      />
      <GcoNeedWizard ownerOrg={org} signatory={org} session={session} />
      <Card>
        <SectionHead eyebrow="GCO Org · my needs" title="Posted needs" sub={`Needs ${session.orgName ?? 'your organization'} has declared (in your own org vault). The Switchboard scores them against KC offerings — switch to Jane to broker connections.`} />
        {myNeeds.length === 0 && <p style={{ fontSize: '.86rem', color: 'var(--c-g500)' }}>None yet — post one above.</p>}
        {myNeeds.map((n) => (
          <div key={n.id} style={{ display: 'flex', gap: '.5rem', alignItems: 'center', padding: '.4rem 0', borderBottom: '1px solid var(--c-g100)', fontSize: '.86rem', flexWrap: 'wrap' }}>
            <Pill tone={n.status === 'fulfilled' ? 'live' : n.status === 'open' ? 'ok' : 'warn'}>{n.status}</Pill>
            <span style={{ flex: 1 }}>{n.title}</span>
            {n.requiredSkills.map((s) => <span key={s.gcUri} style={{ fontSize: '.74rem', color: 'var(--c-g400)' }}>{s.label}</span>)}
          </div>
        ))}
      </Card>
      <DirectoryPanel entries={publicOfferingEntries()} scope="offering" eyebrow="Directory · supply" title="Browse Kingdom Consultants" sub="The public projection of expertise offerings — by skill, region, or cause. Contact is withheld; a specific match + the consultant's contact are released only when a connection is accepted by the Switchboard." />
      <AgreementsPanel agreements={allAgreements()} role="gco" actorPerson={org} onChanged={() => void setActiveContext({ persona: 'gco', session })} />
    </>
  );
}

// Jane / Global Switchboard — the BROKER. Entitled (via member grants) to the FULL member view +
// bridged demand: the scored match board, the directory, the public signal, the agreements backbone.
function JaneView() {
  const { person } = actingAgents('jane');
  const rehydrate = () => void setActiveContext({ persona: 'jane' });
  return (
    <>
      <Card style={{ background: 'var(--c-g50)' }}>
        <SectionHead eyebrow="Broker · intent spine" title="Global Switchboard broker" sub="You see every connected member's needs + offerings — entitled through the scoped grant each member issued at sign-in — plus the bridged public demand. Run the explainable match board; the agreement is the audit backbone for every brokered connection." />
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          <Pill tone="ok">{allNeeds().filter((n) => n.status !== 'fulfilled').length} active needs</Pill>
          <Pill tone="ok">{allOfferings().filter((o) => o.status === 'active').length} active offerings</Pill>
          <Pill tone="live">{allAgreements().length} agreements</Pill>
        </div>
      </Card>
      <SwitchboardBridgePanel />
      <DirectoryPanel needs={allNeeds()} offerings={allOfferings()} scope="all" title="Switchboard directory" sub="The full public projection — demand (needs) and supply (offerings) together. Confidential anchors are coarsened, sensitive regions collapsed, contact withheld until a connection is accepted." />
      <MatchBoard needs={allNeeds()} requestAsPerson={person} onChanged={rehydrate} />
      <AgreementsPanel agreements={allAgreements()} role="jane" actorPerson={person} onChanged={rehydrate} />
      <PublicSignalPanel needs={allNeeds()} offerings={allOfferings()} />
    </>
  );
}

// The KC Expert (supply) — an INDIVIDUAL connected person agent. No session → onboarding. Connected →
// the intranet: publish ONE Offering to your OWN vault, browse the COARSENED public demand, accept
// requests on YOUR agreements.
function KcView() {
  const session = loadSession('kc');
  if (!session) return <OnboardPanel kind="kc" />;
  const kc = session.sa;
  const myOfferings = allOfferings();
  return (
    <>
      <IntranetHeader label={session.name} role="KC Expert" onSignOut={() => { clearSession('kc'); void setActiveContext({ persona: 'kc', session: null }); }} />
      <ExpertOfferingWizard owner={kc} ownerName={session.name} session={session} />
      <Card>
        <SectionHead eyebrow="KC Expert · my offering" title="Your published offering" sub="Lives in YOUR vault; the Switchboard reads it only through the grant you issued at sign-in." />
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
      <AgreementsPanel agreements={allAgreements()} role="kc" actorPerson={kc} onChanged={() => void setActiveContext({ persona: 'kc', session })} />
      <DirectoryPanel entries={publicNeedEntries()} scope="need" eyebrow="Directory · demand" title="Where the demand is" sub="The public projection of open needs you could serve — by skill, region, or cause. Confidential GCO need details are coarsened; you never see raw confidential demand." />
    </>
  );
}

// Global Church — the ISSUER operator (the same Global Church org as demo-jp; NOT a GCO). Sees the
// agreements ONLY (issuance + lifecycle) — no member needs/offerings, no public signal.
function PeteView() {
  const { person } = actingAgents('pete');
  return (
    <>
      <Card style={{ background: 'var(--c-g50)' }}>
        <SectionHead eyebrow="Issuer · Global Church" title="Issuance desk" sub="Global Church is the ISSUER org (the same as demo-jp — NOT a GCO). Once a GCO organization and a KC expert confirm a connection, Global Church issues the agreement here and runs it through its lifecycle (issue → ongoing → fulfilled). The issuer sees the agreement backbone only — never member needs or offerings." />
        <Pill tone="live">{allAgreements().length} agreement(s) on record</Pill>
      </Card>
      <AgreementsPanel agreements={allAgreements()} role="pete" actorPerson={person} onChanged={() => void setActiveContext({ persona: 'pete' })} />
    </>
  );
}
