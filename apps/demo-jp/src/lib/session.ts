// Connected-member session (production UX spec §7 "State Model", Wave 1). A person signs in ONCE
// through Impact and lands here with a verified id_token + (optionally) a scoped read+write delegation
// to their OWN vault. That session is the login CREDENTIAL — it identifies WHO is connected + carries
// the grant the app reads/writes the member's JP-program records through. It is NOT identity-level role
// ("adopter"/"facilitator"); role is a separate UI preference (see active-role.ts).
//
// This SPLITS the old `Session.kind` (production UX spec §7): the connected identity is the person
// Smart Agent; adopter/facilitator is an active workspace state, never identity or authorization.
//
// The session is the login credential, not operational data (the member's profile / JP records live in
// the vault), so it is allowed in localStorage; ADR-0013's "one mechanism for the DATA path" is
// unaffected — the grant is the single read mechanism, the session just carries it.

import type { Address } from '@agenticprimitives/types';
import type { DelegationWire } from './delegation';

/** A connected member's login credential + the grant the app reads/writes their vault through.
 *  NO `kind` — adopter/facilitator is a UI preference (active-role.ts), never part of identity. */
export interface MemberSession {
  /** The verified id_token from the person's Impact home (carries the canonical person SA in `sub`). */
  token: string;
  /** The person's Impact name/handle (e.g. `rich-pedersen`). */
  name: string;
  /** The canonical person Smart Agent address (decoded from the token's `sub`). */
  address: Address;
  /** True right after a fresh OIDC return (the token was just verified inside completeAuth); a restored
   *  session is `false` and gets re-verified against the home's JWKS at mount. */
  fresh: boolean;
  /** The scoped read+write delegation the member granted JP at sign-in (spec 247). JP reads/writes the
   *  member's JP-program records in the MEMBER's own vault through this grant — the data lives with the
   *  member, JP only holds the delegation. */
  grant?: DelegationWire;
}

const SESSION_KEY = 'agenticprimitives:demo-jp:session';

interface StoredSession {
  token?: string;
  name?: string;
  grant?: DelegationWire;
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

/** Pull the canonical person SA out of an id_token's `sub` claim (`…0x<40 hex>`). */
export function addrFromToken(token: string): Address | null {
  const sub = decodeToken(token)?.sub;
  const m = sub?.match(/0x[0-9a-fA-F]{40}$/);
  return (m?.[0] as Address) ?? null;
}

/** Restore the connected session, or null. Fail-closed: drops a session whose token is missing,
 *  un-parseable, lacks a person address, or is past `exp`. The signature is re-verified against the
 *  home's JWKS by the App at mount (a stale-but-unexpired token never opens a workspace silently). */
export function restoreSession(): MemberSession | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredSession;
    if (!s.token || !s.name) return null;
    const dec = decodeToken(s.token);
    const addr = addrFromToken(s.token);
    if (!addr || !dec?.exp || dec.exp * 1000 <= Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return { token: s.token, name: s.name, address: addr, fresh: false, grant: s.grant };
  } catch {
    return null;
  }
}

/** Persist (or replace) the connected member's session (token + name + grant only — `fresh` and the
 *  derived address are reconstructed on restore). */
export function setSession(s: MemberSession): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const stored: StoredSession = { token: s.token, name: s.name, grant: s.grant };
    localStorage.setItem(SESSION_KEY, JSON.stringify(stored));
  } catch {
    /* ignore */
  }
}

/** Sign the member out (clears the login credential; their Impact vault data is untouched). */
export function clearSession(): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}
