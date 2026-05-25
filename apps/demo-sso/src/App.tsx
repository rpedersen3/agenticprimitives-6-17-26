import { useEffect, useState } from 'react';
import {
  createDemoBroker,
  type DemoBroker,
  ALICE_PASSKEY,
  ALICE_OIDC,
  BOB_PASSKEY,
} from './broker';

/** The Connect origin = wherever this app is served (local :5373/:8788, or a deploy). */
const CONNECT_ORIGIN = typeof window !== 'undefined' ? window.location.origin : '';
import type { AgentSession, CredentialPrincipal } from '@agenticprimitives/types';
import { startGoogleSignIn, exchangeCode, verifyServerSession } from './server-client';
import { canPerform } from './lib/broker-core';

/** The demo page is itself the single relying site for the real-OIDC mode. */
const SERVER_AUD = 'demo-sso';

interface ServerState {
  session?: AgentSession;
  error?: string;
  pending?: boolean;
  actionMsg?: string;
  actionOk?: boolean;
}

const RELYING_SITES = [
  { id: 'shop.example', label: 'Shop (relying site A)' },
  { id: 'forum.example', label: 'Forum (relying site B)' },
];

interface SiteState {
  session?: AgentSession;
  error?: string;
  actionMsg?: string;
  actionOk?: boolean;
}

export function App() {
  const [broker, setBroker] = useState<DemoBroker | null>(null);
  const [who, setWho] = useState('');
  const [sites, setSites] = useState<Record<string, SiteState>>({});
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState<ServerState>({});

  useEffect(() => {
    createDemoBroker().then(setBroker);
  }, []);

  // Real Google OIDC: on return from /oidc/google/callback the server broker
  // redirects here with ?code. Exchange it (server-to-server via /token) + verify
  // against /jwks. Works when served by the Pages Function broker.
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    if (!code) return;
    setServer({ pending: true });
    (async () => {
      try {
        const token = await exchangeCode(code, SERVER_AUD);
        const v = await verifyServerSession(token, SERVER_AUD);
        setServer(v.ok ? { session: v.session } : { error: v.reason });
      } catch (e) {
        setServer({ error: e instanceof Error ? e.message : 'sign-in failed' });
      } finally {
        // single-use: strip ?code/?state so a refresh doesn't re-exchange.
        url.searchParams.delete('code');
        url.searchParams.delete('state');
        window.history.replaceState({}, '', url.toString());
      }
    })();
  }, []);

  async function signIn(principal: CredentialPrincipal, label: string) {
    if (!broker) return;
    setBusy(true);
    setWho(label);
    // One sign-in → issue an aud-bound AgentSession to EACH relying site.
    const next: Record<string, SiteState> = {};
    for (const site of RELYING_SITES) {
      const outcome = await broker.login(principal, site.id);
      if (outcome.status === 'issued') {
        const v = await broker.verifyForRelyingSite(outcome.token, site.id);
        next[site.id] = v.ok ? { session: v.session } : { error: v.reason };
      } else if (outcome.status === 'rejected') {
        next[site.id] = { error: outcome.reason };
      } else {
        next[site.id] = { error: `convergence → ${outcome.status} (would route to bootstrap/disambiguation)` };
      }
    }
    setSites(next);
    setBusy(false);
  }

  function tryCustodyAction(siteId: string) {
    if (!broker) return;
    const session = sites[siteId]?.session;
    if (!session) return;
    const r = broker.canPerform(session, 'credential-change');
    setSites((prev) => ({
      ...prev,
      [siteId]: { ...prev[siteId], actionOk: r.ok, actionMsg: r.ok ? 'Allowed — custody-grade session.' : r.reason },
    }));
  }

  function signOut() {
    setWho('');
    setSites({});
  }

  return (
    <div>
      <h1>Agentic Connect — SSO demo</h1>
      <p className="muted">
        Enroll one credential at the Connect origin, then sign in across two relying sites (one-enroll SSO). The
        <code>AgentSession</code> is asymmetric + JWKS-verified, its subject is a CAIP-10 <code>CanonicalAgentId</code>,
        and it has no <code>owner</code> field. Custody-class actions require a custody-grade credential (step-up).
        Wires <code>connect</code> + <code>identity-directory</code> + adapters (spec 224).
      </p>

      {!broker && <p>Starting the Connect broker…</p>}

      {broker && (
        <>
          <div className="panel broker">
            <h2>
              Connect origin <span className="badge">{CONNECT_ORIGIN}</span>
            </h2>
            <p className="muted">
              Broker signing key <code>kid {broker.kid}</code> · JWKS published ({broker.jwks.keys.length} key, alg EdDSA).
              <br />
              <em>Demo note:</em> the broker key is generated in-browser so the demo is self-contained; in production it
              lives server-side at the Connect origin (the browser only sees the JWKS).
            </p>
            {who ? (
              <p>
                Signed in as <strong>{who}</strong>. <button onClick={signOut}>Sign out</button>
              </p>
            ) : (
              <p>
                <button disabled={busy} onClick={() => signIn(ALICE_PASSKEY, 'Alice · passkey (custody-grade)')}>
                  Sign in — Alice passkey
                </button>
                <button disabled={busy} onClick={() => signIn(ALICE_OIDC, 'Alice · GitHub OIDC (login-grade)')}>
                  Sign in — Alice GitHub
                </button>
                <button disabled={busy} onClick={() => signIn(BOB_PASSKEY, 'Bob · passkey (custody-grade)')}>
                  Sign in — Bob passkey
                </button>
              </p>
            )}
          </div>

          <h2>Relying sites</h2>
          <div className="grid">
            {RELYING_SITES.map((site) => {
              const s = sites[site.id];
              return (
                <div key={site.id} className="panel">
                  <h2>
                    {site.label} <span className="badge">aud: {site.id}</span>
                  </h2>
                  {!s && <p className="muted">No session. Sign in at the Connect origin →</p>}
                  {s?.error && <p className="err">⛔ {s.error}</p>}
                  {s?.session && (
                    <>
                      <p className="ok">✓ Verified AgentSession (asymmetric, via JWKS)</p>
                      <pre>
                        {JSON.stringify(
                          {
                            sub: s.session.sub,
                            assurance: s.session.assurance,
                            principal: s.session.principal,
                            aud: s.session.aud,
                          },
                          null,
                          2,
                        )}
                      </pre>
                      <button onClick={() => tryCustodyAction(site.id)}>Attempt: rotate credential (custody-class)</button>
                      {s.actionMsg && <p className={s.actionOk ? 'ok' : 'err'}>{(s.actionOk ? '✓ ' : '⛔ ') + s.actionMsg}</p>}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <p className="muted" style={{ marginTop: '1rem' }}>
            One sign-in issues an <code>aud</code>-bound session to <strong>both</strong> sites with the same{' '}
            <code>sub</code> (the canonical agent) — that's one-enroll SSO. The buttons above use the in-browser
            broker (simulated credential); the panel below uses the <strong>server broker + real Google OIDC</strong>.
          </p>

          <div className="panel broker" style={{ marginTop: '1rem' }}>
            <h2>
              Real Google OIDC <span className="badge">server broker</span>
            </h2>
            <p className="muted">
              Redirects to the Pages Function broker: <code>/oidc/google/start</code> → Google →{' '}
              <code>/oidc/google/callback</code> (token exchange + id_token verify) → back here with a single-use{' '}
              <code>code</code> → <code>/token</code>, verified against <code>/jwks</code>. Works when the app is served
              by <code>wrangler pages dev dist</code> (or a deploy) with the Google secrets set — see{' '}
              <code>OIDC-SETUP.md</code>. Under plain <code>vite dev</code> the function routes 404.
            </p>
            {!server.session && !server.error && (
              <button
                disabled={server.pending}
                onClick={() => startGoogleSignIn(SERVER_AUD, window.location.origin + '/')}
              >
                {server.pending ? 'Completing sign-in…' : 'Sign in with Google'}
              </button>
            )}
            {server.error && <p className="err">⛔ {server.error}</p>}
            {server.session && (
              <>
                <p className="ok">✓ Verified server-issued AgentSession (real Google OIDC, JWKS)</p>
                <pre>
                  {JSON.stringify(
                    {
                      sub: server.session.sub,
                      assurance: server.session.assurance,
                      principal: server.session.principal,
                      aud: server.session.aud,
                    },
                    null,
                    2,
                  )}
                </pre>
                <button
                  onClick={() => {
                    const r = canPerform(server.session!, 'credential-change');
                    setServer((p) => ({ ...p, actionOk: r.ok, actionMsg: r.ok ? 'Allowed — custody-grade.' : r.reason }));
                  }}
                >
                  Attempt: rotate credential (custody-class)
                </button>
                <button onClick={() => setServer({})} style={{ marginLeft: '0.5rem' }}>
                  Sign out
                </button>
                {server.actionMsg && <p className={server.actionOk ? 'ok' : 'err'}>{(server.actionOk ? '✓ ' : '⛔ ') + server.actionMsg}</p>}
                <p className="muted">
                  A Google session is <strong>login-grade</strong> — the custody-class action is blocked until step-up
                  to a custody-grade credential (ADR-0017 / CN-2).
                </p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
