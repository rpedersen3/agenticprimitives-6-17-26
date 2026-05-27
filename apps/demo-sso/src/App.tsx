import { useCallback, useEffect, useState } from 'react';
import type { Address, Hex } from '@agenticprimitives/types';
import {
  AUD,
  signupWithName,
  stepUpToAgent,
  connectWithName,
  provisionA2aAgent,
  createChildAgentForSite,
  addWalletCredential,
  addPasskeyCredential,
  passkeySignHash,
  fetchProfile,
  fetchSensitive,
  type BasicProfile,
} from './connect-client';
import { issueSiteDelegation, toWire } from './lib/delegation';
import { loadPasskey } from './lib/passkey';
import { hasWallet } from './lib/wallet';
import { startGoogleSignIn, exchangeCode } from './server-client';

interface Session {
  token: string;
  via: string; // 'wallet' | 'Google'
  fresh: boolean; // true = just created (welcome) vs reconnected (welcome back)
}

const SESSION_KEY = 'agenticprimitives:demo-sso:session';

/** True iff we should try to restore a persisted session on load — i.e. one is stored
 *  AND we're not mid Google-redirect (?code) or central-auth enrollment (?enroll_digest). */
function shouldRestore(): boolean {
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.has('code') || u.searchParams.has('connect_status') || u.searchParams.has('delegate')) {
      return false;
    }
    return !!localStorage.getItem(SESSION_KEY);
  } catch {
    return false;
  }
}

// ── OIDC authorization endpoint (spec 230) ──────────────────────────
// A relying site redirects here (`/authorize`, code + S256 PKCE) to sign the person in.
// This origin is the OpenID Provider: the ROOT passkey ceremony authenticates the person,
// /oidc/grant mints the id_token + a single-use code, and the relying site exchanges the
// code at /token for { id_token, delegation }. Identity = id_token; authority = the scoped
// delegation (ADR-0019). Internal field names kept terse; param names are standard OIDC.
interface EnrollReq {
  aud: string; // = client_id
  redirectUri: string; // = redirect_uri (exact-match in the registry)
  state: string;
  name: string; // = agent_name (the person to sign in / govern)
  delegate: Address; // the relying site's delegate Smart Account (delegation recipient)
  nonce: string;
  codeChallenge: string; // PKCE S256 challenge
  template: string; // delegation_template: 'site-login' | 'org-create'
  orgBase?: string; // org_create: the org name to create
}
/** Relying sites permitted to start an authorization (demo gate — spec 230 §6 + §8). */
const ALLOWED_RELYING_ORIGINS = ['https://agenticprimitives-demo-org.pages.dev'];
function parseEnrollReq(): EnrollReq | null {
  try {
    const p = new URL(window.location.href).searchParams;
    const clientId = p.get('client_id');
    const redirectUri = p.get('redirect_uri');
    const agentName = p.get('agent_name');
    const delegate = p.get('delegate');
    const codeChallenge = p.get('code_challenge');
    const template = p.get('delegation_template');
    if (!clientId || !redirectUri || !agentName || !delegate || !codeChallenge || !template) return null;
    // Code flow + S256 PKCE only (spec 230 §4.1/§8).
    const responseType = p.get('response_type');
    if (responseType && responseType !== 'code') return null;
    const ccm = p.get('code_challenge_method');
    if (ccm && ccm !== 'S256') return null;
    return {
      aud: clientId,
      redirectUri,
      state: p.get('state') ?? '',
      name: agentName,
      delegate: delegate as Address,
      nonce: p.get('nonce') ?? '',
      codeChallenge,
      template,
      orgBase: p.get('org_base') ?? undefined,
    };
  } catch {
    return null;
  }
}
function relyingAllowed(redirectUri: string): boolean {
  try {
    return ALLOWED_RELYING_ORIGINS.includes(new URL(redirectUri).origin);
  } catch {
    return false;
  }
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState<boolean>(shouldRestore);
  const [profile, setProfile] = useState<BasicProfile | null>(null);
  const [signupAvail, setSignupAvail] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  // Live signup progress, rendered as a modal checklist.
  const [signup, setSignup] = useState<
    | { phase: 'running' | 'done'; steps: string[] }
    | { phase: 'error'; steps: string[]; error: string }
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sensitive, setSensitive] = useState<{ email: string; phone: string } | null>(null);
  const [stepUpMsg, setStepUpMsg] = useState<string | null>(null);
  const [desiredName, setDesiredName] = useState('');
  const [connectName, setConnectName] = useState('');
  const [connectErr, setConnectErr] = useState<string | null>(null);
  const [nameInfo, setNameInfo] = useState<{
    status: 'idle' | 'checking' | 'none' | 'found';
    name?: string;
    hasEoa?: boolean;
    hasPasskey?: boolean;
  }>({ status: 'idle' });
  const [googleNotice, setGoogleNotice] = useState<string | null>(null);
  const [service, setService] = useState<{ step?: string; error?: string; a2aAgent?: string } | null>(null);
  const [addCred, setAddCred] = useState<{ step?: string; error?: string; done?: string } | null>(null);
  // Central-auth enrollment request (when a relying site redirects here).
  const [enrollReq] = useState<EnrollReq | null>(parseEnrollReq);
  const [enrollFlow, setEnrollFlow] = useState<{ phase: 'idle' | 'running' | 'error'; msg?: string; error?: string }>({
    phase: 'idle',
  });
  // Does the requested name already have an agent on-chain? null = checking.
  // New user (no agent) → create the account here first (E1); existing → enroll-only (E2).
  const [enrollExists, setEnrollExists] = useState<boolean | null>(enrollReq ? null : false);

  const openSession = useCallback(async (token: string, via: string, fresh: boolean) => {
    setSession({ token, via, fresh });
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ token, via })); // survive page refresh
    } catch {
      /* storage blocked (private mode) — session just won't persist */
    }
    setProfile(await fetchProfile(token));
  }, []);

  // Enrollment request → does the name already have an agent? (new user vs existing).
  useEffect(() => {
    if (!enrollReq) return;
    void (async () => {
      try {
        const r = await fetch(`/connect/name-info?name=${encodeURIComponent(enrollReq.name)}`);
        const b = (await r.json()) as { exists?: boolean };
        setEnrollExists(!!b.exists);
      } catch {
        setEnrollExists(false); // treat as new; the on-chain claim is still forced-unique
      }
    })();
  }, [enrollReq]);

  // Restore a persisted session on load (within the token's lifetime), unless we're
  // mid Google-redirect (?code / connect_status) — that path mints its own session.
  useEffect(() => {
    if (!restoring) return;
    void (async () => {
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return;
        const stored = JSON.parse(raw) as { token?: string; via?: string };
        if (!stored.token || !stored.via) {
          localStorage.removeItem(SESSION_KEY);
          return;
        }
        // Validate against the broker: an expired/invalid token yields no profile → drop it.
        const p = await fetchProfile(stored.token);
        if (!p) {
          localStorage.removeItem(SESSION_KEY);
          return;
        }
        setSession({ token: stored.token, via: stored.via, fresh: false });
        setProfile(p);
      } finally {
        setRestoring(false);
      }
    })();
  }, [restoring]);

  // Real Google OIDC return: ?code → exchange → token (login-grade session).
  useEffect(() => {
    const url = new URL(window.location.href);
    // Google bootstrap (no agent linked to this subject yet) — the callback redirects
    // back here with a status instead of dead-ending on a JSON page.
    const connectStatus = url.searchParams.get('connect_status');
    if (connectStatus) {
      const email = url.searchParams.get('email');
      const reason = url.searchParams.get('reason');
      if (connectStatus === 'linked') {
        setGoogleNotice(
          `✓ Google${email ? ` (${email})` : ''} is now linked to your workspace — next time you can sign in with Google.`,
        );
      } else if (connectStatus === 'link_failed') {
        setGoogleNotice(`Couldn't link Google: ${reason ?? 'please try again'}.`);
      } else {
        setGoogleNotice(
          `We recognized your Google account${email ? ` (${email})` : ''}, but no workspace is linked to it yet. ` +
            `Create one with a wallet/passkey — or sign in with your wallet/passkey and use "Link Google".`,
        );
      }
      for (const k of ['connect_status', 'via', 'email', 'reason']) url.searchParams.delete(k);
      window.history.replaceState({}, '', url.toString());
      return;
    }
    const code = url.searchParams.get('code');
    if (!code) return;
    (async () => {
      try {
        const token = await exchangeCode(code, AUD);
        await openSession(token, 'Google', true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Google sign-in failed');
      } finally {
        url.searchParams.delete('code');
        url.searchParams.delete('state');
        window.history.replaceState({}, '', url.toString());
      }
    })();
  }, [openSession]);

  // As the user types an agent name, check on-chain: does it exist, and which custody
  // credentials does it have? → only offer passkey / wallet that actually exist on it.
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
          b.exists
            ? { status: 'found', name: b.name, hasEoa: b.hasEoa, hasPasskey: b.hasPasskey }
            : { status: 'none' },
        );
      } catch {
        setNameInfo({ status: 'idle' });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [connectName]);

  // Signup name availability: block signing up with an EXISTING agent name.
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

  // Connect by agent-service name: resolve name → agent → prove with a custody
  // credential (the name is the identity; any custodian credential gets you in).
  async function onConnectName(via: 'wallet' | 'passkey') {
    if (!connectName.trim()) return;
    setConnectErr(null);
    setBusy(true);
    try {
      const out = await connectWithName(connectName.trim(), via);
      if (out.ok) await openSession(out.token, via, false);
      else setConnectErr(out.error);
    } catch (e) {
      setConnectErr(e instanceof Error ? e.message : 'connect failed');
    } finally {
      setBusy(false);
    }
  }

  // Sign up: create a NEW workspace with the chosen name + a fresh custody credential.
  // Blocked unless the name is available (not an existing agent name).
  async function onSignup(via: 'wallet' | 'passkey') {
    const base = desiredName.trim();
    if (!base || signupAvail !== 'available') return;
    setError(null);
    setBusy(true);
    const steps: string[] = [];
    setSignup({ phase: 'running', steps: [] });
    const onStep = (s: string) => {
      steps.push(s);
      setSignup({ phase: 'running', steps: [...steps] });
    };
    try {
      const out = await signupWithName(base, via, onStep);
      if (!out.ok) {
        setSignup({ phase: 'error', steps: [...steps], error: out.error });
        return;
      }
      // Show the finished checklist for a beat, then drop into the home page.
      setSignup({ phase: 'done', steps: [...steps] });
      await new Promise((r) => setTimeout(r, 900));
      await openSession(out.token, via, true);
      // Clear connect/signup inputs so no stale name lingers if the user signs out.
      setDesiredName('');
      setConnectName('');
      setSignupAvail('idle');
      setNameInfo({ status: 'idle' });
      setConnectErr(null);
      setSignup(null);
    } catch (e) {
      setSignup({ phase: 'error', steps: [...steps], error: e instanceof Error ? e.message : 'signup failed' });
    } finally {
      setBusy(false);
    }
  }

  async function onRevealSensitive() {
    if (!session) return;
    setStepUpMsg(null);
    // Login-grade (Google): the canonical agent is custody-controlled by a wallet/passkey,
    // so fire the wallet step-up IMMEDIATELY on this click (a gesture is required for the
    // wallet to prompt — so we can't auto-fire on render, but this is one click → MetaMask).
    if (session.via === 'Google') {
      await stepUp('wallet');
      return;
    }
    const r = await fetchSensitive(session.token);
    if (r.ok) setSensitive({ email: r.email, phone: r.phone });
    else setStepUpMsg(r.reason);
  }

  // Step a Google (login-grade) session UP to custody-grade for the SAME bound agent
  // (server enforces target = googleToken.sub). The credential must be a custodian of
  // that agent — so a Google login flows into exactly ONE workspace (ADR-0017).
  async function stepUp(via: 'wallet' | 'passkey') {
    if (!session) return;
    setStepUpMsg(`Confirming with your ${via === 'wallet' ? 'wallet' : 'device'}…`);
    try {
      const out = await stepUpToAgent(via, session.token);
      if (!out.ok) {
        setStepUpMsg(out.error);
        return;
      }
      await openSession(out.token, via, false); // custody-grade for the SAME agent
      setStepUpMsg(null);
      const r = await fetchSensitive(out.token); // auto-reveal now that we're custody-grade
      if (r.ok) setSensitive({ email: r.email, phone: r.phone });
    } catch (e) {
      setStepUpMsg(e instanceof Error ? e.message : 'step-up failed');
    }
  }

  async function onProvisionService() {
    if (!session || !profile || session.via === 'Google') return;
    const personAddr = profile.agent.split(':').pop() as Address;
    setService({ step: 'Starting…' });
    const res = await provisionA2aAgent(session.via as 'wallet' | 'passkey', personAddr, (step) =>
      setService((s) => ({ ...s, step })),
    );
    setService(res.ok ? { a2aAgent: res.result.a2aAgent } : { error: res.error });
  }

  // Add the COMPLEMENTARY custody credential to this agent: wallet→add passkey,
  // passkey→add wallet. The existing credential signs the on-chain addCustodian/
  // addPasskey; the SA address is unchanged (ADR-0011).
  async function onAddCredential() {
    if (!session || !profile || session.via === 'Google') return;
    const personAddr = profile.agent.split(':').pop() as Address;
    setAddCred({ step: 'Starting…' });
    try {
      const onStep = (s: string) => setAddCred({ step: s });
      if (session.via === 'passkey') {
        const r = await addWalletCredential(personAddr, onStep);
        setAddCred(r.ok ? { done: `Wallet ${r.added.slice(0, 6)}…${r.added.slice(-4)} added` } : { error: r.error });
      } else {
        const r = await addPasskeyCredential(personAddr, onStep);
        setAddCred(r.ok ? { done: 'Passkey added' } : { error: r.error });
      }
    } catch (e) {
      setAddCred({ error: e instanceof Error ? e.message : 'add credential failed' });
    }
  }

  function signOut() {
    setSession(null);
    setProfile(null);
    setSensitive(null);
    setStepUpMsg(null);
    setService(null);
    setAddCred(null);
    setError(null);
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    // Reset the connect/signup screen so a just-used name doesn't linger as stale.
    setDesiredName('');
    setConnectName('');
    setSignupAvail('idle');
    setNameInfo({ status: 'idle' });
    setConnectErr(null);
  }

  // Approve the relying site's request. Two paths (spec 229 §5):
  //  · NEW user (name has no agent yet): create the home account here first — a ROOT
  //    passkey on THIS origin + deploy the agent + claim the name — THEN add the site's
  //    public key as a custodian.
  //  · EXISTING agent: just add the site's public key, signed by the primary passkey here.
  // Popup mode: opened by a relying site via window.open(?mode=popup). We post the result
  // back to the opener instead of redirecting, then self-close.
  const popupMode =
    !!enrollReq && !!window.opener && new URL(window.location.href).searchParams.get('mode') === 'popup';
  // Post to the opener ONLY at the validated relying origin (audit F3 — exact targetOrigin,
  // never '*'); refuse if the redirect_uri isn't an allowed relying origin.
  function postToOpener(msg: Record<string, unknown>) {
    if (!enrollReq || !window.opener || !relyingAllowed(enrollReq.redirectUri)) return;
    try {
      window.opener.postMessage(msg, new URL(enrollReq.redirectUri).origin);
    } catch {
      /* ignore */
    }
  }

  // Turn the verified ROOT-passkey ceremony into an OIDC authorization code (spec 230 §4.2):
  // POST the passkey proof + the client-signed delegation (+ org payload) to /oidc/grant,
  // which mints the id_token and stashes {id_token, delegation, org} under a single-use code
  // bound to the PKCE code_challenge. Returns the code; the relying site exchanges it at /token.
  async function submitGrant(resolvedName: string, delegationWire: unknown, org?: unknown): Promise<string> {
    if (!enrollReq) throw new Error('no request');
    const pk = loadPasskey();
    if (!pk) throw new Error('No central-auth passkey on this device.');
    const { challenge } = (await (await fetch('/connect/passkey-challenge')).json()) as { challenge: Hex };
    const signature = await passkeySignHash(challenge); // ROOT passkey proof-of-possession
    const r = await fetch('/oidc/grant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        credentialIdDigest: pk.credentialIdDigest,
        pubKeyX: pk.pubKeyX.toString(),
        pubKeyY: pk.pubKeyY.toString(),
        challenge,
        signature,
        client_id: enrollReq.aud,
        redirect_uri: enrollReq.redirectUri,
        nonce: enrollReq.nonce,
        code_challenge: enrollReq.codeChallenge,
        agent_name: resolvedName,
        delegation_template: enrollReq.template,
        delegation: delegationWire,
        org,
      }),
    });
    const b = (await r.json().catch(() => ({}))) as { code?: string; error?: string };
    if (!r.ok || !b.code) throw new Error(b.error ?? `grant failed (HTTP ${r.status})`);
    return b.code;
  }

  // Deliver the authorization code back to the relying site (popup postMessage, exact origin;
  // or full-page redirect ?code&state). The token never travels in the URL — only the code.
  function deliverCode(code: string) {
    if (!enrollReq) return;
    if (popupMode) {
      postToOpener({ type: 'AC_SUCCESS', state: enrollReq.state, code });
      window.close();
      return;
    }
    const url = new URL(enrollReq.redirectUri);
    url.searchParams.set('code', code);
    url.searchParams.set('state', enrollReq.state);
    window.location.href = url.toString();
  }

  // site-login: sign the person in (create their home account first if new), issue the scoped
  // person → site-delegate delegation (ADR-0019), and mint the OIDC code.
  async function approveEnroll() {
    if (!enrollReq) return;
    const onStep = (s: string) => {
      setEnrollFlow({ phase: 'running', msg: s });
      if (popupMode) postToOpener({ type: 'AC_PROGRESS', msg: s });
    };
    setEnrollFlow({ phase: 'running', msg: 'Starting…' });
    try {
      let resolvedName = enrollReq.name;
      if (!enrollExists) {
        const base = enrollReq.name.replace(/\.demo\.agent$/, '');
        const created = await signupWithName(base, 'passkey', onStep, false); // grant signs in (skip extra prompt)
        if (!created.ok) {
          setEnrollFlow({ phase: 'error', error: created.error });
          return;
        }
        resolvedName = created.name;
      }
      onStep('Authorizing the site…');
      const info = (await (await fetch(`/connect/name-info?name=${encodeURIComponent(resolvedName)}`)).json()) as {
        agent?: Address;
      };
      if (!info.agent) {
        setEnrollFlow({ phase: 'error', error: `could not resolve ${resolvedName}` });
        return;
      }
      const delegation = await issueSiteDelegation(info.agent, enrollReq.delegate, passkeySignHash);
      const code = await submitGrant(resolvedName, toWire(delegation));
      deliverCode(code);
    } catch (e) {
      setEnrollFlow({ phase: 'error', error: e instanceof Error ? e.message : 'enrollment failed' });
    }
  }

  // org-create (memory project_demo_org_durable_org_custody): create a child agent (org now;
  // any service agent later) custodied by the person's ROOT passkey HERE; hand the relying site
  // a scoped child→site delegation (the OIDC delegation sidecar) + the org payload. Never a custodian.
  async function approveCreateOrg() {
    if (!enrollReq?.orgBase) return;
    const onStep = (s: string) => {
      setEnrollFlow({ phase: 'running', msg: s });
      if (popupMode) postToOpener({ type: 'AC_PROGRESS', msg: s });
    };
    setEnrollFlow({ phase: 'running', msg: 'Starting…' });
    try {
      const info = (await (await fetch(`/connect/name-info?name=${encodeURIComponent(enrollReq.name)}`)).json()) as {
        agent?: Address;
      };
      if (!info.agent) {
        setEnrollFlow({ phase: 'error', error: `could not resolve ${enrollReq.name}` });
        return;
      }
      const created = await createChildAgentForSite(info.agent, enrollReq.orgBase, enrollReq.delegate, onStep);
      if (!created.ok) {
        setEnrollFlow({ phase: 'error', error: created.error });
        return;
      }
      const org = {
        orgAgent: created.result.childAgent,
        orgName: created.result.childName,
        edgeId: created.result.edgeId,
        governed: created.result.governed,
      };
      // The org→site delegation is the OIDC delegation sidecar; the org payload rides alongside.
      const code = await submitGrant(enrollReq.name, created.result.delegation, org);
      deliverCode(code);
    } catch (e) {
      setEnrollFlow({ phase: 'error', error: e instanceof Error ? e.message : 'org creation failed' });
    }
  }
  function denyEnroll() {
    if (!enrollReq) return;
    if (popupMode) {
      postToOpener({ type: 'AC_CANCEL', state: enrollReq.state });
      window.close();
      return;
    }
    const url = new URL(enrollReq.redirectUri);
    url.searchParams.set('enroll_error', 'denied');
    url.searchParams.set('state', enrollReq.state);
    window.location.href = url.toString();
  }

  // ── Central-auth enrollment consent (renders INSTEAD of the normal app) ──
  if (enrollReq) {
    const host = (() => {
      try {
        return new URL(enrollReq.redirectUri).host;
      } catch {
        return enrollReq.aud;
      }
    })();
    const allowed = relyingAllowed(enrollReq.redirectUri);
    const isNew = enrollExists === false; // name has no agent yet → create the home account
    const running = enrollFlow.phase === 'running';
    const orgName = enrollReq.orgBase ? `${enrollReq.orgBase.replace(/\.demo\.agent$/, '')}.demo.agent` : '';
    return (
      <div>
        <h1>Agentic Connect — your secure home</h1>
        <div className="panel broker">
          {!allowed ? (
            <>
              <h2>This request can’t be approved</h2>
              <p className="err">
                ⛔ <strong>{host}</strong> isn’t a site we recognize. For your safety, this request was blocked.
              </p>
              <p className="muted">Only start account setup from a site you trust.</p>
            </>
          ) : enrollReq.orgBase ? (
            <>
              <h2>Create a new organization?</h2>
              <p>
                <strong>{host}</strong> wants to create an organization under your identity:
              </p>
              <p style={{ fontSize: '1.2rem', margin: '0.3rem 0' }}>
                <code>{orgName}</code>
              </p>
              <p className="muted" style={{ margin: '0.4rem 0' }}>
                <strong>What this does:</strong>
                <br />· Deploys a new Smart Agent <code>{orgName}</code>, custodied by <strong>your central-auth
                passkey</strong> — the same key that secures <code>{enrollReq.name}</code>
                <br />· Records on-chain that you govern it (<code>{enrollReq.name}</code> → governs → {orgName})
                <br />· Grants {host} <em>scoped, revocable</em> access to act for this organization — it never
                becomes a custodian
              </p>
              <p className="muted" style={{ margin: '0.4rem 0' }}>
                <strong>What it does NOT do:</strong>
                <br />· The organization is controlled by <strong>you</strong> (your passkey), not by {host}, and not
                by your personal agent
              </p>
              <p className="muted">No charge — on a public test network (no real funds).</p>
              {running && <p className="ok">⏳ {enrollFlow.msg}</p>}
              {running && <p className="muted">Confirm any device prompt. This can take 15–30s.</p>}
              {enrollFlow.phase === 'error' && (
                <>
                  <p className="err">⛔ {enrollFlow.error}</p>
                  <p className="muted">Nothing was charged. You can try again or cancel.</p>
                </>
              )}
              {!running && (
                <p>
                  <button onClick={approveCreateOrg}>Create &amp; approve with your device</button>{' '}
                  <button className="ghost" onClick={denyEnroll}>Cancel</button>
                </p>
              )}
            </>
          ) : enrollExists === null ? (
            <>
              <h2>One moment…</h2>
              <p className="muted">Checking your account…</p>
            </>
          ) : (
            <>
              <h2>{isNew ? 'Agentic Org is setting up your account' : `Add ${host} to your account?`}</h2>
              <p>
                <strong>{host}</strong> wants to add a sign-in key for:
              </p>
              <p style={{ fontSize: '1.2rem', margin: '0.3rem 0' }}>
                <code>{enrollReq.name}</code>
              </p>
              {/* The exact delegate the authority is granted to — consent binds to it (audit F2). */}
              <p className="muted" style={{ margin: '0 0 0.4rem' }}>
                Authorizing site account: <code>{enrollReq.delegate.slice(0, 8)}…{enrollReq.delegate.slice(-6)}</code>
              </p>

              {isNew ? (
                <>
                  <p className="muted">
                    To approve this, we’ll first create your account here — this is your <strong>secure home</strong>.
                    It takes about 30 seconds.
                  </p>
                  <p className="muted" style={{ margin: '0.4rem 0' }}>
                    <strong>What this does:</strong>
                    <br />· Creates <code>{enrollReq.name}</code> (your account)
                    <br />· Lets {host} sign you in as {enrollReq.name} <em>on that site only</em> — not anywhere else
                  </p>
                  <p className="muted" style={{ margin: '0.4rem 0' }}>
                    <strong>What it does NOT do:</strong>
                    <br />· {host} can’t see your recovery options or sign in elsewhere as you
                  </p>
                </>
              ) : (
                <p className="muted">
                  Approving lets you use Windows Hello / Face ID on {host} to sign in as {enrollReq.name}. It does{' '}
                  <strong>not</strong> give {host} access to your home account, your recovery options, or any other
                  site — only sign-in on {host}.
                </p>
              )}

              <p className="muted">No charge — your account is on a public test network (no real funds).</p>

              {running && <p className="ok">⏳ {enrollFlow.msg}</p>}
              {running && (
                <p className="muted">Working on the secure network… confirm any device prompt. This can take 15–30s.</p>
              )}
              {enrollFlow.phase === 'error' && (
                <>
                  <p className="err">⛔ {enrollFlow.error}</p>
                  <p className="muted">Nothing was charged. You can try again or cancel.</p>
                </>
              )}
              {!running && (
                <p>
                  <button onClick={approveEnroll}>
                    {isNew ? 'Create my account & approve' : 'Approve with your device'}
                  </button>{' '}
                  <button className="ghost" onClick={denyEnroll}>Cancel{isNew ? ' — go back' : ''}</button>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1>Agentic Connect</h1>
      <p className="muted">
        Your portable workspace — created once, on Base Sepolia, and reachable from any app with any
        sign-in. One canonical agent; your wallet, passkey, social, or agent name all return the same you.
      </p>

      {error && <p className="err">⛔ {error}</p>}

      {restoring && !session && <p className="muted">Restoring your session…</p>}

      {/* ── Not signed in: connect ───────────────────────────────── */}
      {!session && !restoring && (
        <>
          {googleNotice && (
            <div className="panel broker">
              <p className="ok" style={{ margin: 0 }}>ℹ️ {googleNotice}</p>
            </div>
          )}

          {/* Returning: connect with your agent-service name */}
          <div className="panel broker">
            <h2>Connect with your agent name</h2>
            <p className="muted">Already have a workspace? Enter its name, then confirm with the credential you set up.</p>
            <p>
              <input
                value={connectName}
                onChange={(e) => setConnectName(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ''))}
                placeholder="bob.demo.agent"
                style={{ minWidth: '14rem' }}
              />
            </p>
            {nameInfo.status === 'checking' && <p className="muted">Checking…</p>}
            {nameInfo.status === 'none' && (
              <p className="muted">No workspace with that name yet — new here? Sign up below. ↓</p>
            )}
            {nameInfo.status === 'found' && (
              <>
                <p className="ok" style={{ margin: '0 0 0.5rem' }}>
                  ✓ Found <code>{nameInfo.name}</code>
                </p>
                <p>
                  {nameInfo.hasPasskey && (
                    <button disabled={busy} onClick={() => onConnectName('passkey')}>
                      Continue with passkey
                    </button>
                  )}{' '}
                  {nameInfo.hasEoa && (
                    <button disabled={busy} onClick={() => onConnectName('wallet')}>
                      Continue with wallet
                    </button>
                  )}
                  {!nameInfo.hasPasskey && !nameInfo.hasEoa && (
                    <span className="muted">This workspace has no custody credential on-chain yet.</span>
                  )}
                  {' '}
                  <span className="muted">
                    ({[nameInfo.hasPasskey && 'passkey', nameInfo.hasEoa && 'wallet'].filter(Boolean).join(' + ') ||
                      'none'}{' '}
                    on this workspace)
                  </span>
                </p>
              </>
            )}
            {connectErr && <p className="err">⛔ {connectErr}</p>}
          </div>

          {/* New: sign up — pick a unique agent name + a custody credential */}
          <div className="panel broker">
            <h2>New here? Sign up</h2>
            <p className="muted">
              Pick your agent name, then create it with a passkey or wallet (custody-grade — it secures the
              workspace and unlocks sensitive details).
            </p>
            <p>
              <input
                value={desiredName}
                onChange={(e) =>
                  // Strip a pasted ".demo.agent" suffix, then keep just the label chars —
                  // so "alicev50.demo.agent" normalizes to the base "alicev50".
                  setDesiredName(
                    e.target.value.toLowerCase().replace(/\.demo\.agent$/, '').replace(/[^a-z0-9-]/g, ''),
                  )
                }
                placeholder="e.g. alice"
                style={{ marginRight: '0.25rem' }}
              />
              <code>{desiredName ? `${desiredName}.demo.agent` : 'your-name.demo.agent'}</code>
            </p>
            {desiredName && signupAvail === 'checking' && <p className="muted">Checking availability…</p>}
            {desiredName && signupAvail === 'available' && (
              <p className="ok" style={{ margin: '0 0 0.5rem' }}>✓ {desiredName}.demo.agent is available</p>
            )}
            {desiredName && signupAvail === 'taken' && (
              <p className="err" style={{ margin: '0 0 0.5rem' }}>
                ⛔ {desiredName}.demo.agent is taken — choose another (or connect with it above).
              </p>
            )}
            <p>
              <button disabled={busy || signupAvail !== 'available'} onClick={() => onSignup('passkey')}>
                {busy ? 'Working…' : 'Sign up with passkey'}
              </button>{' '}
              <button disabled={busy || signupAvail !== 'available'} onClick={() => onSignup('wallet')}>
                Sign up with wallet
              </button>
            </p>
            {!hasWallet() && (
              <p className="muted">
                <em>No browser wallet detected</em> — sign up with a passkey (your device).
              </p>
            )}
            <p className="muted">
              Or <button disabled={busy} onClick={() => startGoogleSignIn(AUD, window.location.origin + '/')}>continue with Google</button>{' '}
              — login-grade; it identifies a workspace but you confirm with a passkey/wallet to use it (ADR-0017).
            </p>
          </div>
        </>
      )}

      {/* ── Signed in via Google (login-grade): MANDATORY step-up to the bound agent ── */}
      {session && session.via === 'Google' && (
        <div className="panel broker">
          <h2>Confirm it's you to continue</h2>
          <p className="muted">
            Signed in with Google — this <strong>identifies your workspace</strong>, but a Google login is
            login-grade. To use it you must confirm with your <strong>passkey or wallet</strong> (a
            custody-grade credential of this same workspace).
          </p>
          <button onClick={() => stepUp('passkey')}>Continue with passkey</button>{' '}
          <button onClick={() => stepUp('wallet')}>Continue with wallet</button>{' '}
          <button onClick={signOut}>Disconnect</button>
          {stepUpMsg && <p className="err" style={{ marginTop: '0.5rem' }}>⛔ {stepUpMsg}</p>}
          <p className="muted" style={{ marginTop: '0.5rem' }}>
            If your passkey/wallet isn't part of this workspace yet, it'll say so — sign in with it directly,
            then add the other credential.
          </p>
        </div>
      )}

      {/* ── Signed in with a custody credential: the full workspace ── */}
      {session && session.via !== 'Google' && (
        <>
          <div className="panel broker">
            <h2>
              {session.fresh ? '✓ Welcome to your workspace' : '✓ Welcome back'}{' '}
              <span className="badge">via {session.via}</span>
            </h2>
            {profile ? (
              <>
                <p>
                  <strong>{profile.name ?? 'your workspace'}</strong>
                  <br />
                  <span className="muted">Canonical agent</span> <code>{profile.agent}</code>
                  <br />
                  <span className="muted">Signed in with</span> {profile.credential} ·{' '}
                  <span className="muted">access:</span>{' '}
                  <strong>{profile.access === 'standard' ? 'standard' : 'full (confirmed with device)'}</strong>
                </p>
                {!profile.name && (
                  <p className="muted">
                    <em>No <code>.demo.agent</code> name yet.</em> (Name claim lands next; your agent address
                    is the canonical identity regardless.)
                  </p>
                )}
              </>
            ) : (
              <p className="muted">Loading your profile…</p>
            )}
            <button onClick={signOut}>Sign out</button>
            <p style={{ marginTop: '0.5rem' }}>
              <button onClick={() => startGoogleSignIn(AUD, window.location.origin + '/', session.token)}>
                Link Google to this workspace
              </button>{' '}
              <span className="muted">— adds Google as a quick login (custody-authorized, P0-C).</span>
            </p>
            <p className="muted" style={{ marginTop: '0.5rem' }}>
              Your workspace stays safe. Sign back in anytime with the same credential — it resolves to this
              same agent.
            </p>
          </div>

          <div className="panel">
            <h2>Your contact details</h2>
            {sensitive ? (
              <pre>{JSON.stringify(sensitive, null, 2)}</pre>
            ) : (
              <>
                <p className="muted" style={{ filter: 'blur(4px)', userSelect: 'none' }}>
                  ▒▒▒▒▒▒▒@▒▒▒▒.▒▒▒ · +1 ▒▒▒ ▒▒▒ ▒▒▒▒
                </p>
                <button onClick={onRevealSensitive}>Confirm to view contact details</button>
                {stepUpMsg && <p className="err" style={{ marginTop: '0.5rem' }}>⛔ {stepUpMsg}</p>}
                <p className="muted">
                  Custody-grade session — your contact details unlock directly.
                </p>
              </>
            )}
          </div>

          {session.via !== 'Google' && (
            <div className="panel">
              <h2>Your agent services</h2>
              {service?.a2aAgent ? (
                <p className="ok">
                  ✓ Agent service live: <code>{service.a2aAgent}</code>
                  <br />
                  It <strong>operates on behalf of</strong> your workspace — an on-chain
                  <code> OPERATES_ON_BEHALF_OF</code> edge (it proposed; your workspace confirmed).
                </p>
              ) : service?.step ? (
                <p className="ok">⏳ {service.step}</p>
              ) : (
                <>
                  <p className="muted">
                    Provision a second Smart Agent (an A2A service agent) that acts on your behalf, linked
                    on-chain via an <code>OPERATES_ON_BEHALF_OF</code> relationship. Signed by your same
                    credential.
                  </p>
                  <button onClick={onProvisionService}>Provision an agent service</button>
                  {service?.error && (
                    <p className="err" style={{ marginTop: '0.5rem' }}>⛔ {service.error}</p>
                  )}
                </>
              )}
            </div>
          )}

          {session.via !== 'Google' && (
            <div className="panel">
              <h2>Add a sign-in method</h2>
              {addCred?.done ? (
                <p className="ok">
                  ✓ {addCred.done}. You can now sign in to{' '}
                  <code>{profile?.name ?? 'this workspace'}</code> with{' '}
                  {session.via === 'passkey' ? 'that wallet' : 'this passkey'} too — same agent, same
                  contact details.
                </p>
              ) : addCred?.step ? (
                <p className="ok">⏳ {addCred.step}</p>
              ) : (
                <>
                  <p className="muted">
                    This workspace is secured by your <strong>{session.via}</strong>. Add the other so you
                    can sign in either way. Your agent address never changes — the new credential is added
                    as a second on-chain custodian, signed by your current one.
                  </p>
                  <button onClick={onAddCredential}>
                    {session.via === 'passkey' ? 'Add a wallet (SIWE)' : 'Add a passkey'}
                  </button>
                  {addCred?.error && (
                    <p className="err" style={{ marginTop: '0.5rem' }}>⛔ {addCred.error}</p>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      <p className="muted" style={{ marginTop: '1rem', fontSize: '0.85em' }}>
        Real on Base Sepolia (chain 84532): identity resolves on-chain, the workspace is a deployed
        ERC-4337 Smart Agent, and PII is gated by the verified <code>AgentSession</code> (spec 227).
      </p>

      {/* ── Signup progress modal ──────────────────────────────────── */}
      {signup && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>
              {signup.phase === 'done'
                ? '✓ Workspace ready'
                : signup.phase === 'error'
                  ? '⛔ Couldn’t finish'
                  : 'Creating your workspace…'}
            </h2>
            <ol className="steps">
              {signup.steps.map((s, i) => {
                const isLast = i === signup.steps.length - 1;
                const done = signup.phase === 'done' || !isLast;
                const current = signup.phase === 'running' && isLast;
                return (
                  <li key={i} className={done ? 'done' : current ? 'current' : 'pending'}>
                    {current ? <span className="spinner" /> : <span>{done ? '✓' : '•'}</span>}
                    {s}
                  </li>
                );
              })}
            </ol>
            {signup.phase === 'running' && (
              <p className="muted">This takes ~15–30s. Confirm any device or wallet prompt that appears.</p>
            )}
            {signup.phase === 'done' && <p className="ok">Signing you in…</p>}
            {signup.phase === 'error' && (
              <>
                <p className="err">{signup.error}</p>
                <p className="muted">Nothing was charged. You can try again.</p>
                <button className="ghost" onClick={() => setSignup(null)}>Close</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
