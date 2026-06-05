// Shared site-login launch (mirrors demo-gs's reworked connect flow). The ConnectScreen kicks off the
// SAME JP-data-access person connect the old name-required ConnectScreen did: stash the PKCE material
// under CONNECT_KEY, then EITHER open it in a POPUP over the dimmed site (the success path finishes IN
// PLACE) or — when the popup is blocked — redirect full-page to the person's home (the App's
// connect-return handler reads CONNECT_KEY and finishes enrollment). This file centralizes the launch.
//
// Connecting is ROLE-AGNOSTIC: everyone connects as a PERSON (the `jp-data-access` site-login that
// returns `tok.delegation`, the person → JP grant); the role (adopt / facilitate) is chosen AFTER
// connecting, from inside the intranet (the RoleHub). There is no role in the connect stash.

import { startSiteEnrollment } from '../connect-client';
import { openCentralAuthPopup } from './central-auth';

/** sessionStorage key for the in-flight site-login stash (read by App's connect-return handler).
 *  MUST equal the App's ENROLL_KEY so the popup-blocked redirect fallback returns through the
 *  existing OIDC return handler unchanged. */
export const CONNECT_KEY = 'agenticprimitives:demo-jp:enroll';
/** Remembers the last Impact name typed (prefill convenience). */
export const LAST_NAME_KEY = 'agenticprimitives:demo-jp:last-name';

/** The in-flight site-login stash — shape-compatible with the App's `EnrollStash` (state / name /
 *  authOrigin / codeVerifier / nonce), so the existing connect-return handler reads it unchanged. */
export interface ConnectStash {
  name: string;
  state: string;
  authOrigin: string;
  codeVerifier: string;
  nonce: string;
}

/** Begin the role-agnostic JP person site-login: stash PKCE + redirect to the person's home.
 *  Throws on any failure (the caller surfaces it); never silently falls back (ADR-0013). This is the
 *  REDIRECT path — kept as the popup-blocked fallback. `name` may be empty for the credential-first
 *  entry (the broker shows its W1 credential-first front door); when empty the home resolves to the
 *  platform origin (`resolveAuthOrigin`). */
export async function startConnect(name?: string): Promise<void> {
  const trimmed = (name ?? '').trim();
  if (trimmed) { try { localStorage.setItem(LAST_NAME_KEY, trimmed); } catch { /* ignore */ } }
  const r = await startSiteEnrollment(trimmed);
  const stash: ConnectStash = {
    name: trimmed, state: r.state, authOrigin: r.authOrigin, codeVerifier: r.codeVerifier, nonce: r.nonce,
  };
  sessionStorage.setItem(CONNECT_KEY, JSON.stringify(stash));
  window.location.href = r.url; // → <name>.impact-agent.me (or platform); returns with ?code&state
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
export type ConnectPopupResult =
  | ConnectPopupSuccess
  | { status: 'blocked' }
  | { status: 'cancelled' }
  | { status: 'error'; error: string };

/** Begin the credential-first JP connect in a POPUP over the (dimmed) site (spec 257 Phase 1 Wave 2).
 *  Builds the same `/authorize` URL as the redirect path, appends `mode=popup`, and opens the
 *  audit-hardened popup launcher pinned to the RESOLVED `authOrigin` (never accept a message from
 *  another origin). `name` is OPTIONAL — empty lets the broker show its W1 credential-first entry, and
 *  the broker (not the client name) binds the token `sub` to the proven credential.
 *
 *  Unlike `startConnect` this does NOT stash to sessionStorage or navigate — the success path stays in
 *  the SAME page: the returned `stash` + `code` + `codeVerifier` are handed to `finishConnect` in place. */
export async function startConnectPopup(
  name?: string,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<ConnectPopupResult> {
  const trimmed = (name ?? '').trim();
  if (trimmed) { try { localStorage.setItem(LAST_NAME_KEY, trimmed); } catch { /* ignore */ } }
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
