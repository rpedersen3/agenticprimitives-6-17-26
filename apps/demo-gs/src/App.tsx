// demo-gs shell (spec 250 + spec 252 Wave 2; production UX Wave A/B). 4 roles mirroring demo-jp: a GCO
// Organization (demand; a person creates an org that holds the GCO role + posts Needs), a KC Expert
// (supply; an individual person with skills), Jane/Global Switchboard (broker), Pete/Global Church
// (issuer).
//
// Connect-then-choose-role (reworked per direct UX feedback): connecting is ONE simple, role-agnostic
// action — the member never picks GCO/KC before connecting. Routing: signed-out → Landing → ConnectScreen
// (role-agnostic person site-login) → (Global.Church) → RoleDiscovery (while hydrating) → RoleHub (the
// connected intranet home). The ROLE is chosen IN the hub: "Offer your expertise (KC)" opens the KC
// workspace immediately; "Set up an organization (GCO)" launches the org-create ceremony directly, with
// the connected person as signatory. Jane/Pete are DEMO ADMIN dropdown shortcuts (behind an Admin
// expander) that never disturb a member session. The entitlement layer (store/session/member-vault) and
// the org-create RETURN handler + workspace BODIES are unchanged — this restructures the SHELL.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { actingAgents, type Persona } from './lib/personas';
import { ensureSwitchboardDeployed } from './lib/onchain';
import {
  allAgreements, allNeeds, allOfferings, isHydrated, loadError, publicNeedEntries,
  publicOfferingEntries, setActiveContext, subscribe, version,
} from './lib/store';
import {
  clearSession, loadSession, setSession, sessionsVersion, subscribeSessions, type MemberSession,
} from './lib/session';
import { registerMember } from './lib/member-vault';
import { exchangeCode, personAddressFromIdToken, startOrgCreation } from './connect-client';
import { CONNECT_KEY, type ConnectStash } from './lib/connect-launch';
import { deriveRoleCapabilities, type RoleKind } from './lib/role-capabilities';
import { loadActiveRole, saveActiveRole } from './lib/active-role';
import { personalHome } from './lib/domain';
import { AppShellHeader, type ConnectedIdentity } from './components/AppShellHeader';
import { Landing } from './components/Landing';
import { ConnectScreen } from './components/ConnectScreen';
import { RoleDiscovery } from './components/RoleDiscovery';
import { RoleHub } from './components/RoleHub';
import { OnboardPanel } from './components/OnboardPanel';
import { GcoNeedWizard } from './components/GcoNeedWizard';
import { ExpertOfferingWizard } from './components/ExpertOfferingWizard';
import { MatchBoard } from './components/MatchBoard';
import { AgreementsPanel } from './components/AgreementsPanel';
import { PublicSignalPanel } from './components/PublicSignalPanel';
import { SubstrateClaimsPanel } from './components/SubstrateClaimsPanel';
import { SwitchboardBridgePanel } from './components/SwitchboardBridgePanel';
import { DirectoryPanel } from './components/DirectoryPanel';
import { LifecycleRail } from './components/LifecycleRail';
import { NextBestAction, type NextAction } from './components/NextBestAction';
import { GcoPostedNeeds } from './components/GcoPostedNeeds';
import { KcRequestQueue } from './components/KcRequestQueue';
import { AccessRequestState } from './components/AccessRequestState';
import { gcoLifecycle } from './lib/gco-lifecycle';
import { kcLifecycle } from './lib/kc-lifecycle';
import type { GcoNeedIntent } from './domain/gs-types';
import { Banner, Card, Pill, SectionHead } from './components/ui';

/** sessionStorage key + stash for the in-flight org-create redirect (GCO step 2). */
const ORG_KEY = 'agenticprimitives:demo-gs:org-create';
interface OrgStash { state: string; signatory: string; orgName: string; authOrigin: string; codeVerifier: string; nonce: string }

// The shell route. `landing` = signed out; `connect` = the role-agnostic connect screen; `discovery` =
// post-connect hydration timeline; `hub` = the connected intranet home (role chooser); `workspace` = an
// active workspace OR a demo-admin surface (persona carries which). `demoPersona` is set ONLY for
// jane/pete shortcuts.
type View = 'landing' | 'connect' | 'discovery' | 'hub' | 'workspace';

export function App() {
  const [view, setView] = useState<View>('landing');
  // The active member workspace role (gco/kc) when view==='workspace' and not a demo surface.
  const [activeRole, setActiveRoleState] = useState<RoleKind | null>(null);
  // A demo-admin surface (jane/pete) — orthogonal to the member session; never mutates it.
  const [demoPersona, setDemoPersona] = useState<'jane' | 'pete' | null>(null);
  // The kind we're discovering after a connect-return (drives the RoleDiscovery access table).
  const [discoverKind, setDiscoverKind] = useState<RoleKind>('kc');
  // Where discovery routes once hydrated: 'hub' after a plain person connect (the user picks a role in
  // the hub); 'workspace' after the GCO org-create return (the gco workspace is the destination).
  const [discoverDest, setDiscoverDest] = useState<'hub' | 'workspace'>('hub');
  const [connectError, setConnectError] = useState<string | null>(null);
  // An org-create launched from the hub: the connected person (signatory) started the GCO org-create
  // ceremony but the org isn't created yet. Not a session (no org SA / grant yet) — a transient between
  // the connect and the org-create return, kept in component state.
  const [pendingGco, setPendingGco] = useState<{ signatory: string } | null>(null);

  // Re-render on store / session change.
  useSyncExternalStore(subscribe, version, version);
  useSyncExternalStore(subscribeSessions, sessionsVersion, sessionsVersion);

  const kcSession = loadSession('kc');
  const gcoSession = loadSession('gco');
  const caps = useMemo(
    () => deriveRoleCapabilities({ kcSession, gcoSession, pendingGco: !!pendingGco }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kcSession?.sa, gcoSession?.sa, pendingGco?.signatory],
  );
  // The canonical person key for the active-role preference: the KC person SA when present, else the
  // GCO signatory name (a GCO session's `sa` is the ORG SA, not the person).
  const personKey = kcSession?.sa ?? gcoSession?.signatory ?? gcoSession?.name ?? '';
  const connected = !!kcSession || !!gcoSession;
  // The connected person's name (the signatory for a hub-launched GCO org-create). Prefer the KC person
  // session's name; fall back to a GCO session's signatory for a returning GCO-only member.
  const connectedPersonName = kcSession?.name ?? gcoSession?.signatory ?? gcoSession?.name ?? '';

  // Activate a persona's entitled context (re-hydrates the store from the right vault(s)).
  const activate = (p: Persona) =>
    setActiveContext({ persona: p, session: p === 'kc' || p === 'gco' ? loadSession(p) : null });

  // Open a member workspace for a ready role: persist the preference, hydrate, route.
  const openWorkspace = (role: RoleKind) => {
    setDemoPersona(null);
    setActiveRoleState(role);
    if (personKey) saveActiveRole(personKey, role);
    setView('workspace');
    void activate(role).catch(() => { /* surfaced via loadError() */ });
  };

  // Open a demo-admin surface WITHOUT touching the member session (spec §15c).
  const openDemo = (p: 'jane' | 'pete') => {
    setDemoPersona(p);
    setView('workspace');
    void activate(p).catch(() => { /* surfaced via loadError() */ });
  };

  // Open the role-agnostic connect screen (header Connect + the landing CTA both land here).
  const goConnect = () => { setView('connect'); };

  const goHub = () => { setDemoPersona(null); setActiveRoleState(null); setView('hub'); };

  // Launch the GCO org-create ceremony from the hub, with the connected person as signatory. There is
  // no separate "GCO connect" — the person is already connected; this only marks the org-create as
  // in-flight (pendingGco) + routes to the GCO workspace, which renders GcoOrgCreate (step 2). The
  // org-create RETURN handler (unchanged) finishes it: builds the gco session + registerMember.
  const setupGcoOrg = (signatory: string) => {
    setDemoPersona(null);
    setPendingGco({ signatory });
    setActiveRoleState('gco');
    setView('workspace');
    void setActiveContext({ persona: 'gco', session: null }).catch(() => { /* loadError() */ });
  };

  const disconnect = () => {
    clearSession('kc');
    clearSession('gco');
    setPendingGco(null);
    setActiveRoleState(null);
    setDemoPersona(null);
    setView('landing');
    void setActiveContext({ persona: 'jane', session: null }).catch(() => { /* ignore */ });
  };

  // After a connect-return, the App sets pendingGco / a session + a discovery kind; once the store is
  // hydrated we route on. This effect performs that transition. It runs on every hydrate change.
  useEffect(() => {
    if (view !== 'discovery') return;
    if (loadError()) return; // stay on discovery; RoleDiscovery shows the error + retry
    if (!isHydrated()) return;
    // Plain person connect → land in the role hub (the connected intranet home) so the user chooses a
    // role there. The GCO org-create return already built the gco session → go straight to its workspace.
    if (discoverDest === 'workspace') openWorkspace(discoverKind);
    else goHub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, discoverKind, discoverDest, version()]);

  // Restore the connected view on load (a returning member with a saved session, no ?code in the URL).
  useEffect(() => {
    const u = new URL(window.location.href);
    if (u.searchParams.get('code')) return; // the connect-return effect owns this case
    const kc = loadSession('kc');
    const gco = loadSession('gco');
    if (!kc && !gco) { setView('landing'); return; }
    const pk = kc?.sa ?? gco?.signatory ?? gco?.name ?? '';
    const pref = (pk && loadActiveRole(pk)) ?? (gco ? 'gco' : 'kc');
    const ready: RoleKind = (pref === 'gco' && gco) || (pref === 'kc' && kc) ? pref : (gco ? 'gco' : 'kc');
    setActiveRoleState(ready);
    setView('workspace');
    void setActiveContext({ persona: ready, session: loadSession(ready) }).catch(() => { /* loadError() */ });
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
          saveActiveRole(orgStash.signatory!, 'gco');
          // Route through visible discovery while the entitled view hydrates → the GCO workspace.
          setActiveRoleState('gco');
          setDiscoverKind('gco');
          setDiscoverDest('workspace');
          setView('discovery');
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
        // Role-agnostic person connect: the site-login `tok.delegation` IS the person → Switchboard
        // grant. No grant = no vault access; surface it (ADR-0013, no silent fallback). The person is
        // enrolled as a KC ('kc') member session; they choose their role (KC workspace / create a GCO
        // org) from the hub afterwards.
        if (!tok.delegation) throw new Error('your home did not return a Switchboard access grant — please retry sign-in');
        const session: MemberSession = { kind: 'kc', sa: person, name: stash.name!, grant: tok.delegation };
        setSession(session);
        saveActiveRole(person, 'kc');
        await registerMember({ kind: 'kc', sa: person, name: stash.name!, delegation: tok.delegation });
        // Route through visible discovery while the entitled view hydrates → the role hub (the user
        // picks a workspace there, not auto into one).
        setActiveRoleState('kc');
        setDiscoverKind('kc');
        setDiscoverDest('hub');
        setView('discovery');
        await setActiveContext({ persona: 'kc', session });
      } catch (e) {
        setConnectError(e instanceof Error ? e.message : String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The identity pill shows the connected person + active role (member surfaces only; demo surfaces
  // keep the underlying member identity in the header but flag the demo banner in the body).
  // In a workspace the pill shows the active role; in the hub (no active workspace) it shows the name
  // + "choose a workspace" (activeRole === null).
  const identity: ConnectedIdentity | null = connected
    ? {
        name: kcSession?.name ?? gcoSession?.signatory ?? gcoSession?.name ?? 'you',
        activeRole: view === 'workspace' && !demoPersona ? activeRole : null,
      }
    : null;

  const onOpenHome = () => {
    const n = kcSession?.name ?? gcoSession?.signatory ?? gcoSession?.name;
    if (n) window.open(`https://${personalHome(n)}`, '_blank', 'noopener');
  };

  return (
    <>
      <AppShellHeader
        identity={identity}
        caps={connected ? caps : null}
        onConnect={goConnect}
        onDemoJane={() => openDemo('jane')}
        onDemoPete={() => openDemo('pete')}
        onHelp={goConnect}
        onOpenHome={onOpenHome}
        onDisconnect={disconnect}
        onSwitchRole={(k) => openWorkspace(k)}
        onSetupRole={(k) => { if (k === 'gco') setupGcoOrg(connectedPersonName); else openWorkspace('kc'); }}
      />

      <div className="wrap" style={{ padding: '1.5rem 1.25rem 0' }}>
        {connectError && <div style={{ marginBottom: '1rem' }}><Banner tone="err">{connectError}</Banner></div>}
        {view === 'workspace' && loadError() && !((activeRole === 'gco' || activeRole === 'kc') && !demoPersona) && (
          // The GCO + KC workspaces render their OWN first-class request-access state for a missing grant
          // (below); every other surface shows the generic vault-error banner.
          <div style={{ marginBottom: '1rem' }}><Banner tone="err">Couldn&rsquo;t reach the vault: {loadError()}. This view may be out of date until it reconnects.</Banner></div>
        )}

        <div style={{ display: 'grid', gap: '1.25rem', paddingBottom: '2rem' }}>
          {view === 'landing' && <Landing onConnect={goConnect} />}

          {view === 'connect' && <ConnectScreen onBack={() => setView('landing')} />}

          {view === 'discovery' && <RoleDiscovery kind={discoverKind} onRetry={() => void activate(discoverKind)} />}

          {view === 'hub' && (
            <RoleHub
              name={identity?.name ?? 'there'}
              caps={caps}
              onOpen={(k) => openWorkspace(k)}
              onResumeOrg={() => { setDemoPersona(null); setActiveRoleState('gco'); setView('workspace'); }}
              onSetupGco={() => setupGcoOrg(connectedPersonName)}
              onOpenHome={onOpenHome}
            />
          )}

          {view === 'workspace' && demoPersona && <DemoBanner />}
          {view === 'workspace' && demoPersona === 'jane' && <JaneView />}
          {view === 'workspace' && demoPersona === 'pete' && <PeteView />}
          {view === 'workspace' && !demoPersona && activeRole === 'gco' && (
            <GcoView
              pendingGco={pendingGco}
              onClearPending={() => setPendingGco(null)}
              onHub={goHub}
              caps={caps}
              onRecreateOrg={(signatory) => {
                // Re-mint the org→Switchboard grant: drop the broken gco session + resume org-create.
                clearSession('gco');
                setPendingGco({ signatory });
                setActiveRoleState('gco');
                void setActiveContext({ persona: 'gco', session: null }).catch(() => { /* loadError() */ });
              }}
              onOpenBoard={() => openDemo('jane')}
            />
          )}
          {view === 'workspace' && !demoPersona && activeRole === 'kc' && <KcView onHub={goHub} caps={caps} />}
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

// Demo-admin banner — Jane/Pete are demo shortcuts, never production authorization (spec §15c).
function DemoBanner() {
  return (
    <Banner tone="warn">
      Demo admin surface — Jane/Pete run on deterministic demo keys (spec 248 hardening pending). Not production
      authorization, and your connected member session (if any) is untouched.
    </Banner>
  );
}

// Thin "you're inside the member intranet" bar. Hub returns to the role chooser; sign-out clears the
// session credential for this role.
function IntranetHeader({ label, role, onSignOut, onHub }: { label: string; role: string; onSignOut: () => void; onHub?: () => void }) {
  return (
    <Card style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap', background: 'var(--c-g50)', padding: '.7rem 1rem' }}>
      <span style={{ fontSize: '.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--c-g500)' }}>{role} intranet</span>
      <span style={{ fontSize: '.9rem', fontWeight: 700, color: 'var(--c-g800)' }}>{label}</span>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: '.9rem' }}>
        {onHub && <button onClick={onHub} style={{ fontSize: '.76rem', color: 'var(--c-primary)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>role hub</button>}
        <button onClick={onSignOut} style={{ fontSize: '.76rem', color: 'var(--c-g500)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
          sign out
        </button>
      </span>
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

// The GCO Organization (demand) workspace (production UX Wave C, design spec §10). No session →
// onboarding landing. Connected but org not yet created (pendingGco) → the org-create ceremony.
// A missing org→Switchboard grant (a hydrate failure on the org's own needs) → a first-class
// request-access state, NOT a raw error banner (§15c, no silent fallback). Connected + a readable
// grant → the org intranet, restructured into the §10 hierarchy: lifecycle rail → primary task card
// (post a need) + a next-best-action right rail → posted needs (edit/withdraw) → coarsened supply
// directory → agreements → a data/trust footer.
function GcoView({ pendingGco, onClearPending, onHub, caps, onRecreateOrg, onOpenBoard }: {
  pendingGco: { signatory: string } | null; onClearPending: () => void; onHub: () => void;
  caps: ReturnType<typeof deriveRoleCapabilities>;
  /** Re-mint the org→Switchboard grant (drop the session + resume org-create). */
  onRecreateOrg: (signatory: string) => void;
  /** Open the Switchboard broker board (to review matches + request a connection). */
  onOpenBoard: () => void;
}) {
  // A "re-post"/edit prefill, set when the user clicks edit on a posted need.
  const [editNeed, setEditNeed] = useState<GcoNeedIntent | null>(null);

  const session = loadSession('gco');
  if (!session) {
    if (pendingGco) return <GcoOrgCreate signatory={pendingGco.signatory} onSignOut={onClearPending} />;
    return <OnboardPanel kind="gco" />;
  }
  const org = session.sa;
  const orgName = session.orgName ?? session.name;
  const signatory = session.signatory ?? session.name;

  // Grant-missing: the org's own needs are unreadable (the org→Switchboard grant never minted or
  // failed). ONE mechanism (ADR-0013) → no fallback read; surface the request-access state instead.
  if (loadError()) {
    return (
      <>
        <IntranetHeader label={`${orgName} · signatory ${signatory}`} role="GCO Organization"
          onHub={caps.canSwitch ? onHub : undefined}
          onSignOut={() => { clearSession('gco'); void setActiveContext({ persona: 'gco', session: null }); }} />
        <AccessRequestState
          title="Switchboard can’t read this org’s needs yet"
          body="The organization didn’t return a Switchboard access grant when it was created (no silent fallback — ADR-0013). Re-create the organization to mint the scoped grant, or continue with a limited view."
          disclosure={{ owner: 'Your GCO org', scope: 'Read the needs your org posts (gs:needs)', grantee: 'Global Switchboard' }}
          primary={{ label: 'Re-create the organization to mint the grant', onClick: () => onRecreateOrg(signatory) }}
          limited={{ label: 'Continue with a limited view (no demand directory)', onClick: onHub }}
        />
      </>
    );
  }

  const myNeeds = allNeeds();
  const lc = gcoLifecycle({ hasOrg: true, needs: myNeeds, agreements: allAgreements() });
  const next = gcoNextAction(lc.position, onOpenBoard);

  return (
    <>
      <IntranetHeader
        label={`${orgName} · signatory ${signatory}`}
        role="GCO Organization"
        onHub={caps.canSwitch ? onHub : undefined}
        onSignOut={() => { clearSession('gco'); void setActiveContext({ persona: 'gco', session: null }); }}
      />
      <LifecycleRail eyebrow="GCO lifecycle" steps={lc.steps} />

      {/* Primary task (post a need) + the next-best-action right rail (stacks on mobile). */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)', gap: '1.25rem', alignItems: 'start' }}>
        <GcoNeedWizard
          ownerOrg={org} signatory={org} session={session}
          eyebrow="Primary task · post a skill need"
          title="Post a skill need"
          prefill={editNeed}
          onCreated={() => setEditNeed(null)}
        />
        <NextBestAction action={next} />
      </div>

      <GcoPostedNeeds needs={myNeeds} session={session} orgName={orgName} onEdit={(n) => setEditNeed(n)} />

      <DirectoryPanel entries={publicOfferingEntries()} scope="offering" eyebrow="Directory · coarsened supply" title="Browse Kingdom Consultants" sub="The public projection of expertise offerings — by skill, region, or cause. Contact is withheld; a specific match + the consultant's contact are released only when a connection is accepted by the Switchboard." />
      <AgreementsPanel agreements={allAgreements()} role="gco" actorPerson={org} onChanged={() => void setActiveContext({ persona: 'gco', session })} />

      <GcoTrustFooter orgName={orgName} onOpenHome={() => { const h = personalHome(signatory); window.open(`https://${h}`, '_blank', 'noopener'); }} />
    </>
  );
}

// The single most useful next step for the GCO, by lifecycle position (design spec §10 right rail).
function gcoNextAction(position: ReturnType<typeof gcoLifecycle>['position'], onOpenBoard: () => void): NextAction {
  switch (position) {
    case 'no-need':
      return { title: 'Post your first skill need', body: 'Declare what capability your organization needs — required skills, region, cause, languages, and commitment. Use the form on the left.', tone: 'action' };
    case 'need-posted':
      return { title: 'Review matches & request a connection', body: 'Your need is posted. The Switchboard scores it against KC offerings — open the broker board to review explainable matches and request a connection.', cta: { label: 'Open the Switchboard board', onClick: onOpenBoard }, tone: 'action' };
    case 'request-pending':
      return { title: 'Awaiting the KC’s response', body: 'You requested a connection. The Kingdom Consultant reviews it and accepts on their terms — contact is released only on accept. Nothing to do right now.', tone: 'wait' };
    case 'agreement-issued':
      return { title: 'View your agreement', body: 'A connection was accepted and Global Church issues the agreement. Track its lifecycle in the agreements card below.', tone: 'action' };
    default:
      return { title: 'Finish creating your organization', body: 'Create the org that holds the GCO role to start posting needs.', tone: 'action' };
  }
}

// The persistent data/trust footer (design spec §10 + §15b): where your data lives, what Switchboard
// can read, and how to revoke. White-label/faith copy stays in the app (ADR-0021).
function GcoTrustFooter({ orgName, onOpenHome }: { orgName: string; onOpenHome: () => void }) {
  return (
    <Card style={{ background: 'var(--c-g50)' }}>
      <div className="eyebrow">Your data &amp; access</div>
      <p style={{ fontSize: '.85rem', color: 'var(--c-g700)', marginTop: '.4rem', lineHeight: 1.55 }}>
        The needs <strong>{orgName}</strong> posts live in your Global.Church <strong>org vault</strong> — a private store only
        your home credential can open. Global Switchboard reads them <strong>only through the scoped grant</strong> you minted when
        you created the org (its intended program scope; record-level enforcement lands with spec 248). You can
        <strong> revoke that access anytime from your Global.Church home</strong>, and Switchboard&rsquo;s visibility goes to zero.
      </p>
      <button onClick={onOpenHome} style={{ marginTop: '.6rem', background: 'none', border: 'none', color: 'var(--c-primary)', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer', padding: 0 }}>
        Open your Global.Church home →
      </button>
    </Card>
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

// The KC Expert (supply) — an INDIVIDUAL connected person agent (production UX Wave D, design spec §11).
// No session → onboarding. A missing person→Switchboard grant (a hydrate failure on the KC's own
// offering) → a first-class request-access state, NOT a raw error banner (§15c, no silent fallback).
// Connected + a readable grant → the KC intranet, restructured into the §11 hierarchy: lifecycle rail →
// command-center summary cards (offering status · open requests · demand-fit hint) → primary task card
// (publish/update your offering) + a next-best-action right rail → request queue (the AgreementsPanel
// accept/decline surface, framed with the matched-skill "why this match") → coarsened demand directory →
// the on-chain substrate badge → a data/trust footer.
function KcView({ onHub, caps }: { onHub: () => void; caps: ReturnType<typeof deriveRoleCapabilities> }) {
  const session = loadSession('kc');
  if (!session) return <OnboardPanel kind="kc" />;
  const kc = session.sa;

  const signOut = () => { clearSession('kc'); void setActiveContext({ persona: 'kc', session: null }); };

  // Grant-missing: the KC's own offering is unreadable (the person→Switchboard grant never minted or
  // failed). ONE mechanism (ADR-0013) → no fallback read; surface the request-access state instead. For
  // the KC the recovery is to reconnect (only the home can re-mint the grant), not to re-create an org.
  if (loadError()) {
    return (
      <>
        <IntranetHeader label={session.name} role="KC Expert"
          onHub={caps.canSwitch ? onHub : undefined} onSignOut={signOut} />
        <AccessRequestState
          title="Switchboard can’t read your offering yet"
          body="Your Global.Church home didn’t return (or your saved) Switchboard access grant is missing or expired — and there’s no silent fallback (ADR-0013). Reconnect to refresh your Switchboard access, or continue with a limited view."
          disclosure={{ owner: 'You (KC person)', scope: 'Read the expertise offering you publish (gs:offering)', grantee: 'Global Switchboard' }}
          primary={{ label: 'Reconnect to refresh your Switchboard access', onClick: () => { signOut(); onHub(); } }}
          limited={{ label: 'Continue with a limited view (no demand directory)', onClick: onHub }}
        />
      </>
    );
  }

  const myOfferings = allOfferings();
  const hasOffering = myOfferings.length > 0;
  const agreements = allAgreements();
  const openRequests = agreements.filter((a) => a.status === 'requested' || a.status === 'proposed').length;
  const lc = kcLifecycle({ hasOffering, agreements });

  // Demand-fit hint: how many coarsened open needs in the public feed overlap the KC's offered-skill
  // CATEGORIES (kept simple + coarsened — it's the public feed, never the GCO's raw need).
  const myCategoryUris = new Set(myOfferings.flatMap((o) => o.offeredSkills.map((s) => s.categoryUri)));
  const demandFit = hasOffering
    ? publicNeedEntries().filter((n) => n.categoryUris.some((c) => myCategoryUris.has(c))).length
    : 0;

  const next = kcNextAction(lc.position);

  return (
    <>
      <IntranetHeader label={session.name} role="KC Expert" onHub={caps.canSwitch ? onHub : undefined} onSignOut={signOut} />
      <LifecycleRail eyebrow="KC lifecycle" steps={lc.steps} />

      {/* Command-center summary cards (§11): offering status · open requests · demand-fit hint. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        <KcSummaryCard label="Offering" value={hasOffering ? 'Published' : 'Not yet'} hint={hasOffering ? 'Live in your own vault' : 'Publish below to get matched'} tone={hasOffering ? 'ok' : 'neutral'} />
        <KcSummaryCard label="Open requests" value={String(openRequests)} hint={openRequests > 0 ? 'Awaiting your accept/decline' : 'None right now'} tone={openRequests > 0 ? 'warn' : 'neutral'} />
        <KcSummaryCard label="Demand fit" value={hasOffering ? String(demandFit) : '—'} hint={hasOffering ? `open need${demandFit === 1 ? '' : 's'} match your skills` : 'Publish to see your fit'} tone={demandFit > 0 ? 'live' : 'neutral'} />
      </div>

      {/* Primary task (publish/update offering) + the next-best-action right rail (stacks on mobile). */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)', gap: '1.25rem', alignItems: 'start' }}>
        <ExpertOfferingWizard
          owner={kc} ownerName={session.name} session={session}
          eyebrow="Primary task · publish your offering"
          title={hasOffering ? 'Update your offering' : 'Publish your expertise offering'}
        />
        <NextBestAction action={next} />
      </div>

      {hasOffering && (
        <Card>
          <SectionHead eyebrow="KC Expert · my offering" title="Your published offering" sub="Lives in YOUR vault; the Switchboard reads it only through the grant you issued at sign-in." />
          {myOfferings.map((o) => (
            <div key={o.id} style={{ display: 'flex', gap: '.5rem', alignItems: 'center', padding: '.4rem 0', borderBottom: '1px solid var(--c-g100)', fontSize: '.86rem', flexWrap: 'wrap' }}>
              <Pill tone={o.status === 'active' ? 'live' : 'neutral'}>{o.capacity?.availabilityStatus ?? o.status}</Pill>
              <span style={{ flex: 1 }}>{o.headline}</span>
              {o.offeredSkills.slice(0, 4).map((s) => <span key={s.gcUri} style={{ fontSize: '.74rem', color: 'var(--c-g400)' }}>{s.label}</span>)}
            </div>
          ))}
        </Card>
      )}

      {/* Request queue: the matched-skill "why this match" framing, then the accept/decline surface. */}
      <KcRequestQueue agreements={agreements} />
      <AgreementsPanel agreements={agreements} role="kc" actorPerson={kc} onChanged={() => void setActiveContext({ persona: 'kc', session })} />

      <DirectoryPanel entries={publicNeedEntries()} scope="need" eyebrow="Directory · coarsened demand · where the demand is" title="Where the demand is" sub="The public projection of open needs you could serve — by skill, region, or cause. Confidential GCO need details are coarsened; you never see raw confidential demand." />
      <SubstrateClaimsPanel offerings={myOfferings} />

      <KcTrustFooter onOpenHome={() => { const h = personalHome(session.name); window.open(`https://${h}`, '_blank', 'noopener'); }} />
    </>
  );
}

// A command-center summary card for the KC workspace (design spec §11 summary cards).
function KcSummaryCard({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: 'ok' | 'warn' | 'neutral' | 'live' }) {
  return (
    <Card style={{ padding: '.9rem 1.1rem' }}>
      <div className="eyebrow">{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '.5rem', marginTop: '.3rem' }}>
        <span style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--c-g900, #0f172a)' }}>{value}</span>
        <Pill tone={tone}>{hint}</Pill>
      </div>
    </Card>
  );
}

// The single most useful next step for the KC, by lifecycle position (design spec §11 right rail).
function kcNextAction(position: ReturnType<typeof kcLifecycle>['position']): NextAction {
  switch (position) {
    case 'no-offering':
      return { title: 'Publish your expertise offering', body: 'Declare the skills you can serve with — canonical skills, regions, causes, languages, availability, and evidence. Use the form on the left; your contact stays private until you accept a connection.', tone: 'action' };
    case 'offering-published':
      return { title: 'Browse open demand you could serve', body: 'Your offering is live. Nothing needs your action yet — browse the coarsened demand directory below to see the open needs that match your skills while the Switchboard routes requests to you.', tone: 'wait' };
    case 'requests-pending':
      return { title: 'Review & accept a connection request', body: 'A GCO requested a connection. Review the overlapping skills that drove the match in the request queue below, then accept (contact is released) or decline on your terms.', tone: 'action' };
    case 'accepted':
    case 'agreement-issued':
      return { title: 'View your agreement', body: 'You accepted a connection and the agreement is live. Track its lifecycle in the agreements card below.', tone: 'action' };
    default:
      return { title: 'Publish your expertise offering', body: 'Publish an offering to start receiving explainable match requests.', tone: 'action' };
  }
}

// The persistent data/trust footer for the KC (design spec §11 + §15b): where your data lives, what
// Switchboard can read, when contact is released, and how to revoke. White-label copy stays in the app.
function KcTrustFooter({ onOpenHome }: { onOpenHome: () => void }) {
  return (
    <Card style={{ background: 'var(--c-g50)' }}>
      <div className="eyebrow">Your data &amp; access</div>
      <p style={{ fontSize: '.85rem', color: 'var(--c-g700)', marginTop: '.4rem', lineHeight: 1.55 }}>
        Your offering lives in <strong>your own Global.Church vault</strong> — a private store only your home credential can
        open. Global Switchboard reads it <strong>only through the grant you issued at sign-in</strong> (its intended program
        scope; record-level enforcement lands with spec 248). Your <strong>contact is released only when you accept</strong> a
        connection — never before. You can <strong>revoke that access anytime from your Global.Church home</strong>, and
        Switchboard&rsquo;s visibility goes to zero.
      </p>
      <button onClick={onOpenHome} style={{ marginTop: '.6rem', background: 'none', border: 'none', color: 'var(--c-primary)', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer', padding: 0 }}>
        Open your Global.Church home →
      </button>
    </Card>
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
