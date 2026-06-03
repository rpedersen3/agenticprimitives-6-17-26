import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Address, Hex } from '@agenticprimitives/types';
import { JP, GATEWAY } from './lib/brand';
import { startSiteEnrollment, startOrgCreation, exchangeCode, verifyIdToken, listRelatedOrgs, type RelatedOrgLink } from './connect-client';
import { orgPurpose } from './lib/member-org';
import { predictOrgAddress } from './lib/onchain';
import { MemberOrgSection } from './components/MemberOrgSection';
import { IntentRequest } from './components/IntentRequest';
import { toAgentName as fullName, personalHome, personalAuthOrigin, nameLabel } from './lib/domain';
import {
  type AdopterStep, type AdopterType, type Attestation,
  type FacilitatorAdopterType, type FacilitatorMinistryArea, type FacilitatorSizeBand,
  type FacilitatorStep,
  type ImpactProfile, type JpAdopterRecord, type JpFacilitatorRecord, type JpRequiredField,
  FACILITATOR_PROFILE_TYPE,
  adopterSteps, canDeclareAdoption, canDeclareCoverage, facilitatorSteps,
  impactProfileMissingFields, isAdopterOnboardingComplete, isFacilitatorOnboardingComplete,
  jpRequiredFields, loadContactExchanges, loadImpactProfile, loadJpAdopterRecord,
  loadJpFacilitatorRecord,
  nextAdopterStep, nextFacilitatorStep, profileCompleteness,
  projectFacilitatorForJp, projectForJp, recordContactExchange, requiresWea,
  saveImpactProfile, saveJpAdopterRecord, saveJpFacilitatorRecord, storeMemberGrant,
  storeReceivedDelegation,
} from './lib/vault';
import type { DelegationWire } from './lib/delegation';
import { ensureOrgDeployed } from './lib/onchain';
import {
  ADOPTER_TYPE_OPTIONS_FAC, MINISTRY_AREA_OPTIONS, SIZE_BAND_OPTIONS,
  FACILITATOR_ADOPTER_TYPE_LABEL, MINISTRY_AREA_LABEL, SIZE_BAND_LABEL,
} from './lib/capacity';
import {
  type MatchedAdopter, type MatchedFacilitator, type MatchedFacilitatorUpdate,
  DISCLOSURE_ADOPTER_TO_FACILITATOR, DISCLOSURE_FACILITATOR_TO_ADOPTER,
  matchAdoptersForFacilitator, matchFacilitatorsForAdopter, updatesForAdopter,
} from './lib/matches';
import type { PublishedUpdate } from './lib/vault';
import { MOU_DOC_ID, MOU_TEXT, attestDocConsentBound } from './lib/mou';
import { WEA_AFFIRMATIONS as WEA_AFFIRMATIONS_LIB, verifyWeaHash } from './lib/wea';
import { FPG_SEED, findPeopleGroup, formatPopulation, type PeopleGroup } from './lib/people-groups';
import { PersonaBar } from './components/PersonaBar';
import { PeteDashboard, JillDashboard } from './components/OperatorDashboards';
import { loadPersona, savePersona, clearPersona, isOperator, type Persona } from './lib/persona-mode';

// JP-Adopt is a RELYING APP (spec 236). JP runs the program; the member's Impact Community
// home holds the data + delegates scoped access. Onboarding is a JOINT flow — Impact already
// holds the profile + community-wide attestations (WEA), JP only runs the JP-specific
// ceremonies (the ADOPT MOU + the public adoption declaration). The adopter dashboard mirrors
// that split: passive "✓ on file" checks where Impact owns the data, interactive panels where
// JP runs the ceremony.

// WEA Statement of Faith affirmations — sourced from `lib/wea.ts` (shared canonical
// bytes that demo-sso-next mirrors so hash verification works end-to-end).
const WEA_AFFIRMATIONS = WEA_AFFIRMATIONS_LIB;

type Kind = 'adopter' | 'facilitator';
type Modal = null | { kind: Kind } | { kind: 'wea' };

const SESSION_KEY = 'agenticprimitives:demo-jp:session';
const ENROLL_KEY = 'agenticprimitives:demo-jp:enroll';
/** Stash for the org-create ceremony redirect (parallel to ENROLL_KEY). */
const ORG_KEY = 'agenticprimitives:demo-jp:org-create';
interface OrgStash {
  state?: string;
  kind?: Kind;
  orgName?: string;
  authOrigin?: string;
  codeVerifier?: string;
  nonce?: string;
}
/** Handoff stashes for JP→Impact ceremonies (profile edit, WEA signing). We stash a
 *  random state in sessionStorage before redirecting and verify on return — same
 *  pattern as the OIDC enrollment state (audit F5: fail-closed on mismatch). */
const PROFILE_HANDOFF_KEY = 'agenticprimitives:demo-jp:profile-handoff';
const WEA_HANDOFF_KEY = 'agenticprimitives:demo-jp:wea-handoff';
interface ProfileHandoffStash { state: string }
interface WeaHandoffStash { state: string }

function randomB64url(n: number): string {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  let s = '';
  for (const b of a) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface Session {
  token: string;
  name: string;
  address: Address;
  kind: Kind;
  fresh: boolean;
  /** The scoped read+write delegation the member granted JP at sign-in (spec 247).
   *  JP reads/writes the member's JP-program records in the MEMBER's own vault
   *  through this grant — the data lives with the member, JP holds the delegation. */
  grant?: DelegationWire;
}

interface EnrollStash {
  state?: string;
  name?: string;
  authOrigin?: string;
  codeVerifier?: string;
  nonce?: string;
  kind?: Kind;
}

function decodeToken(token: string): { sub?: string; exp?: number } | null {
  try {
    const seg = token.split('.')[1] ?? '';
    const json = atob(seg.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((2 - (seg.length & 3)) & 3));
    return JSON.parse(json) as { sub?: string; exp?: number };
  } catch {
    return null;
  }
}

function addrFromSub(sub?: string): Address | null {
  const m = sub?.match(/0x[0-9a-fA-F]{40}$/);
  return (m?.[0] as Address) ?? null;
}

function restoreSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { token?: string; name?: string; kind?: Kind; grant?: DelegationWire };
    if (!s.token || !s.name || (s.kind !== 'adopter' && s.kind !== 'facilitator')) return null;
    const dec = decodeToken(s.token);
    const addr = addrFromSub(dec?.sub);
    if (!addr || !dec?.exp || dec.exp * 1000 <= Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    // SEC-019: localStorage gives us a tentative session (we still gate exp here so a
    // visibly-stale token never opens the dashboard). A useEffect at mount re-verifies
    // the JWT signature against the home's JWKS — if it fails, the session is dropped.
    return { token: s.token, name: s.name, address: addr, kind: s.kind, fresh: false, grant: s.grant };
  } catch {
    return null;
  }
}

// ── Icons ───────────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function GlobeGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

/** "(you)" hint shown when a match card is the viewer's own dual persona. */
function SelfBadge() {
  return (
    <span
      title="This match is your own facilitator persona — you have a JpFacilitatorRecord at the same SA address. In production, multi-persona users see themselves the same way."
      style={{
        fontSize: '.6rem', fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase',
        padding: '.12rem .45rem', borderRadius: 999,
        background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d',
      }}
    >
      (you)
    </span>
  );
}

// ── App ─────────────────────────────────────────────────────────────────────

export function App() {
  const [session, setSession] = useState<Session | null>(restoreSession);
  const [modal, setModal] = useState<Modal>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Bumped whenever the Impact profile is updated externally (e.g. returning from the
   *  member's /profile editor at their Impact home). Used as the `key` on AdopterIntranet
   *  so it re-mounts and reloads the vault from localStorage. */
  const [vaultBump, setVaultBump] = useState(0);
  /** Active demo persona (Wave 8.13). Operator personas (Pete/Jill) render the
   *  issuer/broker dashboards; member personas keep the SSO flow below. */
  const [persona, setPersona] = useState<Persona | null>(loadPersona);

  const switchPersona = useCallback((p: Persona | null) => {
    setPersona(p);
    setError(null);
    if (p) savePersona(p);
    else clearPersona();
    // Selecting a member persona with no session opens that onboarding flow.
    if ((p === 'adopter' || p === 'facilitator') && !restoreSession()) setModal({ kind: p });
  }, []);

  /** ADR-0025 / spec 246: demo-jp keeps NO local person→org store. It asks Connect
   *  (the person's home) for the orgs related to THIS app, authorized by the person's
   *  session id_token. Re-queries on `vaultBump` (e.g. after an org-create return). */
  const [relatedOrgs, setRelatedOrgs] = useState<RelatedOrgLink[]>([]);
  useEffect(() => {
    const s = restoreSession();
    if (!s) { setRelatedOrgs([]); return; }
    let cancelled = false;
    void listRelatedOrgs(s.name, s.token).then((orgs) => { if (!cancelled) setRelatedOrgs(orgs); }).catch(() => {});
    return () => { cancelled = true; };
  }, [vaultBump]);

  /** Kick off the Impact org-create ceremony — the connected user custodies the new
   *  org SA via their ROOT credential at their home. We tag the org with a purpose
   *  (jp-adopter-org / jp-facilitator-org) so the private vault link is scoped; on
   *  return we re-query Connect (no local person→org store — ADR-0025). */
  const goCreateOrg = useCallback(async (kind: Kind, orgName: string) => {
    const s = restoreSession();
    if (!s) { setError('Connect first, then create your organization.'); return; }
    try {
      // Grant the JP broker org scoped read access to the new org (spec 246 §5) so
      // Jill can later list the orgs delegated to JP. Optional — derive its address;
      // if the relayer is unreachable we proceed without the broker grant.
      let grantOrg: Address | undefined;
      try { grantOrg = await predictOrgAddress('jp'); } catch { /* broker grant optional */ }
      const { url, state, authOrigin, codeVerifier, nonce } = await startOrgCreation(s.name, orgName, orgPurpose(kind), grantOrg);
      const stash: OrgStash = { state, kind, orgName, authOrigin, codeVerifier, nonce };
      sessionStorage.setItem(ORG_KEY, JSON.stringify(stash));
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start organization creation.");
    }
  }, []);

  // SEC-019: re-verify the restored JWT's signature against the home's JWKS. If we
  // can't fetch the JWKS OR the signature doesn't verify, drop the session. Runs once
  // per mount when there's a restored token; the OIDC return path mints a fresh token
  // that has already been verified inside `completeAuth`, so we skip re-verify when
  // `session.fresh === true`.
  useEffect(() => {
    if (!session || session.fresh) return;
    let cancelled = false;
    void (async () => {
      try {
        const authOrigin = personalAuthOrigin(nameLabel(session.name));
        // Empty `expectedNonce` — session restore can't replay the original; signature
        // + exp + iss are the load-bearing checks here.
        await verifyIdToken(authOrigin, session.token, '');
      } catch (e) {
        if (cancelled) return;
        // Restored token failed signature/iss/exp/allowlist; force a fresh sign-in.
        setSession(null);
        try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
        setError(`Saved sign-in could not be re-verified (${e instanceof Error ? e.message : 'unknown'}). Please sign in again.`);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openSession = useCallback((token: string, name: string, kind: Kind, fresh: boolean, grant?: DelegationWire) => {
    const addr = addrFromSub(decodeToken(token)?.sub);
    if (!addr) {
      setError("We couldn't read your agent address from the session token.");
      return;
    }
    setSession({ token, name, address: addr, kind, fresh, grant });
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ token, name, kind, grant }));
    } catch {
      /* ignore */
    }
    // spec 247: register the member's grant in JP's vault (the broker pool), so the
    // broker can later read this member's records through it. Idempotent; deploys JP
    // (Jill's key, in this demo browser) if needed.
    if (grant) {
      void (async () => {
        try {
          await ensureOrgDeployed('jp');
          await storeMemberGrant(addr, grant);
        } catch { /* broker pool registration is best-effort in the demo */ }
      })();
    }
  }, []);

  const signOut = useCallback(() => {
    setSession(null);
    setError(null);
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }, []);

  // OIDC return-path handler (demo-org / spec 230 pattern).
  useEffect(() => {
    const u = new URL(window.location.href);
    const code = u.searchParams.get('code');
    const retState = u.searchParams.get('state');
    const err = u.searchParams.get('enroll_error');
    if (!code && !err) return;
    for (const k of ['code', 'state', 'enroll_error']) u.searchParams.delete(k);
    window.history.replaceState({}, '', u.toString());
    if (err) { setError(`Sign-in was not completed (${err}).`); return; }

    // Org-create return (template=org-create): the home deployed an org SA custodied
    // by the user's ROOT credential + minted an org→demo-jp delegation. Check this
    // stash FIRST — its state won't match the site-login ENROLL stash.
    let orgStash: OrgStash = {};
    try { orgStash = JSON.parse(sessionStorage.getItem(ORG_KEY) ?? '{}') as OrgStash; } catch { /* ignore */ }
    if (code && orgStash.state && retState && orgStash.state === retState) {
      sessionStorage.removeItem(ORG_KEY);
      if (!orgStash.authOrigin || !orgStash.codeVerifier || !orgStash.kind) {
        setError('Organization response was incomplete. Please try again.');
        return;
      }
      void (async () => {
        try {
          // Complete the exchange (the home already wrote the private vault link).
          const tok = await exchangeCode(orgStash.authOrigin!, code, orgStash.codeVerifier!);
          if (!tok.org) throw new Error('no organization returned from your home');
          // ADR-0025: no local person→org save — re-query Connect for the related orgs.
          // spec 247: if the org delegated scoped access to JP (the broker grant), JP
          // holds it in its OWN vault as a received delegation — the single source for
          // "orgs delegated to JP" (replaces the Connect delegated-idx index).
          if (tok.org.brokerDelegation) {
            try {
              await ensureOrgDeployed('jp');
              await storeReceivedDelegation({
                orgAgent: tok.org.orgAgent,
                orgName: tok.org.orgName,
                delegation: tok.org.brokerDelegation,
              });
            } catch { /* received-delegation registration is best-effort in the demo */ }
          }
          setVaultBump((n) => n + 1);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'organization creation failed');
        }
      })();
      return;
    }

    let stash: EnrollStash = {};
    try { stash = JSON.parse(sessionStorage.getItem(ENROLL_KEY) ?? '{}') as EnrollStash; } catch { /* ignore */ }
    if (!stash.state || !retState || stash.state !== retState) {
      setError("We couldn't verify that response. Please try again.");
      return;
    }
    sessionStorage.removeItem(ENROLL_KEY);
    if (!code || !stash.authOrigin || !stash.codeVerifier || !stash.kind) {
      setError('Sign-in response was incomplete. Please try again.');
      return;
    }
    void (async () => {
      try {
        const tok = await exchangeCode(stash.authOrigin!, code, stash.codeVerifier!);
        const claims = await verifyIdToken(stash.authOrigin!, tok.idToken, stash.nonce ?? '');
        const name = claims.agent_name ?? stash.name ?? '';
        openSession(tok.idToken, name, stash.kind!, true, tok.delegation);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'sign-in failed');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Return-from-Impact-profile-editor: parse `?profile_state` + `?profile_<key>` params,
  // validate against the stash, merge into the member's ImpactProfile localStorage, then
  // strip the params and bump `vaultBump` so the dashboard re-reads the vault.
  useEffect(() => {
    const u = new URL(window.location.href);
    const profileState = u.searchParams.get('profile_state');
    if (!profileState) return;

    let stash: ProfileHandoffStash | null = null;
    try { stash = JSON.parse(sessionStorage.getItem(PROFILE_HANDOFF_KEY) ?? 'null') as ProfileHandoffStash | null; } catch { /* ignore */ }
    const valid = !!stash && stash.state === profileState;

    // Collect `profile_<key>` values regardless of validity so we can strip them; only
    // APPLY when state matches.
    const collected: Record<string, string> = {};
    const allParams = Array.from(u.searchParams.keys());
    for (const k of allParams) {
      if (k.startsWith('profile_') && k !== 'profile_state') {
        const v = u.searchParams.get(k);
        if (v) collected[k.slice('profile_'.length)] = v;
      }
      if (k === 'profile_state' || k.startsWith('profile_')) u.searchParams.delete(k);
    }
    window.history.replaceState({}, '', u.toString());

    if (!valid) {
      setError("We couldn't verify that profile update. Please try again from JP.");
      return;
    }
    sessionStorage.removeItem(PROFILE_HANDOFF_KEY);

    const restored = restoreSession();
    if (!restored?.grant) return;
    const grant = restored.grant;
    void (async () => {
      const existing = await loadImpactProfile(grant);
      const nextProfile: ImpactProfile = {
        ...existing,
        contact: { ...(existing.contact ?? {}), ...collected },
      };
      await saveImpactProfile(grant, nextProfile);
      setVaultBump((b) => b + 1);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Hand the member off to their Impact home's /profile editor. Stashes a state binding,
   *  attaches the missing-fields list, and redirects. On return we land back at JP root
   *  with `?profile_state=&profile_<key>=...` which the effect above merges into the vault. */
  const goEditProfileAtImpact = useCallback((name: string, missingKeys: string[]) => {
    const homeOrigin = personalAuthOrigin(nameLabel(name));
    const state = randomB64url(16);
    try { sessionStorage.setItem(PROFILE_HANDOFF_KEY, JSON.stringify({ state })); } catch { /* ignore */ }
    const returnUrl = window.location.origin + '/';
    const u = new URL('/profile', homeOrigin);
    u.searchParams.set('app', 'demo-jp');
    u.searchParams.set('return', returnUrl);
    u.searchParams.set('state', state);
    if (missingKeys.length > 0) u.searchParams.set('required', missingKeys.join(','));
    window.location.href = u.toString();
  }, []);

  /** Hand the member off to their Impact home's /wea-sign ceremony. On return we get
   *  `?wea_state=&wea_docHash=&wea_signedAt=&wea_consentBoundTo=&wea_docId=`. */
  const goSignWeaAtImpact = useCallback((name: string) => {
    const homeOrigin = personalAuthOrigin(nameLabel(name));
    const state = randomB64url(16);
    try { sessionStorage.setItem(WEA_HANDOFF_KEY, JSON.stringify({ state })); } catch { /* ignore */ }
    const returnUrl = window.location.origin + '/';
    const u = new URL('/wea-sign', homeOrigin);
    u.searchParams.set('app', 'demo-jp');
    u.searchParams.set('return', returnUrl);
    u.searchParams.set('state', state);
    window.location.href = u.toString();
  }, []);

  // Return-from-Impact-WEA-signing: parse `?wea_state=&wea_docHash=&wea_signedAt=
  // &wea_consentBoundTo=&wea_docId=`, validate state, verify the docHash matches our
  // canonical bytes (`verifyWeaHash`), merge into ImpactProfile.attestations.wea, then
  // strip params and bump `vaultBump`.
  useEffect(() => {
    const u = new URL(window.location.href);
    const weaState = u.searchParams.get('wea_state');
    if (!weaState) return;

    let stash: WeaHandoffStash | null = null;
    try { stash = JSON.parse(sessionStorage.getItem(WEA_HANDOFF_KEY) ?? 'null') as WeaHandoffStash | null; } catch { /* ignore */ }
    const valid = !!stash && stash.state === weaState;

    const docHash = u.searchParams.get('wea_docHash') ?? '';
    const docId = u.searchParams.get('wea_docId') ?? '';
    const signedAt = parseInt(u.searchParams.get('wea_signedAt') ?? '0', 10);
    const consentBoundTo = u.searchParams.get('wea_consentBoundTo') ?? '';
    for (const k of ['wea_state', 'wea_docHash', 'wea_docId', 'wea_signedAt', 'wea_consentBoundTo']) u.searchParams.delete(k);
    window.history.replaceState({}, '', u.toString());

    if (!valid) {
      setError("We couldn't verify that WEA signing. Please try again from JP.");
      return;
    }
    sessionStorage.removeItem(WEA_HANDOFF_KEY);

    void (async () => {
      const ok = await verifyWeaHash(docHash);
      if (!ok) {
        setError('The WEA attestation hash did not match our canonical document — please re-sign.');
        return;
      }
      const restored = restoreSession();
      if (!restored?.grant) return;
      const grant = restored.grant;
      const existing = await loadImpactProfile(grant);
      const nextProfile: ImpactProfile = {
        ...existing,
        attestations: {
          ...existing.attestations,
          wea: { docHash: docHash as Hex, docId, signedAt, consentBoundTo: consentBoundTo as Hex },
        },
      };
      await saveImpactProfile(grant, nextProfile);
      setVaultBump((b) => b + 1);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const beginConnect = useCallback(async (name: string, kind: Kind) => {
    setError(null);
    try {
      setBusy('Opening your secure home…');
      const { url, state, authOrigin, codeVerifier, nonce } = await startSiteEnrollment(name);
      const stash: EnrollStash = { state, name, authOrigin, codeVerifier, nonce, kind };
      sessionStorage.setItem(ENROLL_KEY, JSON.stringify(stash));
      window.location.href = url;
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : "Couldn't start sign-in.");
    }
  }, []);

  const bar = <PersonaBar active={persona} onSwitch={switchPersona} />;

  // Operator personas (Pete / Jill) short-circuit the SSO flow.
  if (persona && isOperator(persona)) {
    return <>{bar}{persona === 'pete' ? <PeteDashboard /> : <JillDashboard />}</>;
  }

  if (session) {
    if (session.kind === 'adopter') {
      return (
        <>{bar}
        <AdopterIntranet
          key={vaultBump}
          session={session}
          org={relatedOrgs.find((o) => o.purpose === orgPurpose('adopter')) ?? relatedOrgs.find((o) => o.stewardshipDelegation) ?? null}
          relatedOrgs={relatedOrgs}
          onCreateOrg={(name) => goCreateOrg('adopter', name)}
          onSignOut={signOut}
          onOpenWea={() => setModal({ kind: 'wea' })}
          onGoEditProfile={(missingKeys) => goEditProfileAtImpact(session.name, missingKeys)}
          onGoSignWea={() => goSignWeaAtImpact(session.name)}
        />
        </>
      );
    }
    return (
      <>{bar}
      <FacilitatorIntranet
        key={vaultBump}
        session={session}
        org={relatedOrgs.find((o) => o.purpose === orgPurpose('facilitator')) ?? relatedOrgs.find((o) => o.stewardshipDelegation) ?? null}
        onCreateOrg={(name) => goCreateOrg('facilitator', name)}
        onSignOut={signOut}
        onOpenWea={() => setModal({ kind: 'wea' })}
        onGoEditProfile={(missingKeys) => goEditProfileAtImpact(session.name, missingKeys)}
        onGoSignWea={() => goSignWeaAtImpact(session.name)}
      />
      </>
    );
  }

  // ── Signed-out marketing page (unchanged from the user-approved version) ────
  return (
    <>
      {bar}
      <header className="topbar">
        <div className="wrap">
          <div className="brand">
            <span className="brand-glyph" aria-hidden="true"><GlobeGlyph /></span>
            <div>{JP.appName}<small>{JP.org} · Frontier People Groups</small></div>
          </div>
          <span className="powered">Powered by <b>{GATEWAY.community}</b></span>
        </div>
      </header>

      {error && (
        <div role="alert" style={{ background: '#fef2f2', borderBottom: '1px solid #fecaca', color: '#991b1b', padding: '.75rem 1.25rem', textAlign: 'center', fontSize: '.875rem' }}>{error}</div>
      )}

      <section className="hero">
        <div className="wrap">
          <div className="eyebrow">{JP.hero.eyebrow}</div>
          <h1 style={{ marginTop: '.6rem' }}>{JP.hero.title}</h1>
          <p className="hero-sub">{JP.hero.sub}</p>
          <p className="hero-note">{JP.hero.note}</p>
          <div className="hero-cta">
            <button className="btn btn-primary btn-lg" onClick={() => setModal({ kind: 'adopter' })}>{JP.paths.adopter.cta}</button>
            <button className="btn btn-ghost btn-lg" onClick={() => setModal({ kind: 'facilitator' })}>{JP.paths.facilitator.cta}</button>
          </div>
          <div className="stats">
            {JP.stats.map((s) => (
              <div className="stat" key={s.label}>
                <div className="stat-v">{s.value}{'of' in s && s.of ? <span className="of"> / {s.of}</span> : null}</div>
                <div className="stat-l">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section wrap">
        <div className="sec-head">
          <div className="eyebrow">The five movements</div>
          <h2>Adoption is a journey, not a form</h2>
          <p>Adopting a Frontier People Group means walking the ADOPT path — and you don’t walk it alone.</p>
        </div>
        <div className="movements">
          {JP.movements.map((m) => (
            <div className="move" key={m.k}>
              <div className="move-k" aria-hidden="true">{m.k}</div>
              <h3>{m.title}</h3>
              <p>{m.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section wrap" style={{ paddingTop: 0 }}>
        <div className="sec-head"><h2>Two ways to take part</h2></div>
        <div className="paths">
          {(['adopter', 'facilitator'] as const).map((k) => {
            const p = JP.paths[k];
            return (
              <div className={`path${k === 'adopter' ? ' accent' : ''}`} key={k}>
                <h3>{p.title}</h3>
                <div className="path-who">{p.who}</div>
                <p className="path-body">{p.body}</p>
                <ol>{p.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                <button className={`btn ${k === 'adopter' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setModal({ kind: k })}>{p.cta}</button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="section wrap" style={{ paddingTop: 0 }}>
        <div className="trust">
          <div className="eyebrow" style={{ color: 'var(--c-primary-mid)' }}>Self-sovereign by design</div>
          <h2>{JP.trust.title}</h2>
          <div className="trust-grid">
            {JP.trust.points.map((pt, i) => (
              <div className="trust-pt" key={i}><CheckIcon /><span>{pt}</span></div>
            ))}
          </div>
        </div>
      </section>

      <section className="section wrap" style={{ paddingTop: 0 }}>
        <div className="sec-head">
          <div className="eyebrow">Accountability</div>
          <h2>What you agree to</h2>
          <p>Both are signed inside your {JP.impactName} vault and held with you. JP receives the attestation that you signed — not the document itself.</p>
        </div>
        <div className="agreements">
          <div className="agreement">
            <h3>{JP.mou.name}</h3>
            <p>{JP.mou.blurb}</p>
          </div>
          <div className="agreement">
            <h3>{JP.wea.name}</h3>
            <p>{JP.wea.blurb}</p>
            <button onClick={() => setModal({ kind: 'wea' })}>Read the statement →</button>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <span>{JP.org} · Adopt-a-People-Group pilot — JP runs the program.</span>
          <span>Identity + data vault: <b style={{ color: 'var(--c-primary)' }}>{JP.impactName}</b>. You stay in control.</span>
        </div>
      </footer>

      {modal && (modal.kind === 'adopter' || modal.kind === 'facilitator') && (
        <OnboardPanel
          kind={modal.kind}
          busy={busy}
          onClose={() => { setModal(null); setBusy(null); }}
          onConnect={(name) => beginConnect(name, modal.kind as Kind)}
        />
      )}
      {modal && modal.kind === 'wea' && <WeaModal onClose={() => setModal(null)} />}
    </>
  );
}

// ── Onboarding-entry panel (unchanged) ──────────────────────────────────────

function OnboardPanel({ kind, busy, onClose, onConnect }: {
  kind: Kind; busy: string | null; onClose: () => void; onConnect: (name: string) => void;
}) {
  const p = JP.paths[kind];
  const [name, setName] = useState<string>(() => {
    try { return localStorage.getItem('agenticprimitives:demo-jp:last-name') ?? ''; } catch { return ''; }
  });
  const trimmed = name.trim();
  const submit = () => {
    if (!trimmed || busy) return;
    try { localStorage.setItem('agenticprimitives:demo-jp:last-name', trimmed); } catch { /* ignore */ }
    onConnect(trimmed);
  };
  return (
    <div className="scrim" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <button className="panel-x" onClick={onClose} aria-label="Close">×</button>
        <h2>{p.cta}</h2>
        <div className="who">{p.who}</div>
        <p style={{ color: 'var(--c-g600)', marginTop: '.75rem' }}>{p.body}</p>
        <p style={{ marginTop: '1rem', fontWeight: 700, color: 'var(--c-g800)' }}>Here’s the flow:</p>
        <ol>{p.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        <p style={{ marginTop: '1rem', fontSize: '.85rem', color: 'var(--c-g600)' }}>
          {JP.org} runs the adoption program. {JP.impactName} is your private identity + data
          vault — JP only sees what you grant, and you can revoke it any time.
        </p>
        <div className="panel-foot" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '.6rem' }}>
          <label htmlFor="jp-impact-name" style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--c-g700)', letterSpacing: '.02em' }}>
            Your {JP.impactName} name
          </label>
          <input
            id="jp-impact-name" type="text" value={name}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="e.g. rich-pedersen" autoComplete="username" autoCapitalize="none"
            spellCheck={false} disabled={!!busy}
            style={{ padding: '.75rem .9rem', fontSize: '1rem', borderRadius: 10, border: '1.5px solid var(--c-g300)', background: '#fff', width: '100%', fontFamily: "'SF Mono','Roboto Mono',monospace" }}
          />
          {trimmed && (
            <div style={{ fontSize: '.75rem', color: 'var(--c-g500)', fontFamily: "'SF Mono','Roboto Mono',monospace" }}>
              {fullName(trimmed)} · home at {personalHome(trimmed)}
            </div>
          )}
          <button className="btn-sso" onClick={submit} disabled={!trimmed || !!busy} title="Connect via Impact Community">
            <span className="btn-sso-glyph" aria-hidden="true"><GlobeGlyph size={16} /></span>
            {busy ?? JP.ssoCta}
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: '.72rem', fontWeight: 600, color: 'var(--c-g400)' }}>SSO + your vault</span>
          </button>
          <span className="soon" style={{ background: 'var(--c-primary-subtle)', borderColor: 'var(--c-primary-border)', color: 'var(--c-primary-active)' }}>
            You’ll confirm with your device at <b>{personalHome(trimmed || 'your-name')}</b>, then come back here to continue with JP.
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Adopter Intranet ────────────────────────────────────────────────────────
// The dashboard for an adopter. Loads the member's Impact profile (passive — JP
// observes via the delegation) + the JP adopter record (interactive — JP runs
// these ceremonies). Steps that Impact already satisfies show as "✓ on file";
// JP-specific steps expand into inline forms when active.

function AdopterIntranet({ session, org, relatedOrgs, onCreateOrg, onSignOut, onOpenWea, onGoEditProfile, onGoSignWea }: {
  session: Session; org: RelatedOrgLink | null; relatedOrgs: RelatedOrgLink[]; onCreateOrg: (orgName: string) => void;
  onSignOut: () => void; onOpenWea: () => void;
  onGoEditProfile: (missingKeys: string[]) => void;
  onGoSignWea: () => void;
}) {
  const [impact, setImpact] = useState<ImpactProfile>({ v: 1, attestations: {} });
  const [record, setRecord] = useState<JpAdopterRecord>({ v: 1, attestations: {} });
  // Profile + JP record live in JP Org's vault (spec 247); load on mount (the parent
  // re-mounts this on vaultBump after handoff-return merges, so edits reload).
  useEffect(() => {
    const grant = session.grant;
    if (!grant) return;
    let cancelled = false;
    void (async () => {
      const [i, r] = await Promise.all([loadImpactProfile(grant), loadJpAdopterRecord(grant)]);
      if (!cancelled) { setImpact(i); setRecord(r); }
    })();
    return () => { cancelled = true; };
  }, [session.grant]);
  const update = useCallback((next: JpAdopterRecord) => {
    if (session.grant) void saveJpAdopterRecord(session.grant, next);
    setRecord(next);
  }, [session.grant]);

  const steps = useMemo(() => adopterSteps(impact, record), [impact, record]);
  const activeStep = useMemo(() => nextAdopterStep(impact, record), [impact, record]);
  const complete = useMemo(() => isAdopterOnboardingComplete(impact, record), [impact, record]);
  const completeness = useMemo(() => profileCompleteness(impact, record.adopterType), [impact, record.adopterType]);
  const canDeclare = useMemo(() => canDeclareAdoption(impact, record), [impact, record]);
  const homeUrl = personalAuthOrigin(nameLabel(session.name));

  const displayName = displayNameFromImpact(impact, session.name);
  return (
    <>
      <IntranetTopbar session={session} subtitle="Adopter dashboard" onSignOut={onSignOut} impact={impact} />
      <HeaderAlerts
        impact={impact}
        adopterType={record.adopterType}
        onGoEditProfile={onGoEditProfile}
      />

      {session.fresh && (
        <div style={{ background: 'var(--c-primary-subtle)', borderBottom: '1px solid var(--c-primary-border)', padding: '.75rem 1.25rem', textAlign: 'center', fontSize: '.9rem', color: 'var(--c-primary-active)' }}>
          ✓ Connected via {JP.impactName} — welcome, <b>{displayName}</b>. Your home + vault are at{' '}
          <a href={homeUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c-primary)' }}>{homeUrl}</a>.
        </div>
      )}

      <MemberOrgSection kind="adopter" org={org} onCreateOrg={onCreateOrg} />

      <section className="section wrap" style={{ paddingTop: 0 }}>
        <IntentRequest personSa={session.address} personName={session.name} orgs={relatedOrgs} />
      </section>

      {complete ? (
        <AdoptionSummary session={session} record={record} impact={impact} />
      ) : (
        <>
          <section className="hero" style={{ padding: '3rem 0 2rem' }}>
            <div className="wrap">
              <div className="eyebrow">{JP.paths.adopter.who}</div>
              <h1 style={{ marginTop: '.5rem', fontSize: 'clamp(1.6rem, 4vw, 2.4rem)' }}>{JP.paths.adopter.title}</h1>
              <p className="hero-sub" style={{ fontSize: '1rem' }}>
                {JP.org} runs the program; {JP.impactName} holds the data. We’re only asking you for what JP needs that
                isn’t already on file with your home.
              </p>
            </div>
          </section>

          <section className="section wrap" style={{ paddingTop: 0 }}>
            <div className="sec-head">
              <div className="eyebrow">Adopter onboarding</div>
              <h2>{completeness.missing.length === 0 ? 'Just the JP-specific steps — your profile is already on file' : `${JP.org} needs a few things from your ${JP.impactName} profile`}</h2>
            </div>
            {completeness.missing.length > 0 && (
              <ProfileCompletenessBanner
                completeness={completeness}
                onGoEditProfile={() => onGoEditProfile(completeness.missing.map((f) => f.key))}
              />
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.875rem', marginTop: '1.5rem' }}>
              {steps.map((s, i) => (
                <StepCard
                  key={s.step}
                  n={i + 1}
                  step={s.step}
                  ownedBy={s.ownedBy}
                  active={s.step === activeStep}
                  satisfied={s.satisfied}
                  impact={impact}
                  record={record}
                  session={session}
                  canDeclare={canDeclare}
                  onUpdate={update}
                  onOpenWea={onOpenWea}
                  onGoEditProfile={onGoEditProfile}
                  onGoSignWea={onGoSignWea}
                />
              ))}
            </div>
          </section>

          <JpProjectionPanel impact={impact} record={record} session={session} />
        </>
      )}

      <IntranetFooter />
    </>
  );
}

/** Header-level catch-all alert. Sticks under the topbar on every signed-in screen so
 *  if a member arrived through any path (onboarding, returning to the summary, the
 *  facilitator placeholder) and JP still needs something, the call-to-action is one
 *  click away. Today: profile fields. Easy to add more bands (MOU pending, WEA pending,
 *  declaration pending) — declare an alert in `pickAlert` and the rendering follows. */
function HeaderAlerts({
  impact,
  adopterType,
  onGoEditProfile,
}: {
  impact: ImpactProfile;
  adopterType: AdopterType | undefined;
  onGoEditProfile: (missingKeys: string[]) => void;
}) {
  const alert = pickHeaderAlert(impact, adopterType);
  if (!alert) return null;
  return (
    <div role="alert" aria-live="polite" className={`header-alert${alert.severity === 'red' ? ' red' : ''}`}>
      <div className="header-alert-inner">
        <span className="header-alert-icon" aria-hidden="true">!</span>
        <div className="header-alert-body">
          <strong>{alert.title}</strong>
          <span>{alert.body}</span>
        </div>
        <button
          className="header-alert-action"
          onClick={() => onGoEditProfile(alert.missingKeys)}
        >
          {alert.actionLabel}
        </button>
      </div>
    </div>
  );
}

interface HeaderAlert {
  severity: 'amber' | 'red';
  title: string;
  body: string;
  actionLabel: string;
  missingKeys: string[];
}

function pickHeaderAlert(impact: ImpactProfile, adopterType: AdopterType | undefined): HeaderAlert | null {
  const missing = impactProfileMissingFields(impact, adopterType);
  if (missing.length > 0) {
    return {
      severity: 'amber',
      title: `${missing.length === 1 ? '1 field' : `${missing.length} fields`} needed in your ${JP.impactName} profile`,
      body: `${JP.org} needs ${missing.map((f) => f.label).join(', ')} — add it once at your home, re-used everywhere.`,
      actionLabel: `Complete at my ${JP.impactName} home →`,
      missingKeys: missing.map((f) => f.key),
    };
  }
  // Hook point — future alerts (MOU pending, etc.) plug in here.
  return null;
}

/** Compute a friendly display name from the Impact profile, falling back to the handle.
 *  JP has read access to first/last via the held delegation, so the topbar can render
 *  "Rich Pedersen" instead of "rich-pedersen". The handle stays as a small tooltip and
 *  in the address pill so the canonical id is never hidden. */
function displayNameFromImpact(impact: ImpactProfile | null, fallbackHandle: string): string {
  const f = impact?.contact?.firstName?.trim();
  const l = impact?.contact?.lastName?.trim();
  if (f && l) return `${f} ${l}`;
  if (f) return f;
  if (l) return l;
  return fallbackHandle;
}

function IntranetTopbar({
  session,
  subtitle,
  onSignOut,
  impact,
}: {
  session: Session;
  subtitle: string;
  onSignOut: () => void;
  /** Optional — pass to render the friendly display name. */
  impact?: ImpactProfile | null;
}) {
  const short = `${session.address.slice(0, 6)}…${session.address.slice(-4)}`;
  const displayName = displayNameFromImpact(impact ?? null, session.name);
  const hasFriendly = displayName !== session.name;
  return (
    <header className="topbar">
      <div className="wrap">
        <div className="brand">
          <span className="brand-glyph" aria-hidden="true"><GlobeGlyph /></span>
          <div>{JP.appName}<small>{JP.org} · {subtitle}</small></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
          <div
            title={`${session.name} · ${session.address}`}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.1, maxWidth: 260, overflow: 'hidden' }}
          >
            <span style={{ fontWeight: 700, color: 'var(--c-g900)', fontSize: '.95rem', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', maxWidth: '100%' }}>
              {displayName}
            </span>
            <span style={{ fontSize: '.7rem', color: 'var(--c-g500)', fontFamily: "'SF Mono','Roboto Mono',monospace", marginTop: '.15rem', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', maxWidth: '100%' }}>
              {hasFriendly ? `${session.name} · ${short}` : short}
            </span>
          </div>
          <a
            className="btn btn-ghost"
            style={{ padding: '.5rem 1rem', fontSize: '.85rem' }}
            href={`${personalAuthOrigin(nameLabel(session.name))}/you`}
            target="_blank"
            rel="noopener noreferrer"
            title="Your home + data vault on Impact"
          >
            Your {JP.impactName} home ↗
          </a>
          <button className="btn btn-ghost" style={{ padding: '.5rem 1rem', fontSize: '.85rem' }} onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    </header>
  );
}

function IntranetFooter() {
  return (
    <footer>
      <div className="wrap">
        <span>{JP.org} · Adopt-a-People-Group pilot — JP runs the program.</span>
        <span>Identity + data vault: <b style={{ color: 'var(--c-primary)' }}>{JP.impactName}</b>. You stay in control.</span>
      </div>
    </footer>
  );
}

// ── Step orchestration ──────────────────────────────────────────────────────

function StepCard({
  n, step, ownedBy, active, satisfied, impact, record, session, canDeclare, onUpdate, onOpenWea, onGoEditProfile, onGoSignWea,
}: {
  n: number; step: AdopterStep; ownedBy: 'impact' | 'jp'; active: boolean; satisfied: boolean;
  impact: ImpactProfile; record: JpAdopterRecord; session: Session; canDeclare: boolean;
  onUpdate: (next: JpAdopterRecord) => void; onOpenWea: () => void;
  onGoEditProfile: (missingKeys: string[]) => void;
  onGoSignWea: () => void;
}) {
  const meta = stepMeta(step);
  const status: 'done' | 'active' | 'pending' = satisfied ? 'done' : active ? 'active' : 'pending';
  return (
    <div className="agreement" style={{
      display: 'flex', gap: '1rem', alignItems: 'flex-start',
      borderColor: status === 'active' ? 'var(--c-primary-border)' : 'var(--c-g200)',
      background: status === 'active' ? 'linear-gradient(180deg, var(--c-primary-subtle) 0%, #fff 60%)' : 'var(--c-g50)',
      opacity: status === 'pending' ? .55 : 1,
    }}>
      <div style={{
        flex: '0 0 auto', width: 36, height: 36, borderRadius: 999,
        background: status === 'done' ? 'var(--c-primary)' : status === 'active' ? 'var(--c-primary)' : 'var(--c-g200)',
        color: status === 'done' || status === 'active' ? '#fff' : 'var(--c-g600)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '.9rem',
      }}>{status === 'done' ? '✓' : n}</div>
      <div style={{ flex: 1 }}>
        <h3 style={{ fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
          {meta.title}
          <OwnedByPill ownedBy={ownedBy} />
        </h3>
        <p style={{ color: 'var(--c-g600)', fontSize: '.9rem', marginTop: '.25rem' }}>{meta.blurb}</p>
        {status === 'done' && step !== 'adopter-type' && step !== 'mou' && step !== 'adoption' && (
          <StepDoneSummary step={step} impact={impact} record={record} />
        )}
        {status === 'active' && (
          <div style={{ marginTop: '1rem' }}>
            {step === 'profile-on-file' && (
              <ProfileMissingCallout
                impact={impact}
                adopterType={record.adopterType}
                onGoEditProfile={onGoEditProfile}
              />
            )}
            {step === 'adopter-type' && <AdopterTypeForm record={record} onSave={onUpdate} />}
            {step === 'wea-on-file' && <WeaOnFileMissing onOpenWea={onOpenWea} onGoSignWea={onGoSignWea} />}
            {step === 'mou' && (
              <MouSignForm
                session={session}
                onSign={(att) => onUpdate({ ...record, attestations: { ...record.attestations, mou: att } })}
              />
            )}
            {step === 'adoption' && (
              <DeclareAdoptionForm
                impact={impact}
                record={record}
                canDeclare={canDeclare}
                onSave={onUpdate}
                onGoEditProfile={onGoEditProfile}
                onGoSignWea={onGoSignWea}
              />
            )}
          </div>
        )}
        {status === 'done' && (step === 'adopter-type' || step === 'mou') && (
          <StepDoneSummary step={step} impact={impact} record={record} />
        )}
      </div>
    </div>
  );
}

function OwnedByPill({ ownedBy }: { ownedBy: 'impact' | 'jp' }) {
  const isImpact = ownedBy === 'impact';
  return (
    <span style={{
      fontSize: '.65rem', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase',
      padding: '.18rem .5rem', borderRadius: 999,
      background: isImpact ? 'var(--c-primary-subtle)' : '#fef3c7',
      color: isImpact ? 'var(--c-primary-active)' : '#92400e',
      border: `1px solid ${isImpact ? 'var(--c-primary-border)' : '#fcd34d'}`,
    }}>
      {isImpact ? `🏠 from ${JP.impactName}` : `📋 ${JP.org} step`}
    </span>
  );
}

function stepMeta(step: AdopterStep): { title: string; blurb: string } {
  switch (step) {
    case 'profile-on-file':
      return {
        title: 'Your contact profile',
        blurb: `${JP.org} reads contact info from your ${JP.impactName} home — you don’t fill it in again here.`,
      };
    case 'adopter-type':
      return {
        title: 'Who are you adopting as?',
        blurb: 'This is the only identity-level question specific to ADOPT.',
      };
    case 'wea-on-file':
      return {
        title: 'WEA Statement of Faith',
        blurb: `Required for church / organization / network adopters. ${JP.org} reads it from your ${JP.impactName} home — sign it once, re-use it everywhere.`,
      };
    case 'mou':
      return {
        title: 'Sign the ADOPT Memorandum of Understanding',
        blurb: `Specific to the ${JP.org} program. The document lives in your vault — ${JP.org} receives only the attestation that you signed.`,
      };
    case 'adoption':
      return {
        title: 'Declare your adoption',
        blurb: 'Choose your Frontier People Group and (optionally) ask to be matched with a facilitator.',
      };
  }
}

function StepDoneSummary({ step, impact, record }: { step: AdopterStep; impact: ImpactProfile; record: JpAdopterRecord }) {
  if (step === 'profile-on-file' && impact.contact) {
    const fields = [
      impact.contact.email && 'email',
      impact.contact.phone && 'phone',
      impact.contact.country && 'country',
      impact.contact.city && 'city',
    ].filter(Boolean) as string[];
    return (
      <div style={{ marginTop: '.75rem', fontSize: '.85rem', color: 'var(--c-g600)' }}>
        <span style={{ color: 'var(--c-primary-active)', fontWeight: 700 }}>✓ On file</span> — your vault holds {fields.join(', ')}.
        {' '}{JP.org} sees a “can reach you” flag; the actual values stay in your vault unless you grant a richer scope.
      </div>
    );
  }
  if (step === 'wea-on-file' && impact.attestations.wea) {
    const d = new Date(impact.attestations.wea.signedAt * 1000).toLocaleDateString();
    return (
      <div style={{ marginTop: '.75rem', fontSize: '.85rem', color: 'var(--c-g600)' }}>
        <span style={{ color: 'var(--c-primary-active)', fontWeight: 700 }}>✓ Signed at your home</span> on <b>{d}</b>. {JP.org} holds the attestation only.
      </div>
    );
  }
  if (step === 'adopter-type' && record.adopterType) {
    return (
      <div style={{ marginTop: '.75rem', fontSize: '.85rem', color: 'var(--c-g600)' }}>
        <span style={{ color: 'var(--c-primary-active)', fontWeight: 700 }}>✓</span> Adopting as <b>{ADOPTER_TYPE_LABEL[record.adopterType]}</b>.
      </div>
    );
  }
  if (step === 'mou' && record.attestations.mou) {
    const d = new Date(record.attestations.mou.signedAt * 1000).toLocaleString();
    return (
      <div style={{ marginTop: '.75rem', fontSize: '.85rem', color: 'var(--c-g600)' }}>
        <span style={{ color: 'var(--c-primary-active)', fontWeight: 700 }}>✓ Signed</span> on <b>{d}</b>. Receipt: <code style={{ fontSize: '.78rem' }}>{record.attestations.mou.docHash.slice(0, 18)}…</code>
      </div>
    );
  }
  return null;
}

// ── Step bodies ─────────────────────────────────────────────────────────────

/** Top-of-dashboard banner shown when JP needs profile fields that aren't on file at
 *  Impact yet. The "Complete at your Impact home" button is the seamless handoff —
 *  redirects to `<name>.impact-agent.me/profile?app=demo-jp&return=...&required=...`,
 *  member fills in, redirects back, JP merges the values into the local ImpactProfile. */
function ProfileCompletenessBanner({
  completeness,
  onGoEditProfile,
}: {
  completeness: ReturnType<typeof profileCompleteness>;
  onGoEditProfile: () => void;
}) {
  return (
    <div role="status" style={{
      display: 'flex', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap',
      background: 'linear-gradient(180deg, #fef3c7, #fffbeb)',
      border: '1.5px solid #fcd34d', borderRadius: 16, padding: '1rem 1.25rem',
      marginTop: '1.25rem',
    }}>
      <div aria-hidden="true" style={{
        width: 40, height: 40, borderRadius: 12, background: '#b45309', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, flex: '0 0 auto',
      }}>!</div>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontWeight: 800, color: '#78350f' }}>
          {completeness.missing.length === 1 ? '1 field' : `${completeness.missing.length} fields`} missing from your {JP.impactName} profile
        </div>
        <div style={{ fontSize: '.88rem', color: '#92400e', marginTop: '.2rem' }}>
          {JP.org} needs <b>{completeness.missing.map((f) => f.label).join(', ')}</b>. Add them once at your
          {' '}{JP.impactName} home — re-used across every community app.
        </div>
      </div>
      <button onClick={onGoEditProfile} style={{
        background: '#b45309', color: '#fff', border: 'none',
        padding: '.65rem 1.1rem', borderRadius: 999, fontWeight: 700, fontSize: '.88rem', cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}>
        Complete at my {JP.impactName} home →
      </button>
    </div>
  );
}

/** In-step callout when the profile step is the active one. Same handoff, but with
 *  per-field detail (which fields are missing, why JP needs each one) inline. */
function ProfileMissingCallout({
  impact,
  adopterType,
  onGoEditProfile,
}: {
  impact: ImpactProfile;
  adopterType: AdopterType | undefined;
  onGoEditProfile: (missingKeys: string[]) => void;
}) {
  const missing = impactProfileMissingFields(impact, adopterType);
  const present = jpRequiredFields(adopterType).filter((f) => !missing.some((m) => m.key === f.key));
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', marginBottom: '1rem' }}>
        {present.map((f) => <FieldRow key={f.key} field={f} state="present" />)}
        {missing.map((f) => <FieldRow key={f.key} field={f} state="missing" />)}
      </div>
      <button
        className="btn btn-primary"
        onClick={() => onGoEditProfile(missing.map((f) => f.key))}
        style={{ width: '100%' }}
      >
        <GlobeGlyph size={16} /> Complete profile at my {JP.impactName} home →
      </button>
      <p style={{ marginTop: '.6rem', fontSize: '.78rem', color: 'var(--c-g500)', textAlign: 'center' }}>
        We&apos;ll take you to your home, you fill these in once, and we&apos;ll come straight back to {JP.org}.
      </p>
    </>
  );
}

function FieldRow({ field, state }: { field: JpRequiredField; state: 'present' | 'missing' }) {
  const ok = state === 'present';
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '.6rem',
      background: ok ? 'var(--c-primary-subtle)' : '#fef3c7',
      border: `1px solid ${ok ? 'var(--c-primary-border)' : '#fcd34d'}`,
      borderRadius: 10, padding: '.55rem .8rem',
    }}>
      <span aria-hidden="true" style={{
        flex: '0 0 auto', width: 22, height: 22, borderRadius: 999,
        background: ok ? 'var(--c-primary)' : '#b45309', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '.7rem',
      }}>{ok ? '✓' : '!'}</span>
      <div style={{ flex: 1, fontSize: '.85rem' }}>
        <div style={{ fontWeight: 700, color: 'var(--c-g800)' }}>{field.label}</div>
        <div style={{ color: 'var(--c-g600)', fontSize: '.78rem', marginTop: '.1rem' }}>{field.helperWhy}</div>
      </div>
      {!ok && (
        <span style={{
          fontSize: '.65rem', fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase',
          padding: '.18rem .5rem', borderRadius: 999, background: '#b45309', color: '#fff',
          flex: '0 0 auto',
        }}>missing</span>
      )}
    </div>
  );
}

const ADOPTER_TYPE_LABEL: Record<AdopterType, string> = {
  individual: 'an individual',
  family: 'a family',
  group: 'a small group',
  church: 'a church',
  organization: 'an organization',
  network: 'a network',
};

const ADOPTER_TYPE_OPTIONS: { type: AdopterType; label: string; blurb: string }[] = [
  { type: 'individual', label: 'Individual', blurb: 'You as one person.' },
  { type: 'family', label: 'Family', blurb: 'A household adopting together.' },
  { type: 'group', label: 'Small group', blurb: 'A few people praying together.' },
  { type: 'church', label: 'Church', blurb: 'A local church or congregation.' },
  { type: 'organization', label: 'Organization', blurb: 'A ministry, agency, or other org.' },
  { type: 'network', label: 'Network', blurb: 'A network of churches or orgs.' },
];

function AdopterTypeForm({ record, onSave }: { record: JpAdopterRecord; onSave: (next: JpAdopterRecord) => void }) {
  const [picked, setPicked] = useState<AdopterType | undefined>(record.adopterType);
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '.6rem' }}>
        {ADOPTER_TYPE_OPTIONS.map((o) => {
          const active = picked === o.type;
          return (
            <button
              key={o.type}
              onClick={() => setPicked(o.type)}
              style={{
                textAlign: 'left', padding: '.75rem .9rem', borderRadius: 12, cursor: 'pointer',
                background: active ? 'var(--c-primary-subtle)' : '#fff',
                border: `1.5px solid ${active ? 'var(--c-primary)' : 'var(--c-g200)'}`,
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--c-g900)' }}>{o.label}</div>
              <div style={{ fontSize: '.78rem', color: 'var(--c-g500)', marginTop: '.15rem' }}>{o.blurb}</div>
            </button>
          );
        })}
      </div>
      <button
        className="btn btn-primary"
        disabled={!picked}
        style={{ marginTop: '1rem' }}
        onClick={() => picked && onSave({ ...record, adopterType: picked })}
      >
        Continue
      </button>
    </>
  );
}

function WeaOnFileMissing({ onOpenWea, onGoSignWea }: { onOpenWea: () => void; onGoSignWea: () => void }) {
  return (
    <>
      <p style={{ fontSize: '.88rem', color: 'var(--c-g600)', marginBottom: '.75rem' }}>
        Church, organization, and network adopters affirm the <b>WEA Statement of Faith</b>. Sign once at your{' '}
        {JP.impactName} home — JP gets only the attestation receipt, and every other faith-aligned community app will
        see “✓ on file.”
      </p>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={onGoSignWea} style={{ flex: '1 1 240px' }}>
          <GlobeGlyph size={16} /> Sign WEA at my {JP.impactName} home →
        </button>
        <button className="btn btn-ghost" onClick={onOpenWea} style={{ flex: '0 0 auto' }}>
          Read the statement
        </button>
      </div>
      <p style={{ marginTop: '.6rem', fontSize: '.78rem', color: 'var(--c-g500)' }}>
        We&apos;ll take you to your home to read &amp; affirm the statement, then send you straight back to {JP.org}.
      </p>
    </>
  );
}

/** Sign the ADOPT MOU. Decoupled from the record shape so it can be reused by the
 *  adopter and facilitator flows — both stick the attestation in `record.attestations.mou`,
 *  the caller wires that into its own record update. */
function MouSignForm({ session, onSign }: { session: Session; onSign: (att: Attestation) => void }) {
  const [agreed, setAgreed] = useState(false);
  const [signing, setSigning] = useState(false);

  const sign = async () => {
    setSigning(true);
    try {
      // Bind the attestation to the active JP delegation — revoking the delegation at the
      // member's home voids the consent the receipt rode in on (ADR-0019). For the demo we
      // use the session token as the consent-binding seed (it identifies the active grant);
      // in production this is the actual ERC-7710 delegation hash.
      const att = await attestDocConsentBound({
        docId: MOU_DOC_ID,
        docText: MOU_TEXT,
        delegationJson: { sub: session.token.slice(0, 32) },
      });
      onSign(att);
    } finally {
      setSigning(false);
    }
  };

  return (
    <>
      <div style={{
        background: '#fff', border: '1px solid var(--c-g200)', borderRadius: 12, padding: '1rem 1.25rem',
        maxHeight: 280, overflow: 'auto', fontSize: '.85rem', lineHeight: 1.55, color: 'var(--c-g700)', whiteSpace: 'pre-wrap',
      }}>
        {MOU_TEXT}
      </div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '.6rem', marginTop: '1rem', fontSize: '.9rem', color: 'var(--c-g700)' }}>
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: '.25rem' }} />
        <span>I have read the ADOPT MOU and commit to its terms. I understand the document is held in my {JP.impactName} vault and {JP.org} receives only the attestation that I signed.</span>
      </label>
      <button
        className="btn btn-primary"
        disabled={!agreed || signing}
        style={{ marginTop: '1rem' }}
        onClick={() => void sign()}
      >
        {signing ? 'Signing with your home…' : <><ShieldIcon /> Sign with my {JP.impactName} home</>}
      </button>
    </>
  );
}

function DeclareAdoptionForm({
  impact,
  record,
  canDeclare,
  onSave,
  onGoEditProfile,
  onGoSignWea,
}: {
  impact: ImpactProfile;
  record: JpAdopterRecord;
  canDeclare: boolean;
  onSave: (next: JpAdopterRecord) => void;
  onGoEditProfile: (missingKeys: string[]) => void;
  onGoSignWea: () => void;
}) {
  const [picked, setPicked] = useState<string | undefined>(record.adoption?.peopleGroupId);
  const [requestFacilitator, setRequestFacilitator] = useState<boolean>(record.adoption?.requestFacilitator ?? true);
  const [declaring, setDeclaring] = useState(false);
  const pg = picked ? findPeopleGroup(picked) : undefined;
  const missingFields = useMemo(() => impactProfileMissingFields(impact, record.adopterType), [impact, record.adopterType]);
  const missingType = !record.adopterType;
  const missingWea = requiresWea(record) && !impact.attestations.wea;
  const missingMou = !record.attestations.mou;

  const declare = () => {
    if (!pg || !canDeclare) return;
    setDeclaring(true);
    onSave({
      ...record,
      adoption: {
        peopleGroupId: pg.id,
        peopleGroupName: pg.name,
        declaredAt: Math.floor(Date.now() / 1000),
        requestFacilitator,
      },
    });
  };

  return (
    <>
      <p style={{ fontSize: '.88rem', color: 'var(--c-g600)' }}>
        Pick a Frontier People Group to commit to. (Demo seed of 10 well-known FPGs; the live list
        comes from {JP.org} in a later phase.)
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '.6rem', marginTop: '.75rem' }}>
        {FPG_SEED.map((g) => <FpgCard key={g.id} g={g} active={picked === g.id} onPick={() => setPicked(g.id)} />)}
      </div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '.6rem', marginTop: '1.25rem', fontSize: '.9rem', color: 'var(--c-g700)' }}>
        <input type="checkbox" checked={requestFacilitator} onChange={(e) => setRequestFacilitator(e.target.checked)} style={{ marginTop: '.25rem' }} />
        <span>Match me with a facilitator already serving this people group, when one is available.</span>
      </label>

      {!canDeclare && (
        <div style={{
          marginTop: '1.25rem', background: '#fef2f2', border: '1.5px solid #fecaca',
          borderRadius: 14, padding: '1rem 1.25rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.55rem', marginBottom: '.6rem' }}>
            <span aria-hidden="true" style={{
              width: 26, height: 26, borderRadius: 999, background: '#dc2626', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: '.85rem',
            }}>!</span>
            <div style={{ fontWeight: 800, color: '#991b1b' }}>Before {JP.org} can take your declaration:</div>
          </div>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#7f1d1d', fontSize: '.88rem', lineHeight: 1.65 }}>
            {missingFields.map((f) => (
              <li key={f.key}>
                Add <b>{f.label}</b> to your {JP.impactName} profile — <span style={{ color: '#991b1b' }}>{f.helperWhy}</span>
              </li>
            ))}
            {missingType && <li>Choose who you’re adopting as (above).</li>}
            {missingWea && <li>Sign the WEA Statement of Faith at your {JP.impactName} home (required for {ADOPTER_TYPE_LABEL[record.adopterType!] ?? 'your adopter type'}).</li>}
            {missingMou && <li>Sign the ADOPT MOU (above).</li>}
          </ul>
          <div style={{ marginTop: '.85rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            {missingFields.length > 0 && (
              <button
                onClick={() => onGoEditProfile(missingFields.map((f) => f.key))}
                style={{
                  background: '#dc2626', color: '#fff', border: 'none',
                  padding: '.6rem 1rem', borderRadius: 999, fontWeight: 700, fontSize: '.88rem', cursor: 'pointer',
                }}
              >
                Complete profile at my {JP.impactName} home →
              </button>
            )}
            {missingWea && (
              <button
                onClick={onGoSignWea}
                style={{
                  background: '#dc2626', color: '#fff', border: 'none',
                  padding: '.6rem 1rem', borderRadius: 999, fontWeight: 700, fontSize: '.88rem', cursor: 'pointer',
                }}
              >
                Sign WEA at my {JP.impactName} home →
              </button>
            )}
          </div>
        </div>
      )}

      <button
        className="btn btn-primary"
        disabled={!picked || declaring || !canDeclare}
        style={{ marginTop: '1rem' }}
        onClick={declare}
        title={!canDeclare ? `Resolve the missing items above before declaring.` : undefined}
      >
        {declaring ? 'Declaring…' : `Declare adoption of ${pg ? pg.name : '…'}`}
      </button>
    </>
  );
}

function FpgCard({ g, active, onPick }: { g: PeopleGroup; active: boolean; onPick: () => void }) {
  return (
    <button
      onClick={onPick}
      style={{
        textAlign: 'left', padding: '.85rem 1rem', borderRadius: 12, cursor: 'pointer',
        background: active ? 'var(--c-primary-subtle)' : '#fff',
        border: `1.5px solid ${active ? 'var(--c-primary)' : 'var(--c-g200)'}`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '.5rem' }}>
        <div style={{ fontWeight: 700, color: 'var(--c-g900)' }}>{g.name}</div>
        <div style={{ fontSize: '.72rem', color: 'var(--c-g500)', fontWeight: 600 }}>{formatPopulation(g.populationApprox)}</div>
      </div>
      <div style={{ fontSize: '.78rem', color: 'var(--c-g500)', marginTop: '.2rem' }}>{g.country} · {g.region}</div>
      <div style={{ fontSize: '.74rem', color: 'var(--c-g400)', marginTop: '.15rem' }}>{g.religion}</div>
    </button>
  );
}

// ── Completion: adoption summary + JP projection ────────────────────────────

function AdoptionSummary({ session, record, impact }: { session: Session; record: JpAdopterRecord; impact: ImpactProfile }) {
  const pg = record.adoption ? findPeopleGroup(record.adoption.peopleGroupId) : undefined;
  const homeUrl = personalAuthOrigin(nameLabel(session.name));
  const displayName = displayNameFromImpact(impact, session.name);
  // If the adopter asked to be matched, look up facilitators serving this FPG with capacity
  // for this adopter type. The match runs over `MatchedFacilitator` (the released scoped
  // projection), not the raw seed data — same surface the production broker would expose.
  // JP brokers the match from its vault pool (spec 247) — an async read, so resolve
  // into state. Pass the viewer's own address so their own facilitator persona (if
  // any) is included (same-browser dual-persona case).
  const [facilitators, setFacilitators] = useState<MatchedFacilitator[]>([]);
  useEffect(() => {
    if (!record.adoption || !record.adopterType || !record.adoption.requestFacilitator) {
      setFacilitators([]);
      return;
    }
    let cancelled = false;
    void matchFacilitatorsForAdopter(record.adoption, record.adopterType, session.address)
      .then((f) => { if (!cancelled) setFacilitators(f); })
      .catch(() => { if (!cancelled) setFacilitators([]); });
    return () => { cancelled = true; };
  }, [record.adoption, record.adopterType, session.address]);
  return (
    <>
      <section className="hero" style={{ padding: '3rem 0 2rem' }}>
        <div className="wrap">
          <div className="eyebrow" style={{ color: 'var(--c-primary)' }}>✓ Adoption declared</div>
          <h1 style={{ marginTop: '.5rem', fontSize: 'clamp(1.6rem, 4vw, 2.4rem)' }}>
            {displayName}, you’ve adopted <span style={{ color: 'var(--c-primary)' }}>{pg?.name ?? 'a Frontier People Group'}</span>.
          </h1>
          {pg && (
            <p className="hero-sub" style={{ fontSize: '1rem' }}>
              {pg.country} · ~{formatPopulation(pg.populationApprox)} people · {pg.religion}.
              {record.adoption?.requestFacilitator ? ' We’ll match you with a facilitator when one’s available.' : ''}
            </p>
          )}
        </div>
      </section>

      <section className="section wrap" style={{ paddingTop: 0 }}>
        <div className="agreements" style={{ gridTemplateColumns: '1fr', gap: '.875rem' }}>
          <div className="agreement">
            <h3>What now</h3>
            <p style={{ color: 'var(--c-g600)' }}>
              The ADOPT path is a long walk — Pray, learn, partner. {JP.org} will send you quarterly
              prayer updates and, when matched, introductions from facilitators on the field.
              These ride over the scoped delegation you granted at sign-in.
            </p>
          </div>
          <div className="agreement" style={{ background: '#fff' }}>
            <h3>Where everything lives</h3>
            <p style={{ color: 'var(--c-g600)' }}>
              The ADOPT MOU you signed is in your {JP.impactName} vault at{' '}
              <a href={homeUrl} target="_blank" rel="noopener noreferrer"><b>{homeUrl}</b></a>.
              Your contact info + WEA stay there too. {JP.org} only holds the attestations + your public
              adoption declaration — revisit and revoke any time from your home.
            </p>
          </div>
        </div>
      </section>

      <MatchedFacilitatorsPanel
        facilitators={facilitators}
        sharedPgId={record.adoption?.peopleGroupId}
        requestedMatch={!!record.adoption?.requestFacilitator}
        homeUrl={homeUrl}
        grant={session.grant}
      />

      <JpProjectionPanel impact={impact} record={record} session={session} />
    </>
  );
}

function MatchedFacilitatorsPanel({
  facilitators,
  sharedPgId,
  requestedMatch,
  homeUrl,
  grant,
}: {
  facilitators: MatchedFacilitator[];
  sharedPgId: string | undefined;
  requestedMatch: boolean;
  homeUrl: string;
  grant: DelegationWire | undefined;
}) {
  if (!requestedMatch) {
    return (
      <section className="section wrap" style={{ paddingTop: 0 }}>
        <div className="agreement" style={{ background: '#fff' }}>
          <h3>You opted out of facilitator matching</h3>
          <p style={{ color: 'var(--c-g600)' }}>
            That&apos;s fine — you can still adopt, pray, and report. Want to change your mind later?
            Revisit your adoption from your <a href={homeUrl} target="_blank" rel="noopener noreferrer">{JP.impactName} home</a>.
          </p>
        </div>
      </section>
    );
  }
  if (facilitators.length === 0) {
    return (
      <section className="section wrap" style={{ paddingTop: 0 }}>
        <div className="agreement" style={{ background: '#fff' }}>
          <h3>No facilitator match yet</h3>
          <p style={{ color: 'var(--c-g600)' }}>
            No facilitator in JP&apos;s network currently covers this people group with capacity for your adopter type.
            JP will introduce you when one declares coverage that fits.
          </p>
        </div>
      </section>
    );
  }
  return (
    <section className="section wrap" style={{ paddingTop: 0 }}>
      <div className="sec-head">
        <div className="eyebrow">JP introduced you to</div>
        <h2>{facilitators.length === 1 ? 'Your facilitator' : `Your facilitators (${facilitators.length})`}</h2>
        <p>
          Matched on your declared people group + adopter type. JP released a small scoped slice to you (and to them) —
          your vaults stay sealed. Revoke at your home to end the match.
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.25rem' }}>
        {facilitators.map((f) => (
          <MatchedFacilitatorCard key={f.id} f={f} sharedPgId={sharedPgId} grant={grant} />
        ))}
      </div>
      <DisclosureManifest
        title="What JP released to you by default"
        released={DISCLOSURE_FACILITATOR_TO_ADOPTER.released}
        notReleased={DISCLOSURE_FACILITATOR_TO_ADOPTER.notReleased}
        upgradeNote="Contact-exchange (last name + email + phone) is a richer scope granted on mutual consent. Request it on any card above — when both sides accept, JP releases the additional fields."
      />
    </section>
  );
}

function MatchedFacilitatorCard({ f, sharedPgId, grant }: { f: MatchedFacilitator; sharedPgId: string | undefined; grant: DelegationWire | undefined }) {
  const shared = sharedPgId ? findPeopleGroup(sharedPgId) : undefined;
  const otherGroups = f.peopleGroupIds
    .filter((id) => id !== sharedPgId)
    .map(findPeopleGroup)
    .filter((g): g is NonNullable<typeof g> => !!g);
  return (
    <div className="agreement" style={{ background: '#fff', borderColor: 'var(--c-primary-border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '.75rem', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
            {f.orgName}
            {f.isSelf && <SelfBadge />}
          </h3>
          <div style={{ fontSize: '.78rem', color: 'var(--c-g500)', marginTop: '.15rem' }}>
            {f.orgCountry} · partner: <b>{f.facilitatorFirstName} {f.facilitatorLastInitial}</b>
          </div>
        </div>
        <span style={{
          fontSize: '.72rem', fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase',
          padding: '.25rem .6rem', borderRadius: 999,
          background: 'var(--c-primary)', color: '#fff',
        }}>JP match</span>
      </div>

      {shared && (
        <div style={{
          marginTop: '.85rem', padding: '.65rem .8rem', borderRadius: 10,
          background: 'var(--c-primary-subtle)', border: '1px solid var(--c-primary-border)',
          fontSize: '.88rem', color: 'var(--c-primary-active)', fontWeight: 600,
        }}>
          ✓ Both of you are committed to <b>{shared.name}</b> ({shared.country})
        </div>
      )}

      <div style={{ marginTop: '1rem' }}>
        <div style={{ fontSize: '.72rem', fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--c-g500)' }}>Ministry areas</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem', marginTop: '.35rem' }}>
          {f.capacity.ministryAreas.map((a) => (
            <span key={a} style={{
              fontSize: '.74rem', fontWeight: 700, padding: '.2rem .55rem', borderRadius: 999,
              background: 'var(--c-g100)', color: 'var(--c-g700)', border: '1px solid var(--c-g200)',
            }}>{MINISTRY_AREA_LABEL[a]}</span>
          ))}
        </div>
      </div>

      {otherGroups.length > 0 && (
        <div style={{ marginTop: '.85rem', fontSize: '.78rem', color: 'var(--c-g500)' }}>
          Also serves: {otherGroups.slice(0, 4).map((g) => g.name).join(', ')}
          {otherGroups.length > 4 ? `, +${otherGroups.length - 4} more` : ''}
        </div>
      )}

      {f.description && (
        <div style={{
          marginTop: '.85rem', padding: '.7rem .85rem', borderRadius: 10,
          background: 'var(--c-g50)', border: '1px solid var(--c-g200)',
          fontSize: '.88rem', color: 'var(--c-g700)', lineHeight: 1.5,
        }}>
          <div style={{ fontSize: '.7rem', fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--c-g500)', marginBottom: '.25rem' }}>How they engage</div>
          {f.description}
        </div>
      )}

      {sharedPgId && <UpdatesFromFacilitator facilitatorId={f.id} peopleGroupId={sharedPgId} viewerGrant={grant} />}

      <ContactExchangeWidget
        grant={grant}
        matchId={f.id}
        partyLabel={`${f.facilitatorFirstName} at ${f.orgName}`}
        firstName={f.facilitatorFirstName}
        lastName={f.exchangeLastName}
        email={f.exchangeEmail}
        phone={f.exchangePhone}
      />
    </div>
  );
}

/** The handshake widget — appears on every match card on both dashboards. Initial
 *  state shows a presence flag + a Request button; clicking simulates the other
 *  side's consent (seeded counter-parties are pre-opted-in) → reveals last name +
 *  email + phone with a "scope upgrade" note. The consent fact is persisted in
 *  the member's own localStorage so the exchange survives navigation + refresh. */
function ContactExchangeWidget({
  grant,
  matchId,
  partyLabel,
  firstName,
  lastName,
  email,
  phone,
}: {
  grant: DelegationWire | undefined;
  matchId: string;
  partyLabel: string;
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
}) {
  const [exchanged, setExchanged] = useState<boolean>(false);
  const [requesting, setRequesting] = useState(false);

  // Contact-exchange consent lives in the member's own vault (spec 247), read
  // through the member's grant; resolve on mount.
  useEffect(() => {
    if (!grant) return;
    let cancelled = false;
    void loadContactExchanges(grant).then((list) => { if (!cancelled) setExchanged(list.includes(matchId)); });
    return () => { cancelled = true; };
  }, [grant, matchId]);

  const request = useCallback(() => {
    if (!grant) return;
    setRequesting(true);
    // Brief delay sells the "awaiting their consent" beat for the demo. Seeded
    // counter-parties are pre-opted-in, so it always resolves to accepted.
    window.setTimeout(() => {
      void (async () => {
        await recordContactExchange(grant, matchId);
        setExchanged(true);
        setRequesting(false);
      })();
    }, 700);
  }, [grant, matchId]);

  if (exchanged) {
    return (
      <div style={{
        marginTop: '.95rem', borderRadius: 12,
        background: 'linear-gradient(180deg, #ecfdf5, #fff)',
        border: '1px solid #6ee7b7', padding: '.85rem 1rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
          <span style={{
            fontSize: '.66rem', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase',
            padding: '.18rem .55rem', borderRadius: 999,
            background: '#059669', color: '#fff',
          }}>✓ Scope upgrade</span>
          <span style={{ fontSize: '.82rem', color: '#065f46', fontWeight: 700 }}>
            Contact exchanged — both sides consented
          </span>
        </div>
        <div style={{ marginTop: '.65rem', display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: '.85rem', rowGap: '.3rem', fontSize: '.88rem' }}>
          {lastName && (<>
            <span style={dlKey}>Name</span>
            <span style={dlVal}><b>{firstName} {lastName}</b></span>
          </>)}
          {email && (<>
            <span style={dlKey}>Email</span>
            <span style={dlVal}>
              <a href={`mailto:${email}`} style={{ color: 'var(--c-primary)', textDecoration: 'none' }}>{email}</a>
            </span>
          </>)}
          {phone && (<>
            <span style={dlKey}>Phone</span>
            <span style={dlVal}>{phone}</span>
          </>)}
        </div>
        <div style={{ marginTop: '.6rem', fontSize: '.72rem', color: '#065f46' }}>
          JP released last name + email + phone to you because both sides consented.
          Revoke at your home to withdraw the upgrade.
        </div>
      </div>
    );
  }
  return (
    <div style={{
      marginTop: '.95rem', borderRadius: 12,
      background: 'var(--c-g50)', border: '1px solid var(--c-g200)', padding: '.85rem 1rem',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: '.82rem', color: 'var(--c-g700)', fontWeight: 700 }}>
            Contact channel: ✓ Reachable
          </div>
          <div style={{ fontSize: '.76rem', color: 'var(--c-g500)', marginTop: '.15rem' }}>
            No email / phone released until both sides consent.
          </div>
        </div>
        <button
          onClick={request}
          disabled={requesting}
          style={{
            background: 'var(--c-primary)', color: '#fff', border: 'none',
            padding: '.55rem .95rem', borderRadius: 999, fontWeight: 700, fontSize: '.82rem', cursor: requesting ? 'progress' : 'pointer',
            flex: '0 0 auto', whiteSpace: 'nowrap',
            opacity: requesting ? 0.85 : 1,
          }}
          title={`Ask ${partyLabel} for a contact exchange. When they consent, JP releases each other's email + phone.`}
        >
          {requesting ? 'Awaiting their consent…' : 'Request contact exchange'}
        </button>
      </div>
    </div>
  );
}

const dlKey: React.CSSProperties = {
  fontSize: '.7rem', fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase',
  color: 'var(--c-g500)', alignSelf: 'center',
};
const dlVal: React.CSSProperties = { color: 'var(--c-g800)', alignSelf: 'center' };

/** Quarterly updates from a matched facilitator about a specific FPG. Each
 *  update flows via the introduction's existing scoped delegation (no new
 *  scope required). Most-recent first; the latest expands inline, older ones
 *  collapse behind a "show all" toggle. */
function UpdatesFromFacilitator({ facilitatorId, peopleGroupId, viewerGrant }: { facilitatorId: string; peopleGroupId: string; viewerGrant: DelegationWire | undefined }) {
  const [updates, setUpdates] = useState<MatchedFacilitatorUpdate[]>([]);
  useEffect(() => {
    let cancelled = false;
    void updatesForAdopter(facilitatorId, peopleGroupId, viewerGrant)
      .then((u) => { if (!cancelled) setUpdates(u); });
    return () => { cancelled = true; };
  }, [facilitatorId, peopleGroupId, viewerGrant]);
  const [showAll, setShowAll] = useState(false);
  if (updates.length === 0) return null;
  const head = updates[0]!;
  const rest = updates.slice(1);
  return (
    <div style={{
      marginTop: '.95rem', borderRadius: 12, overflow: 'hidden',
      border: '1px solid var(--c-primary-border)',
      background: 'linear-gradient(180deg, var(--c-primary-subtle), #fff 70%)',
    }}>
      <div style={{ padding: '.7rem 1rem', borderBottom: '1px solid var(--c-primary-border)', display: 'flex', alignItems: 'center', gap: '.55rem', flexWrap: 'wrap' }}>
        <span style={{
          fontSize: '.66rem', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase',
          padding: '.18rem .55rem', borderRadius: 999,
          background: 'var(--c-primary)', color: '#fff',
        }}>Updates</span>
        <span style={{ fontSize: '.8rem', color: 'var(--c-primary-active)', fontWeight: 700 }}>
          {updates.length === 1 ? '1 update' : `${updates.length} updates`} from this facilitator about your people group
        </span>
      </div>
      <UpdateItem u={head} />
      {showAll && rest.map((u) => <UpdateItem key={u.id} u={u} />)}
      {rest.length > 0 && (
        <div style={{ padding: '.5rem 1rem', borderTop: '1px solid var(--c-g200)' }}>
          <button
            onClick={() => setShowAll((s) => !s)}
            style={{
              background: 'none', border: 'none', color: 'var(--c-primary)', fontWeight: 700,
              cursor: 'pointer', padding: 0, fontSize: '.82rem',
            }}
          >
            {showAll ? 'Hide older updates' : `Show ${rest.length} older update${rest.length === 1 ? '' : 's'} →`}
          </button>
        </div>
      )}
    </div>
  );
}

function UpdateItem({ u }: { u: MatchedFacilitatorUpdate }) {
  const date = new Date(u.publishedAt * 1000).toLocaleDateString();
  return (
    <div style={{ padding: '.85rem 1rem', borderBottom: '1px solid var(--c-g100)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '.5rem', flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700, color: 'var(--c-g900)', fontSize: '.95rem' }}>{u.title}</div>
        <span style={{ fontSize: '.74rem', color: 'var(--c-g500)' }}>{date}</span>
      </div>
      <p style={{ marginTop: '.35rem', fontSize: '.86rem', color: 'var(--c-g700)', lineHeight: 1.55 }}>{u.body}</p>
    </div>
  );
}

function DisclosureManifest({
  title,
  released,
  notReleased,
  upgradeNote,
}: {
  title: string;
  released: string[];
  notReleased: string[];
  /** Optional footer note — used to point at the contact-exchange handshake as
   *  a route from "held back" to "released by mutual consent". */
  upgradeNote?: string;
}) {
  return (
    <div style={{
      marginTop: '1.25rem', borderRadius: 14, overflow: 'hidden',
      border: '1px solid var(--c-g200)', background: 'var(--c-g50)',
    }}>
      <div style={{ padding: '.85rem 1.1rem', borderBottom: '1px solid var(--c-g200)', background: '#fff' }}>
        <div style={{ fontSize: '.72rem', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--c-primary)' }}>
          Scoped delegation
        </div>
        <div style={{ fontWeight: 700, color: 'var(--c-g900)', marginTop: '.2rem', fontSize: '.95rem' }}>{title}</div>
      </div>
      <div style={{ padding: '.85rem 1.1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div>
          <div style={{ fontSize: '.72rem', fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: '#166534', marginBottom: '.35rem' }}>
            ✓ Released
          </div>
          <ul style={disclosureListStyle}>
            {released.map((r) => <li key={r} style={{ color: 'var(--c-g700)' }}>{r}</li>)}
          </ul>
        </div>
        <div>
          <div style={{ fontSize: '.72rem', fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: '#92400e', marginBottom: '.35rem' }}>
            ✗ Held back
          </div>
          <ul style={disclosureListStyle}>
            {notReleased.map((r) => <li key={r} style={{ color: 'var(--c-g700)' }}>{r}</li>)}
          </ul>
        </div>
      </div>
      {upgradeNote && (
        <div style={{
          padding: '.7rem 1.1rem', borderTop: '1px solid var(--c-g200)',
          background: '#fff', fontSize: '.78rem', color: 'var(--c-g600)',
          display: 'flex', alignItems: 'flex-start', gap: '.5rem',
        }}>
          <span aria-hidden="true" style={{ flex: '0 0 auto', color: 'var(--c-primary)', fontWeight: 800 }}>↗</span>
          <span>{upgradeNote}</span>
        </div>
      )}
    </div>
  );
}

const disclosureListStyle: React.CSSProperties = {
  margin: 0, paddingLeft: '1.1rem', fontSize: '.8rem', lineHeight: 1.6,
};

function JpProjectionPanel({ impact, record, session }: { impact: ImpactProfile; record: JpAdopterRecord; session: Session }) {
  const projection = useMemo(() => projectForJp(impact, record), [impact, record]);
  const homeUrl = personalAuthOrigin(nameLabel(session.name));
  return (
    <section className="section wrap" style={{ paddingTop: 0 }}>
      <div className="trust">
        <div className="eyebrow" style={{ color: 'var(--c-primary-mid)' }}>What JP can see</div>
        <h2 style={{ fontSize: '1.5rem', maxWidth: '42ch' }}>This is everything {JP.org} holds about you. Compare it to your vault — much smaller.</h2>
        <div style={{ marginTop: '1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          <ProjBox label="Contact channel" value={projection.hasContact ? '✓ Can reach you (flag only)' : '— none'} />
          <ProjBox label="Adopter type" value={projection.adopterType ? ADOPTER_TYPE_LABEL[projection.adopterType] : '—'} />
          <ProjBox label="ADOPT MOU receipt" value={projection.attestations.mou ? `✓ ${projection.attestations.mou.docHash.slice(0, 16)}…` : '—'} mono />
          <ProjBox label="WEA receipt" value={projection.attestations.wea ? `✓ ${projection.attestations.wea.docHash.slice(0, 16)}…` : '— (not required)'} mono />
          <ProjBox label="Public adoption" value={projection.adoption ? `✓ ${projection.adoption.peopleGroupName}` : '—'} />
          <ProjBox label="Wants facilitator match" value={projection.adoption ? (projection.adoption.requestFacilitator ? 'Yes' : 'No') : '—'} />
        </div>
        <p style={{ marginTop: '1.5rem', fontSize: '.85rem', color: '#94a3b8' }}>
          Revoke at your home <a href={homeUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c-primary-mid)' }}>{homeUrl}</a> and this projection goes empty —
          your vault stays intact, JP just stops seeing it.
        </p>
      </div>
    </section>
  );
}

function ProjBox({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: '.8rem 1rem' }}>
      <div style={{ fontSize: '.7rem', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#94a3b8' }}>{label}</div>
      <div style={{ marginTop: '.35rem', color: '#e2e8f0', fontSize: '.92rem', fontFamily: mono ? "'SF Mono','Roboto Mono',monospace" : undefined }}>{value}</div>
    </div>
  );
}

// ── Facilitator Intranet (placeholder, wired next) ──────────────────────────

function FacilitatorIntranet({ session, org, onCreateOrg, onSignOut, onOpenWea, onGoEditProfile, onGoSignWea }: {
  session: Session; org: RelatedOrgLink | null; onCreateOrg: (orgName: string) => void;
  onSignOut: () => void; onOpenWea: () => void;
  onGoEditProfile: (missingKeys: string[]) => void;
  onGoSignWea: () => void;
}) {
  const [impact, setImpact] = useState<ImpactProfile>({ v: 1, attestations: {} });
  const [record, setRecord] = useState<JpFacilitatorRecord>({ v: 1, attestations: {} });
  // Profile + JP facilitator record live in the member's own vault (spec 247), read
  // through the member's grant; load on mount.
  useEffect(() => {
    const grant = session.grant;
    if (!grant) return;
    let cancelled = false;
    void (async () => {
      const [i, r] = await Promise.all([loadImpactProfile(grant), loadJpFacilitatorRecord(grant)]);
      if (!cancelled) { setImpact(i); setRecord(r); }
    })();
    return () => { cancelled = true; };
  }, [session.grant]);
  const update = useCallback((next: JpFacilitatorRecord) => {
    if (session.grant) void saveJpFacilitatorRecord(session.grant, next);
    setRecord(next);
  }, [session.grant]);

  const steps = useMemo(() => facilitatorSteps(impact, record), [impact, record]);
  const activeStep = useMemo(() => nextFacilitatorStep(impact, record), [impact, record]);
  const complete = useMemo(() => isFacilitatorOnboardingComplete(impact, record), [impact, record]);
  const completeness = useMemo(() => profileCompleteness(impact, FACILITATOR_PROFILE_TYPE), [impact]);
  const canDeclare = useMemo(() => canDeclareCoverage(impact, record), [impact, record]);

  const displayName = displayNameFromImpact(impact, session.name);
  const homeUrl = personalAuthOrigin(nameLabel(session.name));

  return (
    <>
      <IntranetTopbar session={session} subtitle="Facilitator dashboard" onSignOut={onSignOut} impact={impact} />
      <HeaderAlerts
        impact={impact}
        adopterType={FACILITATOR_PROFILE_TYPE}
        onGoEditProfile={onGoEditProfile}
      />
      {session.fresh && (
        <div style={{ background: 'var(--c-primary-subtle)', borderBottom: '1px solid var(--c-primary-border)', padding: '.75rem 1.25rem', textAlign: 'center', fontSize: '.9rem', color: 'var(--c-primary-active)' }}>
          ✓ Connected via {JP.impactName} — welcome, <b>{displayName}</b>. Your home + vault are at{' '}
          <a href={homeUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c-primary)' }}>{homeUrl}</a>.
        </div>
      )}

      <MemberOrgSection kind="facilitator" org={org} onCreateOrg={onCreateOrg} />

      {complete ? (
        <FacilitatorSummary session={session} record={record} impact={impact} onUpdate={update} />
      ) : (
        <>
          <section className="hero" style={{ padding: '3rem 0 2rem' }}>
            <div className="wrap">
              <div className="eyebrow">{JP.paths.facilitator.who}</div>
              <h1 style={{ marginTop: '.5rem', fontSize: 'clamp(1.6rem, 4vw, 2.4rem)' }}>{JP.paths.facilitator.title}</h1>
              <p className="hero-sub" style={{ fontSize: '1rem' }}>
                {JP.org} runs the program; {JP.impactName} holds your data + signed agreements. We&apos;re only asking
                you for what JP needs that isn&apos;t already on file with your home.
              </p>
            </div>
          </section>

          <section className="section wrap" style={{ paddingTop: 0 }}>
            <div className="sec-head">
              <div className="eyebrow">Facilitator onboarding</div>
              <h2>{completeness.missing.length === 0 ? 'Sign + declare your coverage — your home holds the rest' : `${JP.org} needs a few things from your ${JP.impactName} profile`}</h2>
            </div>
            {completeness.missing.length > 0 && (
              <ProfileCompletenessBanner
                completeness={completeness}
                onGoEditProfile={() => onGoEditProfile(completeness.missing.map((f) => f.key))}
              />
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.875rem', marginTop: '1.5rem' }}>
              {steps.map((s, i) => (
                <FacilitatorStepCard
                  key={s.step}
                  n={i + 1}
                  step={s.step}
                  ownedBy={s.ownedBy}
                  active={s.step === activeStep}
                  satisfied={s.satisfied}
                  impact={impact}
                  record={record}
                  session={session}
                  canDeclare={canDeclare}
                  onUpdate={update}
                  onOpenWea={onOpenWea}
                  onGoEditProfile={onGoEditProfile}
                  onGoSignWea={onGoSignWea}
                />
              ))}
            </div>
          </section>

          <FacilitatorProjectionPanel impact={impact} record={record} session={session} />
        </>
      )}

      <IntranetFooter />
    </>
  );
}

// ── Facilitator step card ───────────────────────────────────────────────────
// Mirrors StepCard but for the facilitator record shape (different attestations slot
// + a coverage declaration instead of an adoption). Kept separate from StepCard so
// each path's step-list stays a strict literal union and the type-narrowing in
// stepMeta / step bodies is clean.

function FacilitatorStepCard({
  n, step, ownedBy, active, satisfied, impact, record, session, canDeclare, onUpdate, onOpenWea, onGoEditProfile, onGoSignWea,
}: {
  n: number; step: FacilitatorStep; ownedBy: 'impact' | 'jp'; active: boolean; satisfied: boolean;
  impact: ImpactProfile; record: JpFacilitatorRecord; session: Session; canDeclare: boolean;
  onUpdate: (next: JpFacilitatorRecord) => void; onOpenWea: () => void;
  onGoEditProfile: (missingKeys: string[]) => void;
  onGoSignWea: () => void;
}) {
  const meta = facilitatorStepMeta(step);
  const status: 'done' | 'active' | 'pending' = satisfied ? 'done' : active ? 'active' : 'pending';
  return (
    <div className="agreement" style={{
      display: 'flex', gap: '1rem', alignItems: 'flex-start',
      borderColor: status === 'active' ? 'var(--c-primary-border)' : 'var(--c-g200)',
      background: status === 'active' ? 'linear-gradient(180deg, var(--c-primary-subtle) 0%, #fff 60%)' : 'var(--c-g50)',
      opacity: status === 'pending' ? .55 : 1,
    }}>
      <div style={{
        flex: '0 0 auto', width: 36, height: 36, borderRadius: 999,
        background: status === 'done' || status === 'active' ? 'var(--c-primary)' : 'var(--c-g200)',
        color: status === 'done' || status === 'active' ? '#fff' : 'var(--c-g600)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '.9rem',
      }}>{status === 'done' ? '✓' : n}</div>
      <div style={{ flex: 1 }}>
        <h3 style={{ fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
          {meta.title}
          <OwnedByPill ownedBy={ownedBy} />
        </h3>
        <p style={{ color: 'var(--c-g600)', fontSize: '.9rem', marginTop: '.25rem' }}>{meta.blurb}</p>
        {status === 'done' && (
          <FacilitatorStepDoneSummary step={step} impact={impact} record={record} />
        )}
        {status === 'active' && (
          <div style={{ marginTop: '1rem' }}>
            {step === 'profile-on-file' && (
              <ProfileMissingCallout
                impact={impact}
                adopterType={FACILITATOR_PROFILE_TYPE}
                onGoEditProfile={onGoEditProfile}
              />
            )}
            {step === 'wea-on-file' && <WeaOnFileMissing onOpenWea={onOpenWea} onGoSignWea={onGoSignWea} />}
            {step === 'mou' && (
              <MouSignForm
                session={session}
                onSign={(att) => onUpdate({ ...record, attestations: { ...record.attestations, mou: att } })}
              />
            )}
            {step === 'coverage' && (
              <CoverageDeclareForm
                impact={impact}
                record={record}
                canDeclare={canDeclare}
                onSave={onUpdate}
                onGoEditProfile={onGoEditProfile}
                onGoSignWea={onGoSignWea}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function facilitatorStepMeta(step: FacilitatorStep): { title: string; blurb: string } {
  switch (step) {
    case 'profile-on-file':
      return {
        title: 'Your organization + contact profile',
        blurb: `${JP.org} reads your name, contact info, and organization details from your ${JP.impactName} home — you don't fill them in again here.`,
      };
    case 'wea-on-file':
      return {
        title: 'WEA Statement of Faith',
        blurb: `Required for facilitators as a named signatory. ${JP.org} reads it from your ${JP.impactName} home — sign once, re-use everywhere.`,
      };
    case 'mou':
      return {
        title: 'Sign the ADOPT Memorandum of Understanding',
        blurb: `The same MOU adopters sign — the document lives in your vault, ${JP.org} receives only the attestation.`,
      };
    case 'coverage':
      return {
        title: 'Declare your coverage + capacity',
        blurb: 'Which Frontier People Groups you serve, and the shape of adopters you can host.',
      };
  }
}

function FacilitatorStepDoneSummary({ step, impact, record }: { step: FacilitatorStep; impact: ImpactProfile; record: JpFacilitatorRecord }) {
  if (step === 'profile-on-file' && impact.contact) {
    const c = impact.contact;
    const fields: string[] = [];
    if (c.firstName || c.lastName) fields.push('name');
    if (c.email) fields.push('email');
    if (c.country) fields.push('country');
    if (c.organizationName) fields.push('organization');
    return (
      <div style={{ marginTop: '.75rem', fontSize: '.85rem', color: 'var(--c-g600)' }}>
        <span style={{ color: 'var(--c-primary-active)', fontWeight: 700 }}>✓ On file</span> — your vault holds {fields.join(', ')}.
        {' '}{JP.org} sees your organization name + a "can reach you" flag; richer fields stay in your vault.
      </div>
    );
  }
  if (step === 'wea-on-file' && impact.attestations.wea) {
    const d = new Date(impact.attestations.wea.signedAt * 1000).toLocaleDateString();
    return (
      <div style={{ marginTop: '.75rem', fontSize: '.85rem', color: 'var(--c-g600)' }}>
        <span style={{ color: 'var(--c-primary-active)', fontWeight: 700 }}>✓ Signed at your home</span> on <b>{d}</b>. {JP.org} holds the attestation only.
      </div>
    );
  }
  if (step === 'mou' && record.attestations.mou) {
    const d = new Date(record.attestations.mou.signedAt * 1000).toLocaleString();
    return (
      <div style={{ marginTop: '.75rem', fontSize: '.85rem', color: 'var(--c-g600)' }}>
        <span style={{ color: 'var(--c-primary-active)', fontWeight: 700 }}>✓ Signed</span> on <b>{d}</b>. Receipt: <code style={{ fontSize: '.78rem' }}>{record.attestations.mou.docHash.slice(0, 18)}…</code>
      </div>
    );
  }
  if (step === 'coverage' && record.coverage) {
    return (
      <div style={{ marginTop: '.75rem', fontSize: '.85rem', color: 'var(--c-g600)' }}>
        <span style={{ color: 'var(--c-primary-active)', fontWeight: 700 }}>✓ Declared</span> coverage for <b>{record.coverage.peopleGroupIds.length}</b> people group{record.coverage.peopleGroupIds.length === 1 ? '' : 's'}.
      </div>
    );
  }
  return null;
}

// ── Coverage declaration form ───────────────────────────────────────────────

function CoverageDeclareForm({
  impact, record, canDeclare, onSave, onGoEditProfile, onGoSignWea,
}: {
  impact: ImpactProfile;
  record: JpFacilitatorRecord;
  canDeclare: boolean;
  onSave: (next: JpFacilitatorRecord) => void;
  onGoEditProfile: (missingKeys: string[]) => void;
  onGoSignWea: () => void;
}) {
  const [pgIds, setPgIds] = useState<string[]>(record.coverage?.peopleGroupIds ?? []);
  const [adopterTypes, setAdopterTypes] = useState<FacilitatorAdopterType[]>(record.coverage?.capacity.adopterTypes ?? []);
  const [sizeBands, setSizeBands] = useState<FacilitatorSizeBand[]>(record.coverage?.capacity.sizeBands ?? []);
  const [areas, setAreas] = useState<FacilitatorMinistryArea[]>(record.coverage?.capacity.ministryAreas ?? []);
  const [description, setDescription] = useState<string>(record.coverage?.description ?? '');
  const [declaring, setDeclaring] = useState(false);

  const missingFields = useMemo(() => impactProfileMissingFields(impact, FACILITATOR_PROFILE_TYPE), [impact]);
  const missingWea = !impact.attestations.wea;
  const missingMou = !record.attestations.mou;
  const formValid = pgIds.length > 0 && adopterTypes.length > 0 && sizeBands.length > 0 && areas.length > 0;
  const ready = formValid && canDeclare;

  const toggle = <T,>(arr: T[], v: T, setter: (next: T[]) => void): void => {
    if (arr.includes(v)) setter(arr.filter((x) => x !== v));
    else setter([...arr, v]);
  };

  const declare = () => {
    if (!ready) return;
    setDeclaring(true);
    onSave({
      ...record,
      coverage: {
        peopleGroupIds: pgIds,
        capacity: { adopterTypes, sizeBands, ministryAreas: areas },
        description: description.trim() || undefined,
        declaredAt: Math.floor(Date.now() / 1000),
      },
    });
  };

  return (
    <>
      <p style={{ fontSize: '.88rem', color: 'var(--c-g600)' }}>
        Declare the Frontier People Groups you can serve + the shape of adopters you can host. {JP.org} uses
        this to match you with new adopters who&apos;ve declared the same group.
      </p>

      <div style={{ marginTop: '1rem' }}>
        <h4 style={sectionHeadStyle}>Frontier People Groups you serve <span style={countPill}>{pgIds.length}</span></h4>
        <p style={sectionDescStyle}>Pick all that apply. Each picked group makes you discoverable to adopters who declare it.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '.6rem', marginTop: '.6rem' }}>
          {FPG_SEED.map((g) => (
            <FpgCard key={g.id} g={g} active={pgIds.includes(g.id)} onPick={() => toggle(pgIds, g.id, setPgIds)} />
          ))}
        </div>
      </div>

      <div style={{ marginTop: '1.5rem' }}>
        <h4 style={sectionHeadStyle}>Adopter types you can host <span style={countPill}>{adopterTypes.length}</span></h4>
        <p style={sectionDescStyle}>Which shapes of adopter are you set up to engage with?</p>
        <div style={chipGridStyle}>
          {ADOPTER_TYPE_OPTIONS_FAC.map((o) => (
            <ChipOption key={o.key} label={o.label} blurb={o.blurb} active={adopterTypes.includes(o.key)} onToggle={() => toggle(adopterTypes, o.key, setAdopterTypes)} />
          ))}
        </div>
      </div>

      <div style={{ marginTop: '1.5rem' }}>
        <h4 style={sectionHeadStyle}>Size bands <span style={countPill}>{sizeBands.length}</span></h4>
        <p style={sectionDescStyle}>How many adopters can you host concurrently?</p>
        <div style={chipGridStyle}>
          {SIZE_BAND_OPTIONS.map((o) => (
            <ChipOption key={o.key} label={o.label} blurb={o.blurb} active={sizeBands.includes(o.key)} onToggle={() => toggle(sizeBands, o.key, setSizeBands)} />
          ))}
        </div>
      </div>

      <div style={{ marginTop: '1.5rem' }}>
        <h4 style={sectionHeadStyle}>Ministry areas <span style={countPill}>{areas.length}</span></h4>
        <p style={sectionDescStyle}>What kind of work do you engage in on the field?</p>
        <div style={chipGridStyle}>
          {MINISTRY_AREA_OPTIONS.map((o) => (
            <ChipOption key={o.key} label={o.label} blurb={o.blurb} active={areas.includes(o.key)} onToggle={() => toggle(areas, o.key, setAreas)} />
          ))}
        </div>
      </div>

      <div style={{ marginTop: '1.5rem' }}>
        <label htmlFor="fac-desc" style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--c-g800)', display: 'block' }}>
          How you engage (visible only to matched adopters)
        </label>
        <p style={sectionDescStyle}>Optional. A short note about your approach + posture.</p>
        <textarea
          id="fac-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. We host quarterly prayer + update calls and an annual 5-day visit for adopters wanting to engage on the field."
          style={{
            width: '100%', padding: '.7rem .9rem', fontSize: '.92rem', borderRadius: 10,
            border: '1.5px solid var(--c-g300)', background: '#fff', fontFamily: 'inherit', resize: 'vertical',
            marginTop: '.4rem',
          }}
        />
      </div>

      {!canDeclare && (
        <div style={{
          marginTop: '1.25rem', background: '#fef2f2', border: '1.5px solid #fecaca',
          borderRadius: 14, padding: '1rem 1.25rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.55rem', marginBottom: '.6rem' }}>
            <span aria-hidden="true" style={{
              width: 26, height: 26, borderRadius: 999, background: '#dc2626', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: '.85rem',
            }}>!</span>
            <div style={{ fontWeight: 800, color: '#991b1b' }}>Before {JP.org} can accept your coverage:</div>
          </div>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#7f1d1d', fontSize: '.88rem', lineHeight: 1.65 }}>
            {missingFields.map((f) => (
              <li key={f.key}>
                Add <b>{f.label}</b> to your {JP.impactName} profile — <span style={{ color: '#991b1b' }}>{f.helperWhy}</span>
              </li>
            ))}
            {missingWea && <li>Sign the WEA Statement of Faith at your {JP.impactName} home.</li>}
            {missingMou && <li>Sign the ADOPT MOU (above).</li>}
          </ul>
          <div style={{ marginTop: '.85rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            {missingFields.length > 0 && (
              <button
                onClick={() => onGoEditProfile(missingFields.map((f) => f.key))}
                style={redBtn}
              >
                Complete profile at my {JP.impactName} home →
              </button>
            )}
            {missingWea && (
              <button onClick={onGoSignWea} style={redBtn}>
                Sign WEA at my {JP.impactName} home →
              </button>
            )}
          </div>
        </div>
      )}

      <button
        className="btn btn-primary"
        disabled={!ready || declaring}
        style={{ marginTop: '1rem' }}
        onClick={declare}
        title={!canDeclare ? 'Resolve the missing items above before declaring.' : !formValid ? 'Pick at least one option in each section.' : undefined}
      >
        {declaring ? 'Declaring…' : `Declare coverage for ${pgIds.length} people group${pgIds.length === 1 ? '' : 's'}`}
      </button>
    </>
  );
}

function ChipOption({ label, blurb, active, onToggle }: { label: string; blurb: string; active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      style={{
        textAlign: 'left', padding: '.65rem .85rem', borderRadius: 12, cursor: 'pointer',
        background: active ? 'var(--c-primary-subtle)' : '#fff',
        border: `1.5px solid ${active ? 'var(--c-primary)' : 'var(--c-g200)'}`,
        display: 'flex', flexDirection: 'column', gap: '.15rem',
      }}
    >
      <div style={{ fontWeight: 700, color: 'var(--c-g900)', fontSize: '.9rem', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
        <span style={{
          width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${active ? 'var(--c-primary)' : 'var(--c-g300)'}`,
          background: active ? 'var(--c-primary)' : '#fff', color: '#fff', flex: '0 0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.7rem', fontWeight: 900,
        }}>{active ? '✓' : ''}</span>
        {label}
      </div>
      <div style={{ fontSize: '.74rem', color: 'var(--c-g500)', marginLeft: '1.4rem' }}>{blurb}</div>
    </button>
  );
}

const sectionHeadStyle: React.CSSProperties = {
  fontSize: '.92rem', fontWeight: 800, color: 'var(--c-g800)', margin: 0,
  display: 'flex', alignItems: 'center', gap: '.5rem',
};
const sectionDescStyle: React.CSSProperties = { fontSize: '.78rem', color: 'var(--c-g500)', marginTop: '.2rem' };
const countPill: React.CSSProperties = {
  fontSize: '.68rem', fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase',
  padding: '.1rem .45rem', borderRadius: 999, background: 'var(--c-primary-subtle)',
  color: 'var(--c-primary-active)', border: '1px solid var(--c-primary-border)',
};
const chipGridStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '.5rem', marginTop: '.6rem',
};
const redBtn: React.CSSProperties = {
  background: '#dc2626', color: '#fff', border: 'none',
  padding: '.6rem 1rem', borderRadius: 999, fontWeight: 700, fontSize: '.88rem', cursor: 'pointer',
};

// ── Facilitator completion + projection ─────────────────────────────────────

function FacilitatorSummary({ session, record, impact, onUpdate }: { session: Session; record: JpFacilitatorRecord; impact: ImpactProfile; onUpdate: (next: JpFacilitatorRecord) => void }) {
  const coverage = record.coverage!;
  const groups = coverage.peopleGroupIds.map(findPeopleGroup).filter((g): g is NonNullable<typeof g> => !!g);
  const homeUrl = personalAuthOrigin(nameLabel(session.name));
  const displayName = displayNameFromImpact(impact, session.name);
  const orgName = impact.contact?.organizationName;
  // Adopters JP introduced to this facilitator — intersect on FPG + adopter type.
  // Pass the viewer's own address so their own adopter persona (if any) is
  // included alongside the seeded adopters — same-browser dual-persona case.
  const [matchedAdopters, setMatchedAdopters] = useState<MatchedAdopter[]>([]);
  useEffect(() => {
    let cancelled = false;
    void matchAdoptersForFacilitator(coverage, session.address)
      .then((a) => { if (!cancelled) setMatchedAdopters(a); })
      .catch(() => { if (!cancelled) setMatchedAdopters([]); });
    return () => { cancelled = true; };
  }, [coverage, session.address]);

  return (
    <>
      <section className="hero" style={{ padding: '3rem 0 2rem' }}>
        <div className="wrap">
          <div className="eyebrow" style={{ color: 'var(--c-primary)' }}>✓ Coverage declared</div>
          <h1 style={{ marginTop: '.5rem', fontSize: 'clamp(1.6rem, 4vw, 2.4rem)' }}>
            {displayName} of <span style={{ color: 'var(--c-primary)' }}>{orgName ?? 'your organization'}</span>, you&apos;re facilitating <span style={{ color: 'var(--c-primary)' }}>{groups.length}</span> people group{groups.length === 1 ? '' : 's'}.
          </h1>
          <p className="hero-sub" style={{ fontSize: '1rem' }}>
            {JP.org} will match new adopters of {groups.length === 1 ? 'this group' : 'these groups'} to you when their preferences fit your capacity.
          </p>
        </div>
      </section>

      <section className="section wrap" style={{ paddingTop: 0 }}>
        <div className="sec-head">
          <div className="eyebrow">Your coverage</div>
          <h2>People groups you serve</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '.6rem', marginTop: '.75rem' }}>
          {groups.map((g) => <FpgCard key={g.id} g={g} active onPick={() => { /* read-only */ }} />)}
        </div>
      </section>

      <section className="section wrap" style={{ paddingTop: 0 }}>
        <div className="agreements" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '.875rem' }}>
          <CapacityCard
            title="Adopter types you host"
            values={coverage.capacity.adopterTypes.map((t) => FACILITATOR_ADOPTER_TYPE_LABEL[t])}
          />
          <CapacityCard
            title="Size bands"
            values={coverage.capacity.sizeBands.map((b) => SIZE_BAND_LABEL[b])}
          />
          <CapacityCard
            title="Ministry areas"
            values={coverage.capacity.ministryAreas.map((a) => MINISTRY_AREA_LABEL[a])}
          />
        </div>
        {coverage.description && (
          <div className="agreement" style={{ marginTop: '.875rem' }}>
            <h3>How you engage</h3>
            <p style={{ color: 'var(--c-g700)', marginTop: '.35rem' }}>{coverage.description}</p>
          </div>
        )}
      </section>

      <section className="section wrap" style={{ paddingTop: 0 }}>
        <div className="agreements" style={{ gridTemplateColumns: '1fr', gap: '.875rem' }}>
          <div className="agreement">
            <h3>What now</h3>
            <p style={{ color: 'var(--c-g600)' }}>
              {JP.org} will introduce new adopters of your declared people groups to you when their
              preferences fit your capacity. You&apos;ll send quarterly updates back through the same
              scoped delegation. Both flows ride over the permission you granted at sign-in.
            </p>
          </div>
          <div className="agreement" style={{ background: '#fff' }}>
            <h3>Where everything lives</h3>
            <p style={{ color: 'var(--c-g600)' }}>
              Your ADOPT MOU + WEA Statement of Faith are in your {JP.impactName} vault at{' '}
              <a href={homeUrl} target="_blank" rel="noopener noreferrer"><b>{homeUrl}</b></a>.
              {JP.org} holds the attestations + your public coverage declaration. Revisit and revoke
              any time from your home.
            </p>
          </div>
        </div>
      </section>

      <PublishUpdatesPanel record={record} coverage={coverage} matchedAdopters={matchedAdopters} onUpdate={onUpdate} />

      <MatchedAdoptersPanel adopters={matchedAdopters} grant={session.grant} />

      <FacilitatorProjectionPanel impact={impact} record={record} session={session} />
    </>
  );
}

function MatchedAdoptersPanel({ adopters, grant }: { adopters: MatchedAdopter[]; grant: DelegationWire | undefined }) {
  if (adopters.length === 0) {
    return (
      <section className="section wrap" style={{ paddingTop: 0 }}>
        <div className="agreement" style={{ background: '#fff' }}>
          <h3>No adopter matches yet</h3>
          <p style={{ color: 'var(--c-g600)' }}>
            No declared adopters currently fit your coverage. JP will introduce them as new adopters
            declare the people groups + adopter types you serve.
          </p>
        </div>
      </section>
    );
  }
  // Group adopters by their declared FPG so the facilitator can scan by people group.
  const byPg = new Map<string, MatchedAdopter[]>();
  for (const a of adopters) {
    const list = byPg.get(a.peopleGroupId) ?? [];
    list.push(a);
    byPg.set(a.peopleGroupId, list);
  }
  return (
    <section className="section wrap" style={{ paddingTop: 0 }}>
      <div className="sec-head">
        <div className="eyebrow">JP introduced to you</div>
        <h2>{adopters.length === 1 ? 'Adopter matched to you' : `Adopters matched to you (${adopters.length})`}</h2>
        <p>
          Matched on your declared people groups + adopter types you said you can host. JP released a
          scoped slice of each adopter; their vaults stay sealed.
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '1.25rem' }}>
        {Array.from(byPg.entries()).map(([pgId, list]) => {
          const pg = findPeopleGroup(pgId);
          return (
            <div key={pgId}>
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: '.6rem', flexWrap: 'wrap',
                marginBottom: '.6rem',
              }}>
                <h3 style={{ fontSize: '1.05rem' }}>{pg?.name ?? pgId}</h3>
                <span style={{ fontSize: '.78rem', color: 'var(--c-g500)' }}>{pg?.country}</span>
                <span style={{
                  fontSize: '.68rem', fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase',
                  padding: '.15rem .5rem', borderRadius: 999,
                  background: 'var(--c-primary-subtle)', color: 'var(--c-primary-active)',
                  border: '1px solid var(--c-primary-border)',
                }}>{list.length} adopter{list.length === 1 ? '' : 's'}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '.6rem' }}>
                {list.map((a) => <MatchedAdopterCard key={a.id} a={a} grant={grant} />)}
              </div>
            </div>
          );
        })}
      </div>
      <DisclosureManifest
        title="What JP released to you by default"
        released={DISCLOSURE_ADOPTER_TO_FACILITATOR.released}
        notReleased={DISCLOSURE_ADOPTER_TO_FACILITATOR.notReleased}
        upgradeNote="Contact-exchange (last name + email + phone) is a richer scope granted on mutual consent. Request it on any adopter card above — when both sides accept, JP releases the additional fields to each side."
      />
    </section>
  );
}

function MatchedAdopterCard({ a, grant }: { a: MatchedAdopter; grant: DelegationWire | undefined }) {
  const declared = new Date(a.declaredAt * 1000);
  const daysAgo = Math.max(0, Math.floor((Date.now() - declared.getTime()) / 86_400_000));
  const ago = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : daysAgo < 30 ? `${daysAgo} days ago` : daysAgo < 60 ? '~1 month ago' : `~${Math.round(daysAgo / 30)} months ago`;
  return (
    <div style={{
      background: '#fff', border: '1px solid var(--c-g200)', borderRadius: 12, padding: '.85rem 1rem',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '.5rem' }}>
        <div style={{ fontWeight: 700, color: 'var(--c-g900)', display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
          {a.firstName} {a.lastInitial}
          {a.isSelf && <SelfBadge />}
        </div>
        <span style={{
          fontSize: '.68rem', fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase',
          padding: '.1rem .5rem', borderRadius: 999,
          background: 'var(--c-g100)', color: 'var(--c-g700)', border: '1px solid var(--c-g200)',
        }}>{FACILITATOR_ADOPTER_TYPE_LABEL[a.adopterType] ?? a.adopterType}</span>
      </div>
      <div style={{ fontSize: '.78rem', color: 'var(--c-g500)', marginTop: '.2rem' }}>{a.country}</div>
      <div style={{ fontSize: '.78rem', color: 'var(--c-g500)', marginTop: '.5rem' }}>Declared {ago}</div>

      <ContactExchangeWidget
        grant={grant}
        matchId={a.id}
        partyLabel={`${a.firstName} ${a.lastInitial}`}
        firstName={a.firstName}
        lastName={a.exchangeLastName}
        email={a.exchangeEmail}
        phone={a.exchangePhone}
      />
    </div>
  );
}

/** Facilitator's publishing surface — compose new updates, see what you've shipped.
 *  Each update tags a single FPG (limited to the facilitator's declared coverage) +
 *  a short title + a body. The "Visible to: N adopters" count is computed live from
 *  the matched-adopter list, so the facilitator sees the audience size before they
 *  publish. The update flows to those adopters via the existing introduction's
 *  scoped delegation — no new scope, no new consent, just durable relationship value. */
function PublishUpdatesPanel({
  record,
  coverage,
  matchedAdopters,
  onUpdate,
}: {
  record: JpFacilitatorRecord;
  coverage: import('./lib/vault').FacilitatorCoverage;
  matchedAdopters: MatchedAdopter[];
  onUpdate: (next: JpFacilitatorRecord) => void;
}) {
  const updates = useMemo(
    () => [...(record.publishedUpdates ?? [])].sort((a, b) => b.publishedAt - a.publishedAt),
    [record.publishedUpdates],
  );
  const audienceByFpg = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of matchedAdopters) m.set(a.peopleGroupId, (m.get(a.peopleGroupId) ?? 0) + 1);
    return m;
  }, [matchedAdopters]);

  const remove = (id: string) => {
    onUpdate({
      ...record,
      publishedUpdates: (record.publishedUpdates ?? []).filter((u) => u.id !== id),
    });
  };

  return (
    <section className="section wrap" style={{ paddingTop: 0 }}>
      <div className="sec-head">
        <div className="eyebrow">Stay in touch</div>
        <h2>Publish an update</h2>
        <p>
          Send a short quarterly (or ad-hoc) update tagged to one of your declared people groups.
          Matched adopters of that group see it on their dashboard over the same scoped delegation —
          no new permission needed.
        </p>
      </div>

      <PublishUpdateForm
        record={record}
        coverage={coverage}
        audienceByFpg={audienceByFpg}
        onPublish={(u) => onUpdate({ ...record, publishedUpdates: [...(record.publishedUpdates ?? []), u] })}
      />

      {updates.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '.75rem' }}>
            Your published updates ({updates.length})
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
            {updates.map((u) => (
              <PublishedUpdateCard
                key={u.id}
                u={u}
                audience={audienceByFpg.get(u.peopleGroupId) ?? 0}
                onRemove={() => remove(u.id)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function PublishUpdateForm({
  coverage,
  audienceByFpg,
  onPublish,
}: {
  record: JpFacilitatorRecord;
  coverage: import('./lib/vault').FacilitatorCoverage;
  audienceByFpg: Map<string, number>;
  onPublish: (u: PublishedUpdate) => void;
}) {
  const [pgId, setPgId] = useState<string>(coverage.peopleGroupIds[0] ?? '');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [publishing, setPublishing] = useState(false);

  const ready = !!pgId && title.trim().length > 2 && body.trim().length > 10;

  const publish = () => {
    if (!ready) return;
    setPublishing(true);
    const u: PublishedUpdate = {
      id: `upd-self-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      peopleGroupId: pgId,
      publishedAt: Math.floor(Date.now() / 1000),
      title: title.trim(),
      body: body.trim(),
    };
    // Brief beat so the action feels real — then commit + reset.
    window.setTimeout(() => {
      onPublish(u);
      setTitle('');
      setBody('');
      setPublishing(false);
    }, 500);
  };

  const audience = audienceByFpg.get(pgId) ?? 0;

  return (
    <div style={{
      background: '#fff', border: '1px solid var(--c-g200)', borderRadius: 14, padding: '1.1rem 1.25rem',
      display: 'flex', flexDirection: 'column', gap: '.85rem',
    }}>
      <div>
        <label style={publishLabel} htmlFor="upd-pg">People group</label>
        <select
          id="upd-pg" value={pgId} onChange={(e) => setPgId(e.target.value)}
          style={publishInput}
        >
          {coverage.peopleGroupIds.map((id) => {
            const g = findPeopleGroup(id);
            return <option key={id} value={id}>{g?.name ?? id} ({g?.country ?? ''})</option>;
          })}
        </select>
        <div style={{ marginTop: '.3rem', fontSize: '.78rem', color: 'var(--c-g500)' }}>
          Visible to <b>{audience}</b> matched adopter{audience === 1 ? '' : 's'} of this group.
        </div>
      </div>

      <div>
        <label style={publishLabel} htmlFor="upd-title">Title</label>
        <input
          id="upd-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Quarterly Najdi prayer focus" maxLength={120}
          style={publishInput}
        />
      </div>

      <div>
        <label style={publishLabel} htmlFor="upd-body">Body</label>
        <textarea
          id="upd-body" rows={5} value={body} onChange={(e) => setBody(e.target.value)}
          placeholder="What you'd like your adopters to pray for + any recent context."
          style={{ ...publishInput, resize: 'vertical', fontFamily: 'inherit' }}
        />
        <div style={{ marginTop: '.3rem', fontSize: '.76rem', color: 'var(--c-g500)' }}>
          {body.length} characters — keep it focused; long updates lose readers.
        </div>
      </div>

      <button
        className="btn btn-primary"
        disabled={!ready || publishing}
        onClick={publish}
        style={{ alignSelf: 'flex-start' }}
        title={!ready ? 'Pick a people group and write a title + body before publishing.' : undefined}
      >
        {publishing ? 'Publishing…' : `Publish to ${audience} adopter${audience === 1 ? '' : 's'} →`}
      </button>
    </div>
  );
}

function PublishedUpdateCard({ u, audience, onRemove }: { u: PublishedUpdate; audience: number; onRemove: () => void }) {
  const pg = findPeopleGroup(u.peopleGroupId);
  const date = new Date(u.publishedAt * 1000).toLocaleString();
  return (
    <div style={{
      background: '#fff', border: '1px solid var(--c-g200)', borderRadius: 12, padding: '.85rem 1rem',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '.5rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, color: 'var(--c-g900)' }}>{u.title}</div>
          <div style={{ fontSize: '.76rem', color: 'var(--c-g500)', marginTop: '.15rem' }}>
            {pg?.name ?? u.peopleGroupId} · {date} · seen by {audience} adopter{audience === 1 ? '' : 's'}
          </div>
        </div>
        <button
          onClick={onRemove}
          style={{
            background: 'none', border: 'none', color: 'var(--c-g500)',
            fontSize: '.78rem', cursor: 'pointer', textDecoration: 'underline', padding: 0,
          }}
          title="Retract this update — it disappears from matched adopters."
        >
          Retract
        </button>
      </div>
      <p style={{ marginTop: '.55rem', fontSize: '.88rem', color: 'var(--c-g700)', lineHeight: 1.55 }}>{u.body}</p>
    </div>
  );
}

const publishLabel: React.CSSProperties = {
  display: 'block', fontSize: '.78rem', fontWeight: 700, color: 'var(--c-g800)', marginBottom: '.35rem',
};
const publishInput: React.CSSProperties = {
  width: '100%', padding: '.6rem .8rem', fontSize: '.92rem', borderRadius: 10,
  border: '1.5px solid var(--c-g300)', background: '#fff',
};

function CapacityCard({ title, values }: { title: string; values: string[] }) {
  return (
    <div className="agreement">
      <h3>{title}</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem', marginTop: '.55rem' }}>
        {values.length === 0 ? (
          <span style={{ color: 'var(--c-g500)', fontSize: '.85rem' }}>—</span>
        ) : values.map((v) => (
          <span key={v} style={{
            fontSize: '.78rem', fontWeight: 700, padding: '.25rem .65rem', borderRadius: 999,
            background: 'var(--c-primary-subtle)', color: 'var(--c-primary-active)',
            border: '1px solid var(--c-primary-border)',
          }}>{v}</span>
        ))}
      </div>
    </div>
  );
}

function FacilitatorProjectionPanel({ impact, record, session }: { impact: ImpactProfile; record: JpFacilitatorRecord; session: Session }) {
  const projection = useMemo(() => projectFacilitatorForJp(impact, record), [impact, record]);
  const homeUrl = personalAuthOrigin(nameLabel(session.name));
  return (
    <section className="section wrap" style={{ paddingTop: 0 }}>
      <div className="trust">
        <div className="eyebrow" style={{ color: 'var(--c-primary-mid)' }}>What JP + matched adopters can see</div>
        <h2 style={{ fontSize: '1.5rem', maxWidth: '42ch' }}>This is everything {JP.org} surfaces about you. Compare it to your vault — much smaller.</h2>
        <div style={{ marginTop: '1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          <ProjBox label="Organization" value={projection.organizationName ?? '—'} />
          <ProjBox label="Country" value={projection.organizationCountry ?? '—'} />
          <ProjBox label="Contact channel" value={projection.hasContact ? '✓ Can reach you (flag only)' : '— none'} />
          <ProjBox label="ADOPT MOU receipt" value={projection.attestations.mou ? `✓ ${projection.attestations.mou.docHash.slice(0, 16)}…` : '—'} mono />
          <ProjBox label="WEA receipt" value={projection.attestations.wea ? `✓ ${projection.attestations.wea.docHash.slice(0, 16)}…` : '—'} mono />
          <ProjBox label="People groups served" value={projection.coverage ? String(projection.coverage.peopleGroupIds.length) : '—'} />
          <ProjBox label="Adopter types" value={projection.coverage ? String(projection.coverage.capacity.adopterTypes.length) : '—'} />
          <ProjBox label="Ministry areas" value={projection.coverage ? String(projection.coverage.capacity.ministryAreas.length) : '—'} />
        </div>
        <p style={{ marginTop: '1.5rem', fontSize: '.85rem', color: '#94a3b8' }}>
          Revoke at your home <a href={homeUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c-primary-mid)' }}>{homeUrl}</a> and this surface goes empty —
          your vault stays intact, JP just stops introducing new adopters.
        </p>
      </div>
    </section>
  );
}

// ── WEA modal (unchanged) ───────────────────────────────────────────────────

function WeaModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="scrim" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <button className="panel-x" onClick={onClose} aria-label="Close">×</button>
        <h2>{JP.wea.name}</h2>
        <p style={{ color: 'var(--c-g600)', margin: '.5rem 0 1rem' }}>We believe in:</p>
        <ul className="wea-text">{WEA_AFFIRMATIONS.map((a, i) => <li key={i}>{a}</li>)}</ul>
        <div className="panel-foot">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <span className="soon">You’ll affirm this inside your {JP.impactName} home — once, then re-used everywhere.</span>
        </div>
      </div>
    </div>
  );
}
