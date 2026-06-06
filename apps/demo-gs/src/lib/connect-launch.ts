// Shared site-login launch (spec 252 design spec §15a). The ConnectScreen + OnboardPanel both kick off
// the SAME Global.Church site-login ceremony: stash the PKCE material under CONNECT_KEY, then redirect
// to the person's home. The App's connect-return handler (unchanged) reads CONNECT_KEY and finishes
// enrollment. This file only centralizes the launch — it does NOT touch the connect-client or the
// return handler.
//
// Connecting is now ROLE-AGNOSTIC: everyone connects as a PERSON ('kc' site-login that returns
// `tok.delegation`, the person → Switchboard grant); the role (offer expertise / set up a GCO org) is
// chosen AFTER connecting, from inside the intranet (the RoleHub). There is no `mode:'gco'` at connect.

import { fedcmSupported, fedcmGet } from '@agenticprimitives/fedcm-rp';
import { startSiteEnrollment, resolveAuthOrigin } from '../connect-client';
import { openCentralAuthPopup } from './central-auth';
import type { DelegationWire } from './delegation';

/** sessionStorage key for the in-flight site-login stash (read by App's connect-return handler). */
export const CONNECT_KEY = 'agenticprimitives:demo-gs:connect';
// spec 259: the relying site no longer collects (or remembers) an Impact name — credential choice +
// name lookup/claim belong to the home. The old `LAST_NAME_KEY` last-name memory is gone; the launch
// wrappers below always enroll NAMELESS (the ConnectScreen passes `undefined`).

export interface ConnectStash {
  name: string;
  state: string;
  authOrigin: string;
  codeVerifier: string;
  nonce: string;
}

/** Begin the role-agnostic Global.Church person site-login: stash PKCE + redirect to the person's home.
 *  Throws on any failure (the caller surfaces it); never silently falls back (ADR-0013). This is the
 *  REDIRECT path — kept as the popup-blocked fallback (greenfield 11). `name` may be empty for the
 *  credential-first entry (the broker shows its W1 credential-first front door); when empty the home
 *  resolves to the platform apex (`resolveAuthOrigin`). */
export async function startConnect(name?: string): Promise<void> {
  const trimmed = (name ?? '').trim();
  const r = await startSiteEnrollment(trimmed);
  const stash: ConnectStash = {
    name: trimmed, state: r.state, authOrigin: r.authOrigin, codeVerifier: r.codeVerifier, nonce: r.nonce,
  };
  sessionStorage.setItem(CONNECT_KEY, JSON.stringify(stash));
  window.location.href = r.url; // → <name>.impact-agent.me (or apex); returns with ?code&state
}

/** The popup-success payload the App's `finishConnect` consumes: the resolved Connect origin, the OIDC
 *  CODE the popup delivered, the PKCE verifier to redeem it, and the connect stash (name/state/nonce).
 *  NO token / delegation rides here — only the code (the relying app exchanges it at /token). */
export interface ConnectPopupSuccess {
  status: 'success';
  authOrigin: string;
  code: string;
  codeVerifier: string;
  stash: ConnectStash;
}

/** The discriminated result of a popup connect. `blocked` → the caller renders the co-branded
 *  interstitial then falls back to `startConnect` (ADR-0013, explicit not silent); `cancelled` → return
 *  to the form; `error` → surface; `success` → the App's `finishConnect` exchanges + sets the session
 *  in place (no reload). */
/** spec 264 / ADR-0032 — a FedCM success. FedCM returns the THIN id_token (identity only); the scoped
 *  person→Switchboard delegation is then issued by the home's SEPARATE `/fedcm/grant` substrate endpoint
 *  (authorized by that id_token), not packed into the FedCM token. The App finishes via
 *  `finishConnectViaFedcm` — no /token round-trip. */
export interface ConnectFedcmSuccess {
  status: 'fedcm-success';
  authOrigin: string;
  idToken: string;
  delegation: DelegationWire;
}

export type ConnectPopupResult =
  | ConnectPopupSuccess
  | ConnectFedcmSuccess
  | { status: 'blocked' }
  | { status: 'cancelled' }
  | { status: 'error'; error: string };

/** Is the browser's FedCM API available? (Re-exported so the ConnectScreen gates the injected strategy.) */
export function fedcmAvailable(): boolean {
  return fedcmSupported();
}

const randomNonce = (): string => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** spec 264 / ADR-0032 — the FedCM RP ceremony (the `fedcm` strategy injected into `chooseSignIn`), a
 *  TWO-step flow that keeps FedCM a thin identity adapter:
 *
 *   1. FedCM proves IDENTITY → the thin id_token.
 *   2. POST that id_token to the home's `/fedcm/grant` substrate endpoint → the scoped person→Switchboard
 *      delegation. A Google/KMS member is signed server-side (zero device prompt); a passkey/wallet member
 *      returns `needs_device_credential` (the device key can't be signed for server-side).
 *
 *  WHO ACTUALLY GETS THE FEDCM CHOOSER (by design): FedCM is the fast-path for members whose session is
 *  established at the IdP origin (`PLATFORM_AUTH_ORIGIN` = www apex) — i.e. Google/KMS members (their OIDC
 *  return completes on www and sets www's `navigator.login` status). A passkey/wallet member is
 *  SUBDOMAIN-HOMED (`<handle>.impact-agent.me`, rpId-isolated): their login-status signal is set on the
 *  subdomain, and FedCM's status is PER-ORIGIN and does NOT cross subdomains (the `ap_sso` cookie does,
 *  but the status signal doesn't), so the www IdP reports them logged-out → no chooser → this THROWS →
 *  ConnectScreen's spec-259 redirect fallback. That is correct, not a regression: a device-custodied
 *  member must sign the delegation on-device anyway, so the redirect to their home is unavoidable — FedCM
 *  would only add a dialog in front of the same redirect. (Decision: 2026-06-05; ADR-0032.)
 *
 *  THROWS on dismissal / error / `needs_device_credential` / a missing delegation — the ConnectScreen
 *  catches it and falls back to the guaranteed spec-259 popup/redirect, where a device-custodied member
 *  signs the delegation on-device (FedCM-first, not FedCM-only; ADR-0031). */
export async function startConnectFedcm(onProgress?: (msg: string) => void): Promise<ConnectFedcmSuccess> {
  onProgress?.('Continuing with Global.Church…');
  const home = await resolveAuthOrigin(''); // the platform home origin (PLATFORM_AUTH_ORIGIN)
  const { token: idToken } = await fedcmGet({
    providers: [{ configURL: `${home}/fedcm/config.json`, clientId: 'demo-gs', params: { nonce: randomNonce(), intent: 'signin' } }],
    context: 'signin',
  });
  if (!idToken) throw new Error('FedCM returned no id_token'); // → popup fallback

  // Step 2 — exchange the identity bootstrap for the scoped grant (ADR-0032). The `ap_sso` cookie rides
  // (SameSite=None, credentialed) so the broker can reach custody; the id_token is the authorization.
  onProgress?.('Authorizing Switchboard access…');
  const res = await fetch(`${home}/fedcm/grant`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id_token: idToken, client_id: 'demo-gs' }),
  });
  const out = (await res.json().catch(() => ({}))) as {
    delegation?: DelegationWire; needs_device_credential?: boolean; via?: string; error?: string;
  };
  if (out.needs_device_credential) {
    throw new Error(`needs_device_credential:${out.via ?? ''}`); // → popup (device custody signs there)
  }
  if (!res.ok || !out.delegation) {
    throw new Error(out.error ? `fedcm_grant_failed:${out.error}` : 'FedCM grant returned no delegation'); // → popup
  }
  return { status: 'fedcm-success', authOrigin: home, idToken, delegation: out.delegation };
}

/** Begin the credential-first Global.Church connect in a POPUP over the (dimmed) site (spec 257 Phase 1
 *  Wave 2, greenfield 02→07). Builds the same `/authorize` URL as the redirect path, appends `mode=popup`,
 *  and opens the audit-hardened popup launcher pinned to the RESOLVED `authOrigin` (never accept a message
 *  from another origin). `name` is OPTIONAL — empty lets the broker show its W1 credential-first entry, and
 *  the broker (not the client name) binds the token `sub` to the proven credential.
 *
 *  Unlike `startConnect` this does NOT stash to sessionStorage or navigate — the success path stays in the
 *  SAME page: the returned `stash` + `code` + `codeVerifier` are handed to `finishConnect` in place. */
export async function startConnectPopup(
  name?: string,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<ConnectPopupResult> {
  const trimmed = (name ?? '').trim();
  const r = await startSiteEnrollment(trimmed);
  const stash: ConnectStash = {
    name: trimmed, state: r.state, authOrigin: r.authOrigin, codeVerifier: r.codeVerifier, nonce: r.nonce,
  };
  // expectedOrigin MUST be the RESOLVED authOrigin (audit F3): messages are accepted ONLY from the exact
  // Connect origin this name/credential resolves to, never a module constant or a wildcard.
  const res = await openCentralAuthPopup(r.url, r.state, r.authOrigin, onProgress, signal);
  if (res.status === 'success') {
    return { status: 'success', authOrigin: r.authOrigin, code: res.code, codeVerifier: r.codeVerifier, stash };
  }
  return res;
}
