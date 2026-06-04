// Connected-member session (spec 252 Wave 2). A member signs in through Connect and lands here with a
// scoped read+write delegation to their OWN vault (KC person SA, or GCO org SA). That session is the
// login CREDENTIAL — it identifies who's connected + carries the grant the app uses to read/write the
// member's vault. It is NOT operational data (offerings/needs/agreements live in the vaults), so it is
// allowed in localStorage; ADR-0013's "one mechanism for the DATA path" is unaffected.
//
// One session PER kind (kc + gco): the demo lets you connect a KC and a GCO independently and switch
// between them with the RoleSwitcher. Operators (jane/pete) have no session — the app holds their keys.

import type { Address } from '@agenticprimitives/types';
import type { DelegationWire } from './delegation';

export type SessionKind = 'kc' | 'gco';

/** A connected member's login credential + the grant the app reads/writes their vault through. */
export interface MemberSession {
  kind: SessionKind;
  /** The member SA whose vault holds their data (KC person SA, or GCO org SA). */
  sa: Address;
  /** Display name (KC name, or the GCO signatory's name). */
  name: string;
  /** GCO only: the org display name + the signatory person's name. */
  orgName?: string;
  signatory?: string;
  /** member SA → DEMO_GS_DELEGATE grant signed at the member's home; the app reads/writes via this. */
  grant: DelegationWire;
}

const KEY = (kind: SessionKind) => `agenticprimitives:demo-gs:session:${kind}`;

let _version = 0;
const _subs = new Set<() => void>();
function bump(): void { _version += 1; for (const s of _subs) s(); }

export function subscribeSessions(fn: () => void): () => void { _subs.add(fn); return () => _subs.delete(fn); }
export function sessionsVersion(): number { return _version; }

/** The connected session for a kind, or null. Validates the stored shape (fail-closed). */
export function loadSession(kind: SessionKind): MemberSession | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY(kind));
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<MemberSession>;
    if (s.kind !== kind || !s.sa || !s.name || !s.grant) return null;
    return s as MemberSession;
  } catch {
    return null;
  }
}

/** Persist (or replace) a member's session. */
export function setSession(s: MemberSession): void {
  if (typeof localStorage !== 'undefined') {
    try { localStorage.setItem(KEY(s.kind), JSON.stringify(s)); } catch { /* ignore */ }
  }
  bump();
}

/** Sign a member out (clears the login credential; their vault data is untouched). */
export function clearSession(kind: SessionKind): void {
  if (typeof localStorage !== 'undefined') {
    try { localStorage.removeItem(KEY(kind)); } catch { /* ignore */ }
  }
  bump();
}
