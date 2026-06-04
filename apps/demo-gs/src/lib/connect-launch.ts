// Shared site-login launch (spec 252 design spec §15a). The ConnectScreen + OnboardPanel both kick off
// the SAME Global.Church site-login ceremony: stash the PKCE material under CONNECT_KEY, then redirect
// to the person's home. The App's connect-return handler (unchanged) reads CONNECT_KEY and finishes
// enrollment. This file only centralizes the launch — it does NOT touch the connect-client or the
// return handler.
//
// Connecting is now ROLE-AGNOSTIC: everyone connects as a PERSON ('kc' site-login that returns
// `tok.delegation`, the person → Switchboard grant); the role (offer expertise / set up a GCO org) is
// chosen AFTER connecting, from inside the intranet (the RoleHub). There is no `mode:'gco'` at connect.

import { startSiteEnrollment } from '../connect-client';

/** sessionStorage key for the in-flight site-login stash (read by App's connect-return handler). */
export const CONNECT_KEY = 'agenticprimitives:demo-gs:connect';
/** Remembers the last Global.Church name typed (prefill convenience). */
export const LAST_NAME_KEY = 'agenticprimitives:demo-gs:last-name';

export interface ConnectStash {
  name: string;
  state: string;
  authOrigin: string;
  codeVerifier: string;
  nonce: string;
}

/** Begin the role-agnostic Global.Church person site-login: stash PKCE + redirect to the person's home.
 *  Throws on any failure (the caller surfaces it); never silently falls back (ADR-0013). */
export async function startConnect(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Choose your Global.Church name (e.g. rich-pedersen).');
  try { localStorage.setItem(LAST_NAME_KEY, trimmed); } catch { /* ignore */ }
  const r = await startSiteEnrollment(trimmed);
  const stash: ConnectStash = {
    name: trimmed, state: r.state, authOrigin: r.authOrigin, codeVerifier: r.codeVerifier, nonce: r.nonce,
  };
  sessionStorage.setItem(CONNECT_KEY, JSON.stringify(stash));
  window.location.href = r.url; // → <name>.impact-agent.me; returns with ?code&state
}
