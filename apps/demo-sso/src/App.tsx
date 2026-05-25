import { useEffect, useState } from 'react';
import {
  createDemoBroker,
  type DemoBroker,
  CONNECT_ORIGIN,
  ALICE_PASSKEY,
  ALICE_OIDC,
  BOB_PASSKEY,
} from './broker';
import type { AgentSession, CredentialPrincipal } from '@agenticprimitives/types';

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

  useEffect(() => {
    createDemoBroker().then(setBroker);
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
            <code>sub</code> (the canonical agent) — that's one-enroll SSO. Sign in with <strong>GitHub</strong>{' '}
            (login-grade), then attempt the custody action: it's blocked until you step up with the passkey
            (custody-grade) — ADR-0017 / CN-2.
          </p>
        </>
      )}
    </div>
  );
}
