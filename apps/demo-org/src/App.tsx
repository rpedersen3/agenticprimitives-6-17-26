import { useCallback, useEffect, useState } from 'react';
import type { Address } from '@agenticprimitives/types';
import {
  connectWithName,
  signupWithName,
  startOrgCreation,
  startSiteEnrollment,
  exchangeCode,
  verifyIdToken,
  silentReauth,
  readOrgData,
  readPersonData,
  type OrgTokenPayload,
} from './connect-client';
import { openCentralAuthPopup, preferRedirect } from './lib/central-auth';
import type { DelegationWire } from './lib/delegation';
import { hasWallet } from './lib/wallet';
import { loadPasskey } from './lib/passkey';

const ENROLL_KEY = 'agenticprimitives:demo-org:enroll';
const ORG_KEY = 'agenticprimitives:demo-org:org-create'; // {state, addr} stashed across an org-creation redirect
const LOCAL_PASSKEY_NAME = 'agenticprimitives:demo-org:passkey-name';
/** Normalize an agent name to its full `<label>.demo.agent` form for stable storage keys. */
const fullName = (name: string) => {
  const n = name.trim().toLowerCase();
  return n.endsWith('.demo.agent') ? n : `${n.replace(/\.+$/, '')}.demo.agent`;
};
/** The scoped delegation (person SA → this site's delegate SA) issued at enrollment, stored
 *  per agent name on this device (ADR-0019). Drives "Continue with passkey" + org actions. */
const delegationKey = (name: string) => `agenticprimitives:demo-org:delegation:${fullName(name)}`;
function loadDelegation(name: string): DelegationWire | null {
  try {
    const raw = localStorage.getItem(delegationKey(name));
    return raw ? (JSON.parse(raw) as DelegationWire) : null;
  } catch {
    return null;
  }
}
/** True iff this device holds a stored delegation for `name` (→ one-touch passkey sign-in). */
const hasLocalDelegation = (name: string): boolean => !!loadPasskey() && !!loadDelegation(name);

const SESSION_KEY = 'agenticprimitives:demo-org:session';
const orgsKey = (addr: string) => `agenticprimitives:demo-org:orgs:${addr.toLowerCase()}`;

type Via = 'wallet' | 'passkey';
interface Session {
  token: string;
  via: Via;
  name: string;
  address: Address;
  fresh: boolean;
}
interface Org {
  orgAgent: string;
  orgName: string;
  governed?: boolean; // true if person→org HAS_GOVERNANCE_OVER edge was recorded
  // Scoped org→delegate delegation minted at creation (org is custodied by your ROOT passkey
  // at the central auth). Lets this site read the org's data without another passkey ceremony.
  orgDelegation?: DelegationWire;
}

/** Decode a JWS payload segment (base64url JSON). */
function decodeToken(token: string): { sub?: string; exp?: number } | null {
  try {
    const seg = token.split('.')[1] ?? '';
    const json = atob(seg.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((2 - (seg.length & 3)) & 3));
    return JSON.parse(json) as { sub?: string; exp?: number };
  } catch {
    return null;
  }
}
/** eip155:84532:0xabc… → 0xabc… */
function addrFromSub(sub?: string): Address | null {
  const m = sub?.match(/0x[0-9a-fA-F]{40}$/);
  return (m?.[0] as Address) ?? null;
}

/** Restore a persisted, non-expired session synchronously (no flicker). */
function restoreSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { token?: string; via?: Via; name?: string };
    if (!s.token || !s.via || !s.name) return null;
    const dec = decodeToken(s.token);
    const addr = addrFromSub(dec?.sub);
    if (!addr || !dec?.exp || dec.exp * 1000 <= Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return { token: s.token, via: s.via, name: s.name, address: addr, fresh: false };
  } catch {
    return null;
  }
}

// ── Presentational helpers ────────────────────────────────────────────────

/** Humanize a snake_case / camelCase / UPPER_CASE key for display. */
function humanizeKey(k: string): string {
  return k
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Render an arbitrary JSON record as readable key/value rows. */
function RecordRows({ record }: { record: unknown }) {
  if (record == null) return null;
  const entries = typeof record === 'object' && !Array.isArray(record)
    ? Object.entries(record as Record<string, unknown>)
    : [['Value', String(record)]];
  return (
    <table className="record-table" aria-label="Data record">
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k}>
            <td className="rec-key">{humanizeKey(k)}</td>
            <td className="rec-val">{String(v ?? '—')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Masked PII placeholder (accessibility-safe: hidden from screen readers). */
function PiiMask({ lines }: { lines: string[] }) {
  return (
    <div aria-hidden="true">
      {lines.map((l, i) => (
        <span key={i} className="pii-mask">{l}</span>
      ))}
    </div>
  );
}

// ── Shield SVG ───────────────────────────────────────────────────────────
// Gradient-filled shield used across topbar, hero, and cards.
// Two sizes: 30px (topbar) and 88px (hero). The large hero variant
// includes an outer glow halo and a gradient fill matching the mockups.

const ShieldLogo = ({ size = 30, gradient = false }: { size?: number; gradient?: boolean }) => {
  const id = gradient ? 'sg' : 'sp';
  return (
    <svg
      className="brand-shield"
      width={size}
      height={size}
      viewBox="0 0 40 46"
      fill="none"
      aria-hidden="true"
      style={{ width: size, height: size }}
    >
      {gradient && (
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="55%" stopColor="#4338ca" />
            <stop offset="100%" stopColor="#3730a3" />
          </linearGradient>
          <radialGradient id={`${id}-glow`} cx="50%" cy="60%" r="50%">
            <stop offset="0%" stopColor="rgba(99,102,241,.45)" />
            <stop offset="100%" stopColor="rgba(99,102,241,0)" />
          </radialGradient>
          <filter id={`${id}-blur`}>
            <feGaussianBlur stdDeviation="3" result="blur" />
          </filter>
        </defs>
      )}
      {/* Outer glow on large hero shield */}
      {gradient && (
        <ellipse
          cx="20" cy="36"
          rx="18" ry="10"
          fill={`url(#${id}-glow)`}
          filter={`url(#${id}-blur)`}
          opacity=".7"
        />
      )}
      {/* Shield body */}
      <path
        d="M20 1L37 7.5V21C37 30.389 29.832 38.234 20 41C10.168 38.234 3 30.389 3 21V7.5L20 1Z"
        fill={gradient ? `url(#${id}-fill)` : '#4338ca'}
        opacity={gradient ? 1 : 1}
      />
      {/* Inner highlight layer */}
      <path
        d="M20 5L33 10.5V21C33 28.556 27.506 35.08 20 37.5C12.494 35.08 7 28.556 7 21V10.5L20 5Z"
        fill="white"
        fillOpacity={gradient ? '.14' : '.18'}
      />
      {/* Check mark */}
      <path
        d="M14.5 22.5L18.5 26.5L26 18"
        stroke="white"
        strokeWidth={gradient ? '2.8' : '2.4'}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

// ── App ───────────────────────────────────────────────────────────────────

export function App() {
  const [session, setSession] = useState<Session | null>(restoreSession);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Connect-by-name
  const [connectName, setConnectName] = useState('');
  const [connectErr, setConnectErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nameInfo, setNameInfo] = useState<{
    status: 'idle' | 'checking' | 'none' | 'found';
    name?: string;
    hasEoa?: boolean;
    hasPasskey?: boolean;
  }>({ status: 'idle' });

  // Sign-up
  const [desiredName, setDesiredName] = useState('');
  const [signupAvail, setSignupAvail] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');

  // Orgs
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgName, setOrgName] = useState('');
  const [orgAvail, setOrgAvail] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  // Per-org sensitive-data read state (via an org→person delegation).
  const [orgData, setOrgData] = useState<Record<string, { loading?: boolean; record?: unknown; error?: string }>>({});
  // Person PII read state (via the person→delegate delegation we already hold).
  const [personData, setPersonData] = useState<{ loading?: boolean; record?: unknown; error?: string } | null>(null);

  // Shared progress modal (sign-up + create-org)
  const [flow, setFlow] = useState<
    | { title: string; phase: 'running' | 'done'; steps: string[] }
    | { title: string; phase: 'error'; steps: string[]; error: string }
    | null
  >(null);

  const openSession = useCallback((token: string, via: Via, name: string, fresh: boolean) => {
    const addr = addrFromSub(decodeToken(token)?.sub);
    if (!addr) {
      setError('Could not read the agent address from the session token.');
      return;
    }
    setSession({ token, via, name, address: addr, fresh });
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ token, via, name }));
      // Remember which agent THIS origin's local passkey is bound to, so we only
      // offer "Continue with passkey" for that agent (not for one set up elsewhere).
      if (via === 'passkey') localStorage.setItem(LOCAL_PASSKEY_NAME, name);
    } catch {
      /* storage blocked — session just won't persist */
    }
    try {
      const stored = localStorage.getItem(orgsKey(addr));
      setOrgs(stored ? (JSON.parse(stored) as Org[]) : []);
    } catch {
      setOrgs([]);
    }
  }, []);

  // Load orgs for a restored session on first mount.
  useEffect(() => {
    if (!session) return;
    try {
      const stored = localStorage.getItem(orgsKey(session.address));
      setOrgs(stored ? (JSON.parse(stored) as Org[]) : []);
    } catch {
      /* ignore */
    }
    // run once for the initial restored session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // OIDC redirect-fallback return (spec 230): ?code&state. Match the echoed state against the
  // stash we left (ENROLL_KEY = site-login, ORG_KEY = org-create) and complete the code exchange.
  // The popup path resolves inline instead. Fail-closed on state mismatch (audit F5). Once on mount.
  useEffect(() => {
    const u = new URL(window.location.href);
    const code = u.searchParams.get('code');
    const retState = u.searchParams.get('state');
    const err = u.searchParams.get('enroll_error');
    if (!code && !err) return;
    for (const k of ['code', 'state', 'enroll_error']) u.searchParams.delete(k);
    window.history.replaceState({}, '', u.toString());
    if (err) {
      setError(`Sign-in was not completed (${err}).`);
      return;
    }

    type LoginStash = { state?: string; name?: string; authOrigin?: string; codeVerifier?: string; nonce?: string };
    type OrgStash = { state?: string; addr?: string; authOrigin?: string; codeVerifier?: string; nonce?: string };
    const read = <T,>(k: string): T => {
      try {
        return JSON.parse(sessionStorage.getItem(k) ?? '{}') as T;
      } catch {
        return {} as T;
      }
    };

    const login = read<LoginStash>(ENROLL_KEY);
    if (login.state && retState && login.state === retState) {
      sessionStorage.removeItem(ENROLL_KEY);
      if (!code || !login.authOrigin || !login.codeVerifier) {
        setError('Sign-in response was incomplete. Please try again.');
        return;
      }
      void completeAuth(login.authOrigin, code, login.codeVerifier, login.nonce ?? '', login.name ?? '', true);
      return;
    }
    const org = read<OrgStash>(ORG_KEY);
    if (org.state && retState && org.state === retState) {
      sessionStorage.removeItem(ORG_KEY);
      if (!code || !org.authOrigin || !org.codeVerifier || !org.addr) {
        setError('Org-creation response was incomplete. Please try again.');
        return;
      }
      void completeOrg(org.authOrigin, code, org.codeVerifier, org.addr);
      return;
    }
    setError("We couldn't verify that response. Please try again.");
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function signOut() {
    setSession(null);
    setMenuOpen(false);
    setOrgs([]);
    setError(null);
    setConnectName('');
    setConnectErr(null);
    setNameInfo({ status: 'idle' });
    setDesiredName('');
    setSignupAvail('idle');
    setOrgName('');
    setOrgAvail('idle');
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }

  // ── name availability checks (debounced) ────────────────────────────
  // Connect: which credentials does the named agent have?
  useEffect(() => {
    const name = connectName.trim();
    if (!name) {
      setNameInfo({ status: 'idle' });
      return;
    }
    setNameInfo({ status: 'checking' });
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/connect/name-info?name=${encodeURIComponent(name)}`);
        const b = (await r.json()) as { exists?: boolean; name?: string; hasEoa?: boolean; hasPasskey?: boolean };
        setNameInfo(
          b.exists ? { status: 'found', name: b.name, hasEoa: b.hasEoa, hasPasskey: b.hasPasskey } : { status: 'none' },
        );
      } catch {
        setNameInfo({ status: 'idle' });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [connectName]);

  // Sign-up: block an existing name.
  useEffect(() => {
    const name = desiredName.trim();
    if (!name) {
      setSignupAvail('idle');
      return;
    }
    setSignupAvail('checking');
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/connect/name-info?name=${encodeURIComponent(name)}`);
        const b = (await r.json()) as { exists?: boolean };
        setSignupAvail(b.exists ? 'taken' : 'available');
      } catch {
        setSignupAvail('idle');
      }
    }, 400);
    return () => clearTimeout(t);
  }, [desiredName]);

  // Org: name must be free.
  useEffect(() => {
    const name = orgName.trim();
    if (!name) {
      setOrgAvail('idle');
      return;
    }
    setOrgAvail('checking');
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/connect/name-info?name=${encodeURIComponent(name)}`);
        const b = (await r.json()) as { exists?: boolean };
        setOrgAvail(b.exists ? 'taken' : 'available');
      } catch {
        setOrgAvail('idle');
      }
    }, 400);
    return () => clearTimeout(t);
  }, [orgName]);

  // ── actions ─────────────────────────────────────────────────────────
  // Passkey → the OIDC sign-in at the person's central auth (spec 230). Wallet → connectWithName
  // (the wallet IS the person's custodian; not an OIDC flow).
  async function onConnectName(via: Via) {
    if (!connectName.trim()) return;
    setConnectErr(null);
    if (via === 'passkey') {
      const name = connectName.trim();
      // Returning sign-in: if we already hold a live delegation, re-auth SILENTLY (no popup,
      // no device prompt) — present it to the OP for a fresh id_token (ADR-0019). Only fall back
      // to the full popup ceremony if we have none, or it's stale/expired.
      const del = loadDelegation(name);
      if (del) {
        setBusy(true);
        const out = await silentReauth(name, del).catch(() => null);
        setBusy(false);
        if (out) {
          openSession(out.idToken, 'passkey', out.name, false);
          return;
        }
      }
      await beginSiteSetup(name);
      return;
    }
    setBusy(true);
    try {
      const out = await connectWithName(connectName.trim(), 'wallet');
      if (out.ok) openSession(out.token, 'wallet', out.name ?? connectName.trim(), false);
      else setConnectErr(out.error);
    } catch (e) {
      setConnectErr(e instanceof Error ? e.message : 'connect failed');
    } finally {
      setBusy(false);
    }
  }

  // Complete an OIDC sign-in (spec 230): exchange the authorization code at /token, verify the
  // id_token against the OP's JWKS (iss/aud/nonce/exp), store the delegation sidecar, and open
  // the session FROM the id_token (the id_token IS the proof-of-who — no separate session mint).
  async function completeAuth(authOrigin: string, code: string, codeVerifier: string, nonce: string, fallbackName: string, fresh: boolean) {
    setFlow({ title: 'Finishing sign-in…', phase: 'running', steps: ['Verifying your identity…'] });
    try {
      const tok = await exchangeCode(authOrigin, code, codeVerifier);
      const claims = await verifyIdToken(authOrigin, tok.idToken, nonce);
      const name = claims.agent_name ?? fallbackName;
      if (tok.delegation) {
        try {
          localStorage.setItem(delegationKey(name), JSON.stringify(tok.delegation));
          localStorage.setItem(LOCAL_PASSKEY_NAME, name);
        } catch {
          /* ignore */
        }
      }
      setFlow(null);
      openSession(tok.idToken, 'passkey', name, fresh);
    } catch (e) {
      setFlow({ title: "Couldn't finish", phase: 'error', steps: [], error: e instanceof Error ? e.message : 'sign-in failed' });
    }
  }

  // Begin cross-origin setup: register a LOCAL passkey for this origin (Windows Hello), then
  // hand off to the central auth — in a POPUP (keeps you here; first-party context for the
  // home ceremony), falling back to a full-page redirect when the popup is blocked or on
  // mobile. Used for a brand-new signup (central creates the account) AND "set up this site"
  // for an existing agent (central adds this site's key). Spec 229 §3 + popup UX design.
  async function beginSiteSetup(name: string) {
    setError(null);
    setConnectErr(null);
    setFlow({ title: 'Signing you in', phase: 'running', steps: ['Preparing your sign-in key on this device…'] });
    let url: string;
    let state: string;
    let authOrigin: string;
    let codeVerifier: string;
    let nonce: string;
    try {
      // Reuses (or first-time creates) the local passkey + delegate SA, then builds the OIDC
      // /authorize URL (code + S256 PKCE).
      const started = await startSiteEnrollment(name, (s) =>
        setFlow({ title: 'Signing you in', phase: 'running', steps: [s] }),
      );
      if (!started.ok) {
        setFlow({ title: "Couldn't start sign-in", phase: 'error', steps: [], error: started.error });
        return;
      }
      ({ url, state, authOrigin, codeVerifier, nonce } = started);
    } catch (e) {
      setFlow({
        title: "Couldn't start sign-in",
        phase: 'error',
        steps: [],
        error: e instanceof Error ? e.message : 'could not set up this device',
      });
      return;
    }

    const stash = JSON.stringify({ state, name, authOrigin, codeVerifier, nonce });

    // Mobile / narrow viewport → full-page redirect (a popup would open as a tab).
    if (preferRedirect()) {
      sessionStorage.setItem(ENROLL_KEY, stash);
      setFlow({ title: 'Signing you in', phase: 'running', steps: ['Taking you to your secure home…'] });
      await new Promise((r) => setTimeout(r, 700));
      window.location.href = url;
      return;
    }

    // Desktop → popup-first.
    setFlow({ title: 'Signing you in', phase: 'running', steps: ['Opening your secure home…'] });
    const result = await openCentralAuthPopup(url, state, authOrigin, (msg) =>
      setFlow({ title: 'Signing you in', phase: 'running', steps: [msg] }),
    );
    if (result.status === 'blocked') {
      sessionStorage.setItem(ENROLL_KEY, stash);
      setFlow({ title: 'Signing you in', phase: 'running', steps: ['Your browser blocked the popup — taking you to your secure home…'] });
      await new Promise((r) => setTimeout(r, 1100));
      window.location.href = url;
      return;
    }
    if (result.status === 'cancelled') {
      setFlow(null);
      setConnectErr('Sign-in was cancelled. You can try again.');
      return;
    }
    if (result.status === 'error') {
      setFlow({ title: "Couldn't finish", phase: 'error', steps: [], error: result.error });
      return;
    }
    await completeAuth(authOrigin, result.code, codeVerifier, nonce, name, true);
  }

  /** Existing agent, first time on this site → set up a site key via the central auth. */
  const onAddSite = (name: string) => beginSiteSetup(name);

  async function onSignup(via: Via) {
    const base = desiredName.trim();
    if (!base || signupAvail !== 'available') return;
    // Passkey signup is HOMED at the central auth: create a local key here, then the central
    // auth creates your account (ROOT passkey) + links this site. Wallet signup stays local
    // (a wallet already works across origins, so no central round-trip is needed).
    if (via === 'passkey') {
      await beginSiteSetup(base);
      return;
    }
    setError(null);
    const steps: string[] = [];
    const onStep = (s: string) => {
      steps.push(s);
      setFlow({ title: 'Creating your account…', phase: 'running', steps: [...steps] });
    };
    setFlow({ title: 'Creating your account…', phase: 'running', steps: [] });
    try {
      const out = await signupWithName(base, via, onStep);
      if (!out.ok) {
        setFlow({ title: "Couldn't finish", phase: 'error', steps: [...steps], error: out.error });
        return;
      }
      setFlow({ title: '✓ Account ready', phase: 'done', steps: [...steps] });
      await new Promise((r) => setTimeout(r, 800));
      openSession(out.token, via, out.name, true);
      setDesiredName('');
      setSignupAvail('idle');
      setFlow(null);
    } catch (e) {
      setFlow({ title: "Couldn't finish", phase: 'error', steps: [...steps], error: e instanceof Error ? e.message : 'signup failed' });
    }
  }

  // Persist a created org (de-duped by address) for `addr`, returning the merged list. The
  // org→site delegation (the OIDC sidecar) is stored with it so "View org data" can present it.
  function persistOrg(org: OrgTokenPayload, delegation: DelegationWire | undefined, addr: string): Org[] {
    const rec: Org = { orgAgent: org.orgAgent, orgName: org.orgName, governed: org.governed, orgDelegation: delegation };
    let list: Org[] = [];
    try {
      list = JSON.parse(localStorage.getItem(orgsKey(addr)) ?? '[]') as Org[];
    } catch {
      /* ignore */
    }
    const next = [rec, ...list.filter((o) => o.orgAgent.toLowerCase() !== rec.orgAgent.toLowerCase())];
    try {
      localStorage.setItem(orgsKey(addr), JSON.stringify(next));
    } catch {
      /* ignore */
    }
    return next;
  }

  // Complete an org-create code exchange (popup + redirect-fallback share this): /token →
  // { id_token, delegation (org→site), org } → persist the org + its delegation.
  async function completeOrg(authOrigin: string, code: string, codeVerifier: string, addr: string) {
    setFlow({ title: 'Creating your organization…', phase: 'running', steps: ['Finishing…'] });
    try {
      const tok = await exchangeCode(authOrigin, code, codeVerifier);
      if (!tok.org) throw new Error('no organization returned');
      setFlow({ title: '✓ Organization created', phase: 'done', steps: [] });
      setOrgs(persistOrg(tok.org, tok.delegation, addr));
      await new Promise((r) => setTimeout(r, 900));
      setOrgName('');
      setOrgAvail('idle');
      setFlow(null);
    } catch (e) {
      setFlow({ title: "Couldn't finish", phase: 'error', steps: [], error: e instanceof Error ? e.message : 'create org failed' });
    }
  }

  // Create an organization via the CENTRAL-AUTH ceremony (memory project_demo_org_durable_org_custody):
  // the org is deployed + custodied by your ROOT passkey AT the central auth — same pattern as your
  // person agent — and we receive a scoped org→delegate delegation to read its data. This site is
  // never a custodian. Needs the stored delegation (→ this site's delegate SA) from passkey setup.
  async function onCreateOrg() {
    if (!session) return;
    const base = orgName.trim();
    if (!base || orgAvail !== 'available') return;
    const del = loadDelegation(session.name);
    if (!del) {
      setFlow({
        title: 'Set up this site first',
        phase: 'error',
        steps: [],
        error:
          'Creating an organization uses your central-auth passkey. Sign in with "Continue with passkey" / "Set up this site" first.',
      });
      return;
    }
    const { url, state, authOrigin, codeVerifier, nonce } = await startOrgCreation(session.name, del.delegate, base);
    setFlow({ title: 'Creating your organization…', phase: 'running', steps: ['Opening your secure home…'] });
    const stash = JSON.stringify({ state, addr: session.address, authOrigin, codeVerifier, nonce });

    // Mobile / narrow viewport → full-page redirect.
    if (preferRedirect()) {
      sessionStorage.setItem(ORG_KEY, stash);
      await new Promise((r) => setTimeout(r, 600));
      window.location.href = url;
      return;
    }
    const result = await openCentralAuthPopup(url, state, authOrigin, (msg) =>
      setFlow({ title: 'Creating your organization…', phase: 'running', steps: [msg] }),
    );
    if (result.status === 'blocked') {
      sessionStorage.setItem(ORG_KEY, stash);
      setFlow({ title: 'Creating your organization…', phase: 'running', steps: ['Your browser blocked the popup — taking you to your secure home…'] });
      await new Promise((r) => setTimeout(r, 900));
      window.location.href = url;
      return;
    }
    if (result.status === 'cancelled') {
      setFlow(null);
      return;
    }
    if (result.status === 'error') {
      setFlow({ title: "Couldn't finish", phase: 'error', steps: [], error: result.error });
      return;
    }
    await completeOrg(authOrigin, result.code, codeVerifier, session.address);
  }

  // Read the PERSON's gated PII via the delegation we already hold (person → this site's
  // delegate SA). No new signature — same delegation that signed you in.
  async function onViewPersonData() {
    if (!session) return;
    const del = loadDelegation(session.name);
    if (!del) {
      setPersonData({ error: 'No delegation on this device — sign in via "Set up this site / Continue with passkey".' });
      return;
    }
    setPersonData({ loading: true });
    try {
      const out = await readPersonData(del);
      setPersonData(out.ok ? { record: out.record } : { error: out.error });
    } catch (e) {
      setPersonData({ error: e instanceof Error ? e.message : 'read failed' });
    }
  }

  // Read an org's gated data via the scoped org→delegate delegation minted at creation (the org
  // is custodied by your ROOT passkey at the central auth, not this site). No new signature.
  async function onViewOrgData(org: Org) {
    if (!session) return;
    const key = org.orgAgent;
    if (!org.orgDelegation) {
      setOrgData((m) => ({ ...m, [key]: { error: 'No org delegation on this device — re-create the org to grant this site access.' } }));
      return;
    }
    setOrgData((m) => ({ ...m, [key]: { loading: true } }));
    try {
      const out = await readOrgData(org.orgDelegation);
      setOrgData((m) => ({ ...m, [key]: out.ok ? { record: out.record } : { error: out.error } }));
    } catch (e) {
      setOrgData((m) => ({ ...m, [key]: { error: e instanceof Error ? e.message : 'read failed' } }));
    }
  }

  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

  // ── render ───────────────────────────────────────────────────────────

  return (
    <div id="app-root" style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>

      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <ShieldLogo size={28} />
            {session ? session.name : 'Agentic Org'}
          </div>
          {session ? (
            <div className="menu">
              <button
                className="agent-pill"
                aria-haspopup="true"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((o) => !o)}
              >
                <span>Account</span>
                <span aria-hidden="true" style={{ fontSize: '.7rem', color: 'var(--c-g300)', fontWeight: 400 }}>▾</span>
              </button>
              {menuOpen && (
                <div className="menu-pop" role="menu" onMouseLeave={() => setMenuOpen(false)}>
                  <div className="menu-meta">
                    <div style={{ fontWeight: 700, color: 'var(--c-g900)', marginBottom: '.1rem', fontSize: '.875rem' }}>
                      {session.name}
                    </div>
                    <div>via {session.via}</div>
                  </div>
                  <div className="menu-sep" />
                  <button
                    role="menuitem"
                    onClick={() => navigator.clipboard?.writeText(session.address)}
                  >
                    Copy agent address
                  </button>
                  <button role="menuitem" style={{ color: 'var(--c-danger)' }} onClick={signOut}>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </header>

      {/* Page-level error */}
      {error && (
        <div
          role="alert"
          style={{
            background: 'var(--c-danger-bg)',
            borderBottom: '1px solid var(--c-danger-border)',
            padding: '.75rem var(--app-px)',
            fontSize: '.875rem',
            color: 'var(--c-danger)',
            textAlign: 'center',
          }}
        >
          {error}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          SIGNED-OUT HERO
          ════════════════════════════════════════════════════════════ */}
      {!session && (
        <div className="hero-screen">
          <div className="hero-content">

            {/* Headline + value bullets */}
            <div className="hero-top">
              <h1>
                Your agent name is your portable{' '}
                <span className="accent">identity.</span>
              </h1>
              <ul className="value-list" aria-label="Benefits">
                <li>
                  <span className="vi-chip blue" aria-hidden="true">
                    {/* Passkey icon */}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="8" cy="15" r="4"/><path d="M15 9h4M15 12h2"/>
                      <path d="M12 15h1l2-6"/>
                    </svg>
                  </span>
                  Sign in with a <strong>passkey.</strong>
                </li>
                <li>
                  <span className="vi-chip green" aria-hidden="true">
                    {/* Check icon */}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </span>
                  Connect apps with <strong>approval.</strong>
                </li>
                <li>
                  <span className="vi-chip purple" aria-hidden="true">
                    {/* Shield icon */}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                  </span>
                  Revoke access <strong>anytime.</strong>
                </li>
              </ul>
            </div>

            {/* Shield illustration */}
            <div className="shield-hero" aria-hidden="true">
              <div className="shield-svg-wrap">
                <ShieldLogo size={88} gradient />
              </div>
            </div>

            {/* ── Existing-agent sign-in ─────────────────────────── */}
            <div style={{ marginBottom: '.875rem' }}>
              <p style={{
                fontSize: '.72rem', fontWeight: 700, color: 'var(--c-g400)',
                textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '.5rem',
              }}>
                Already have an agent?
              </p>
              <div className="form-section" style={{ marginBottom: '10px' }}>
                <div className="input-wrap">
                  <input
                    id="connect-name-input"
                    type="text"
                    value={connectName}
                    onChange={(e) => setConnectName(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ''))}
                    placeholder="Enter your agent name"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    aria-label="Agent name"
                  />
                  {nameInfo.status === 'found' && (
                    <span className="input-check" aria-hidden="true">✓</span>
                  )}
                </div>
                {nameInfo.status === 'checking' && (
                  <div className="field-hint checking" role="status" aria-live="polite">
                    <span className="spinner" aria-hidden="true" />
                    Checking…
                  </div>
                )}
                {nameInfo.status === 'none' && (
                  <div className="field-hint none" role="status" aria-live="polite">
                    No agent found — new here? Create one below.
                  </div>
                )}
                {nameInfo.status === 'found' && (
                  <div className="field-hint found" role="status" aria-live="polite">
                    ✓ Found <strong>{nameInfo.name}</strong>
                  </div>
                )}
              </div>

              {nameInfo.status === 'found' && (
                <div className="connect-actions" style={{ marginTop: '0' }}>
                  {nameInfo.hasPasskey && hasLocalDelegation(nameInfo.name!) && (
                    <button className="cta" disabled={busy} onClick={() => onConnectName('passkey')}>
                      {busy ? <span className="spinner" aria-hidden="true" /> : null}
                      Continue with passkey →
                    </button>
                  )}
                  {nameInfo.hasPasskey && !hasLocalDelegation(nameInfo.name!) && (
                    <>
                      <button className="cta" disabled={busy} onClick={() => onAddSite(nameInfo.name!)}>
                        {busy ? <span className="spinner" aria-hidden="true" /> : null}
                        Set up this site →
                      </button>
                      <p className="muted" style={{ margin: '.25rem 0 0', textAlign: 'center', fontSize: '.8rem' }}>
                        Approve once with your passkey — future sign-ins are one tap.
                      </p>
                    </>
                  )}
                  {nameInfo.hasEoa && (
                    <button className="cta ghost" disabled={busy} onClick={() => onConnectName('wallet')}>
                      Continue with wallet
                    </button>
                  )}
                </div>
              )}

              {connectErr && (
                <div className="inline-err" role="alert" style={{ marginTop: '.5rem' }}>
                  <span aria-hidden="true">⛔</span> {connectErr}
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="divider">or create a new agent</div>

            {/* ── New agent sign-up ──────────────────────────────── */}
            <div style={{ marginBottom: '1rem' }}>
              <div className="form-section" style={{ marginBottom: '10px' }}>
                <p style={{
                  fontSize: '.72rem', fontWeight: 700, color: 'var(--c-g400)',
                  textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '.5rem',
                }}>
                  Choose your agent name
                </p>
                <div className="input-wrap">
                  <input
                    id="signup-name-input"
                    type="text"
                    value={desiredName}
                    onChange={(e) =>
                      setDesiredName(e.target.value.toLowerCase().replace(/\.demo\.agent$/, '').replace(/[^a-z0-9-]/g, ''))
                    }
                    placeholder="e.g. alice"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    aria-label="Choose your agent name"
                  />
                  {desiredName && signupAvail === 'available' && (
                    <span className="input-check" aria-hidden="true">✓</span>
                  )}
                </div>
                {desiredName && (
                  <div style={{ marginTop: '.3rem', fontSize: '.78rem', color: 'var(--c-g400)', fontFamily: "'SF Mono','Roboto Mono',monospace" }}>
                    {desiredName}.demo.agent
                  </div>
                )}
                {desiredName && signupAvail === 'checking' && (
                  <div className="field-hint checking" role="status" aria-live="polite">
                    <span className="spinner" aria-hidden="true" />
                    Checking availability…
                  </div>
                )}
                {desiredName && signupAvail === 'available' && (
                  <div className="field-hint available" role="status" aria-live="polite">
                    ✓ {desiredName}.demo.agent is available
                  </div>
                )}
                {desiredName && signupAvail === 'taken' && (
                  <div role="alert">
                    <div className="field-hint taken">{desiredName}.demo.agent is already taken.</div>
                    <button
                      className="inline"
                      style={{ marginTop: '.3rem' }}
                      onClick={() => {
                        setConnectName(desiredName);
                        setDesiredName('');
                        setSignupAvail('idle');
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      Connect to {desiredName}.demo.agent instead
                    </button>
                  </div>
                )}
              </div>

              <div className="connect-actions" style={{ marginTop: 0 }}>
                <button className="cta" disabled={signupAvail !== 'available'} onClick={() => onSignup('passkey')}>
                  Create my Smart Agent →
                </button>
                {hasWallet() && (
                  <button className="cta ghost" disabled={signupAvail !== 'available'} onClick={() => onSignup('wallet')}>
                    Create with wallet
                  </button>
                )}
                {!hasWallet() && signupAvail !== 'available' && (
                  <p className="muted" style={{ textAlign: 'center', fontSize: '.8rem', marginTop: '.25rem' }}>
                    Uses a passkey — no browser wallet required.
                  </p>
                )}
              </div>
            </div>

            <div className="privacy-footer">
              🔒 You're in control. Your data stays private.
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          SIGNED-IN DASHBOARD
          ════════════════════════════════════════════════════════════ */}
      {session && (
        <>
          <div className="app-shell dashboard">

            {/* Smart Agent ID card — hero for both fresh arrival and returning */}
            {session.fresh ? (
              <div className="agent-id-card" aria-label="Your Smart Agent">
                <div className="agent-id-eyebrow">
                  <ShieldLogo size={18} />
                  Personal Smart Agent
                </div>
                <div className="agent-id-name">{session.name}</div>
                <button
                  className="addr-chip"
                  onClick={() => navigator.clipboard?.writeText(session.address)}
                  title="Copy address"
                  aria-label="Copy agent address"
                  style={{ marginTop: '.5rem' }}
                >
                  {short(session.address)}
                  <span className="addr-chip-copy" aria-hidden="true">⎘</span>
                </button>
                <div className="agent-id-owned">
                  <span className="agent-id-owned-dot" aria-hidden="true" />
                  Owned by you · Base Sepolia
                </div>
                {orgs.length > 0 && (
                  <div className="agent-id-orgs" aria-label="Organizations you govern">
                    {orgs.map((o) => (
                      <span key={o.orgAgent} className="agent-id-org-chip">
                        🏛 {o.orgName}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="dash-header">
                  <h1 style={{ color: 'var(--c-g900)' }}>{session.name}</h1>
                  <div className="dash-sub">
                    Active · Base Sepolia
                  </div>
                </div>
                <div className="card" style={{ marginBottom: '10px' }}>
                  <div className="card-row">
                    <div className="card-row-icon blue" aria-hidden="true">
                      <ShieldLogo size={22} />
                    </div>
                    <div className="card-row-meta">
                      <div className="card-row-label">Smart Agent</div>
                      <button
                        className="addr-chip"
                        onClick={() => navigator.clipboard?.writeText(session.address)}
                        title="Copy address"
                        aria-label="Copy agent address"
                      >
                        {short(session.address)}
                        <span className="addr-chip-copy" aria-hidden="true">⎘</span>
                      </button>
                    </div>
                    <span className="card-chevron" aria-hidden="true">›</span>
                  </div>
                </div>
              </>
            )}

            {/* Connected Apps card */}
            <div className="card" style={{ marginBottom: '10px' }}>
              <div className="card-row" style={{ marginBottom: '.625rem' }}>
                <div className="card-row-icon purple" aria-hidden="true">
                  {/* Grid icon */}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                    <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                  </svg>
                </div>
                <div className="card-row-meta">
                  <div className="card-row-label">Connected Apps</div>
                </div>
              </div>
              <div style={{ textAlign: 'center', padding: '.375rem 0 .125rem', color: 'var(--c-g400)', fontSize: '.8375rem' }}>
                <div style={{ fontSize: '1.375rem', marginBottom: '.3rem' }} aria-hidden="true">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--c-g200)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block' }}>
                    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>
                  </svg>
                </div>
                <div style={{ fontWeight: 600, color: 'var(--c-g700)' }}>Agentic Org is connected</div>
                <div style={{ fontSize: '.76rem', marginTop: '.2rem' }}>This site can read your approved data.</div>
              </div>
            </div>

            {/* Sensitive Data section header */}
            <div style={{ marginBottom: '6px' }}>
              <h3>Sensitive Data</h3>
            </div>

            {/* Profile / Contact data (passkey sessions only) */}
            {session.via === 'passkey' && (
              <div className="card" style={{ marginBottom: '10px' }}>
                <div className="section-header" style={{ marginBottom: personData && 'record' in personData && personData.record != null ? '.75rem' : '0' }}>
                  <div className="card-row" style={{ flex: 1 }}>
                    <div className="card-row-icon green" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                        <circle cx="12" cy="7" r="4"/>
                      </svg>
                    </div>
                    <div className="card-row-meta">
                      <div className="card-row-label">Profile · Contact data</div>
                      <div className="card-row-sub">Email, phone and more</div>
                    </div>
                  </div>
                  {personData && 'record' in personData && personData.record != null ? (
                    <button
                      className="inline"
                      onClick={() => setPersonData(null)}
                      aria-label="Hide contact details"
                    >
                      Hide
                    </button>
                  ) : (
                    <span className="card-chevron" aria-hidden="true">›</span>
                  )}
                </div>

                {/* Locked state */}
                {!personData && (
                  <div className="sensitive-block">
                    <div className="sensitive-header">
                      <span className="sensitive-label">
                        <span className="lock-icon" aria-hidden="true">🔒</span>
                        Protected
                      </span>
                      <span style={{ fontSize: '.75rem', color: 'var(--c-g400)' }}>Confirm to view</span>
                    </div>
                    <div aria-hidden="true">
                      <div className="pii-mask">
                        <span className="pii-icon">✉</span>
                        <span style={{ letterSpacing: '.12em' }}>▒▒▒▒▒▒▒@▒▒▒▒.▒▒▒</span>
                      </div>
                      <div className="pii-mask">
                        <span className="pii-icon">📞</span>
                        <span style={{ letterSpacing: '.12em' }}>+1 ▒▒▒ ▒▒▒ ▒▒▒▒</span>
                      </div>
                    </div>
                    <button
                      className="cta"
                      style={{ marginTop: '.875rem' }}
                      onClick={onViewPersonData}
                      aria-label="Confirm to view contact details"
                    >
                      Confirm to view
                    </button>
                  </div>
                )}

                {/* Loading */}
                {personData?.loading && (
                  <div className="sensitive-block" style={{ textAlign: 'center', padding: '1.25rem' }}>
                    <span className="spinner spinner-lg" aria-label="Loading contact details" />
                    <p className="muted" style={{ marginTop: '.75rem', marginBottom: 0 }}>Reading…</p>
                  </div>
                )}

                {/* Error */}
                {personData?.error && (
                  <div className="inline-err" role="alert">
                    <span aria-hidden="true">⛔</span> {personData.error}
                  </div>
                )}

                {/* Revealed */}
                {personData && 'record' in personData && personData.record != null && (
                  <div className="sensitive-block revealed">
                    <div className="sensitive-header">
                      <span className="sensitive-label" style={{ color: 'var(--c-success)' }}>
                        <span aria-hidden="true">✓</span> Contact details
                      </span>
                    </div>
                    <RecordRows record={personData.record} />
                    <div className="shared-note">
                      <span className="shared-note-dot" aria-hidden="true" />
                      Shared with: this app only
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Organizations */}
            <div className="card" style={{ marginBottom: '10px' }}>
              <div style={{ marginBottom: orgs.length > 0 ? '.75rem' : '0' }}>
                <div className="card-row">
                  <div className="card-row-icon purple" aria-hidden="true">🏛</div>
                  <div className="card-row-meta">
                    <div className="card-row-label">Organizations</div>
                    <div className="card-row-sub">
                      {orgs.length === 0 ? 'None yet' : `${orgs.length} organization${orgs.length === 1 ? '' : 's'}`}
                    </div>
                  </div>
                  <span className="card-chevron" aria-hidden="true">›</span>
                </div>
              </div>

              {orgs.length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  {orgs.map((o) => {
                    const data = orgData[o.orgAgent];
                    return (
                      <div key={o.orgAgent} className="org-item">
                        <div className="org-row">
                          <div className="org-meta">
                            <div className="org-name">{o.orgName}</div>
                            <div className="org-addr">{short(o.orgAgent)}</div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '.375rem', flexShrink: 0 }}>
                            {o.governed ? (
                              <span className="badge success">Governance</span>
                            ) : (
                              <span className="badge">Created</span>
                            )}
                            {!(data && 'record' in data && data.record != null) && (
                              <button
                                className="ghost"
                                style={{ fontSize: '.78rem', padding: '.35rem .75rem', minHeight: '36px' }}
                                disabled={data?.loading}
                                onClick={() => onViewOrgData(o)}
                                aria-label={`View details for ${o.orgName}`}
                              >
                                {data?.loading ? (
                                  <>
                                    <span className="spinner" aria-hidden="true" />
                                    Reading…
                                  </>
                                ) : (
                                  'View details'
                                )}
                              </button>
                            )}
                          </div>
                        </div>

                        {data?.loading && (
                          <div className="sensitive-block" style={{ marginTop: '.625rem', textAlign: 'center', padding: '.875rem' }}>
                            <span className="spinner" aria-label={`Loading ${o.orgName} details`} />
                          </div>
                        )}

                        {data?.error && (
                          <div className="inline-err" style={{ marginTop: '.4rem' }} role="alert">
                            <span aria-hidden="true">⛔</span> {data.error}
                          </div>
                        )}

                        {data && 'record' in data && data.record != null && (
                          <div className="sensitive-block revealed" style={{ marginTop: '.625rem' }}>
                            <div className="sensitive-header">
                              <span className="sensitive-label" style={{ color: 'var(--c-success)' }}>
                                <span aria-hidden="true">✓</span> {o.orgName}
                              </span>
                              <button
                                className="inline"
                                onClick={() => setOrgData((m) => {
                                  const next = { ...m };
                                  delete next[o.orgAgent];
                                  return next;
                                })}
                                aria-label={`Hide details for ${o.orgName}`}
                              >
                                Hide
                              </button>
                            </div>
                            <RecordRows record={data.record} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Create org sub-form */}
              <div style={{
                borderTop: orgs.length > 0 ? '1px solid var(--c-g100)' : 'none',
                paddingTop: orgs.length > 0 ? '.875rem' : '0',
              }}>
                <p style={{
                  fontSize: '.72rem', fontWeight: 700, color: 'var(--c-g400)',
                  textTransform: 'uppercase', letterSpacing: '.08em', margin: '0 0 .5rem',
                }}>
                  Create organization
                </p>
                <p className="muted" style={{ fontSize: '.8rem', marginBottom: '.75rem' }}>
                  Create an Organization Smart Agent secured by your passkey and linked to you on-chain.
                </p>
                <div className="form-section" style={{ marginBottom: '.625rem' }}>
                  <label htmlFor="org-name-input">Organization name</label>
                  <div className="input-wrap">
                    <input
                      id="org-name-input"
                      type="text"
                      value={orgName}
                      onChange={(e) =>
                        setOrgName(e.target.value.toLowerCase().replace(/\.demo\.agent$/, '').replace(/[^a-z0-9-]/g, ''))
                      }
                      placeholder="e.g. acme"
                      autoCapitalize="none"
                      spellCheck={false}
                    />
                    {orgName && orgAvail === 'available' && (
                      <span className="input-check" aria-hidden="true">✓</span>
                    )}
                  </div>
                  {orgName && (
                    <div style={{ marginTop: '.3rem', fontSize: '.76rem', color: 'var(--c-g400)', fontFamily: "'SF Mono','Roboto Mono',monospace" }}>
                      {orgName}.demo.agent
                    </div>
                  )}
                  {orgName && orgAvail === 'checking' && (
                    <div className="field-hint checking" role="status" aria-live="polite">
                      <span className="spinner" aria-hidden="true" />
                      Checking…
                    </div>
                  )}
                  {orgName && orgAvail === 'available' && (
                    <div className="field-hint available" role="status" aria-live="polite">
                      ✓ {orgName}.demo.agent is available
                    </div>
                  )}
                  {orgName && orgAvail === 'taken' && (
                    <div className="field-hint taken" role="alert">
                      {orgName}.demo.agent is taken — choose another name.
                    </div>
                  )}
                </div>
                <button className="cta" disabled={orgAvail !== 'available'} onClick={onCreateOrg}>
                  Create organization
                </button>
              </div>
            </div>

            {/* Treasury — Soon */}
            <div className="card" style={{ marginBottom: '10px', opacity: .65 }}>
              <div className="card-row">
                <div className="card-row-icon amber" aria-hidden="true">💰</div>
                <div className="card-row-meta">
                  <div className="card-row-label">
                    Treasury
                    <span className="badge soon">Soon</span>
                  </div>
                  <div className="card-row-sub">On-chain balances and transfers</div>
                </div>
              </div>
            </div>

            {/* Permissions — Soon */}
            <div className="card" style={{ marginBottom: '10px', opacity: .65 }}>
              <div className="card-row">
                <div className="card-row-icon purple" aria-hidden="true">🔐</div>
                <div className="card-row-meta">
                  <div className="card-row-label">
                    Permissions
                    <span className="badge soon">Soon</span>
                  </div>
                  <div className="card-row-sub">Review and revoke app access</div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{ padding: '.75rem 0 1.5rem', textAlign: 'center', fontSize: '.72rem', color: 'var(--c-g300)', letterSpacing: '.02em' }}>
              Real on Base Sepolia (chain 84532)
            </div>
          </div>

          {/* ── Bottom tab bar ──────────────────────────────────── */}
          <nav className="tab-bar" aria-label="Main sections">
            <div className="tab-bar-inner">
              <button className="tab-item active" aria-current="page">
                <span className="tab-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                </span>
                Profile
              </button>
              <button className="tab-item">
                <span className="tab-icon" aria-hidden="true">🏛</span>
                Orgs
              </button>
              <button className="tab-item" aria-disabled="true">
                <span className="tab-soon" aria-hidden="true">Soon</span>
                <span className="tab-icon" aria-hidden="true">💰</span>
                Treasury
              </button>
              <button className="tab-item" aria-disabled="true">
                <span className="tab-soon" aria-hidden="true">Soon</span>
                <span className="tab-icon" aria-hidden="true">🔐</span>
                Perms
              </button>
            </div>
          </nav>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════
          PROGRESS MODAL / BOTTOM SHEET
          ════════════════════════════════════════════════════════════ */}
      {flow && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className="modal">

            {flow.phase === 'running' && (
              <div className="step-indicator" aria-label="In progress">
                <div className="step-dots" aria-hidden="true">
                  <span className="step-dot active" />
                  <span className="step-dot" />
                </div>
                In progress
              </div>
            )}

            <h2 id="modal-title">{flow.title}</h2>

            {/* Running */}
            {flow.phase === 'running' && (
              <>
                {flow.steps.length === 0 ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '.75rem 0 .5rem' }}>
                    <span className="spinner spinner-lg" aria-label="Working…" />
                  </div>
                ) : (
                  <ol className="steps" aria-label="Progress steps">
                    {flow.steps.map((s, i) => {
                      const isLast = i === flow.steps.length - 1;
                      const done = !isLast;
                      const current = isLast;
                      return (
                        <li key={i} className={done ? 'done' : current ? 'current' : 'pending'}>
                          <span className="step-icon" aria-hidden="true">
                            {current
                              ? <span className="spinner" />
                              : done
                                ? '✓'
                                : '•'}
                          </span>
                          {s}
                        </li>
                      );
                    })}
                  </ol>
                )}
                <p className="muted" style={{ fontSize: '.875rem', marginBottom: 0 }}>
                  Your device may ask you to confirm. This usually takes a few seconds.
                </p>
              </>
            )}

            {/* Done — with reward chips */}
            {flow.phase === 'done' && (
              <>
                {flow.steps.length > 0 && (
                  <ol className="steps" aria-label="Completed steps">
                    {flow.steps.map((s, i) => (
                      <li key={i} className="done">
                        <span className="step-icon" aria-hidden="true">✓</span>
                        {s}
                      </li>
                    ))}
                  </ol>
                )}
                {flow.title.includes('Organization') && (
                  <div className="reward-row" aria-label="What you earned">
                    <span className="reward-chip">
                      <span className="reward-chip-icon" aria-hidden="true">✓</span>
                      Organization — you govern
                    </span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'center', padding: '.5rem 0' }}>
                  <span className="spinner spinner-lg" aria-label="Finishing…" />
                </div>
              </>
            )}

            {/* Error */}
            {flow.phase === 'error' && (
              <>
                {flow.steps.length > 0 && (
                  <ol className="steps" aria-label="Steps taken">
                    {flow.steps.map((s, i) => (
                      <li key={i} className="done">
                        <span className="step-icon" aria-hidden="true">✓</span>
                        {s}
                      </li>
                    ))}
                  </ol>
                )}
                <div
                  role="alert"
                  style={{
                    background: 'var(--c-danger-bg)',
                    border: '1px solid var(--c-danger-border)',
                    borderRadius: 'var(--r-md)',
                    padding: '.75rem 1rem',
                    color: 'var(--c-danger)',
                    fontSize: '.875rem',
                    marginBottom: '.75rem',
                  }}
                >
                  {flow.error}
                </div>
                <p className="muted" style={{ fontSize: '.875rem', marginBottom: '.875rem' }}>
                  Nothing was changed. You can try again.
                </p>
                <button className="cta ghost" onClick={() => setFlow(null)}>
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
