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
/** spec 264 Phase 1b — a FedCM success. FedCM returns the id_token directly (no code to exchange); the
 *  home's `/fedcm/assertion` ALSO packs the scoped person→Switchboard delegation (custody is only readable
 *  there). The App finishes via `finishConnectViaFedcm` — no /token round-trip. */
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

/** spec 264 Phase 1b — the FedCM RP ceremony (the `fedcm` strategy injected into `chooseSignIn`). FedCM
 *  proves identity (the thin id_token); the home's `/fedcm/assertion` packs the scoped grant alongside it.
 *  THROWS on dismissal / error / a missing delegation — the ConnectScreen catches it and falls back to the
 *  guaranteed spec-259 popup (FedCM-first, not FedCM-only; ADR-0031). */
export async function startConnectFedcm(onProgress?: (msg: string) => void): Promise<ConnectFedcmSuccess> {
  onProgress?.('Continuing with Global.Church…');
  const home = await resolveAuthOrigin(''); // the platform home origin (PLATFORM_AUTH_ORIGIN)
  const { token } = await fedcmGet({
    providers: [{ configURL: `${home}/fedcm/config.json`, clientId: 'demo-gs', params: { nonce: randomNonce(), intent: 'signin' } }],
    context: 'signin',
  });
  const parsed = JSON.parse(token) as { id_token?: string; delegation?: DelegationWire };
  if (!parsed.id_token || !parsed.delegation) {
    throw new Error('FedCM did not return a Switchboard access grant'); // → popup fallback
  }
  return { status: 'fedcm-success', authOrigin: home, idToken: parsed.id_token, delegation: parsed.delegation };
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
