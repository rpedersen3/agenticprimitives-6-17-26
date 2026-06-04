// Connected-member session (spec 252 Wave 2). A member signs in through Connect and lands here with a
// scoped read+write delegation to their OWN vault (KC person SA, or GCO org SA). That session is the
// login CREDENTIAL — it identifies who's connected + carries the grant the app uses to read/write the
// member's vault. It is NOT operational data (offerings/needs/agreements live in the MCP vaults, read
// through `vault-client.ts`), so caching the credential in localStorage is allowed; ADR-0013's "one
// mechanism for the DATA path" is unaffected — the vault remains the single source of truth.
//
// One session PER kind (kc + gco): the demo lets you connect a KC and a GCO independently and switch
// between them with the RoleSwitcher. Operators (jane/pete) have no session — the app holds their keys.
//
// Fail-closed validation (ADR-0013, no silent acceptance of half-valid shapes): a stored session must
// (a) carry the current schema version, (b) have a structurally valid grant, and (c) be within the
// session TTL. A malformed, version-skewed, or expired blob is treated as SIGNED-OUT (returns null) —
// never partially trusted. We do NOT escalate to a weaker check; absent/invalid is the final answer.

import type { Address } from '@agenticprimitives/types';
import type { DelegationWire } from './delegation';
import { clearActiveRole } from './active-role';

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
  /** Person/KC session only: the id_token, used to query Connect related-orgs for cross-browser GCO
   *  org recognition (lib/gco-discovery.ts). Not needed for vault access. */
  idToken?: string;
}

/** Stored envelope: the session plus the metadata the loader validates (version + savedAt). */
interface SessionEnvelope extends MemberSession {
  /** Schema version — bump to invalidate every cached session on a shape change. */
  v: number;
  /** Epoch ms the credential was cached; the loader rejects anything older than SESSION_TTL_MS. */
  savedAt: number;
}

const SESSION_VERSION = 1;
/** Cached login credentials expire after 24h; a returning member re-connects (re-mints a fresh grant). */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const KEY = (kind: SessionKind) => `agenticprimitives:demo-gs:session:${kind}`;

let _version = 0;
const _subs = new Set<() => void>();
function bump(): void { _version += 1; for (const s of _subs) s(); }

export function subscribeSessions(fn: () => void): () => void { _subs.add(fn); return () => _subs.delete(fn); }
export function sessionsVersion(): number { return _version; }

/** A structurally valid grant (the wire delegation the vault path presents). Shape-only — the relayer
 *  does the cryptographic check; here we just refuse to trust a half-formed blob (fail-closed). */
function isValidGrant(g: unknown): g is DelegationWire {
  if (!g || typeof g !== 'object') return false;
  const d = g as Partial<DelegationWire>;
  return typeof d.delegator === 'string' && typeof d.delegate === 'string'
    && typeof d.signature === 'string' && Array.isArray(d.caveats) && typeof d.salt === 'string';
}

/** Validate a parsed envelope into a MemberSession, or null. Rejects version skew, malformed shape,
 *  and TTL expiry — fail-closed, no partial trust (ADR-0013). */
function validate(kind: SessionKind, parsed: unknown): MemberSession | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const e = parsed as Partial<SessionEnvelope>;
  if (e.v !== SESSION_VERSION) return null; // version skew → stale credential, sign out
  if (typeof e.savedAt !== 'number' || Date.now() - e.savedAt > SESSION_TTL_MS) return null; // expired
  if (e.kind !== kind || !e.sa || typeof e.sa !== 'string' || !e.name || typeof e.name !== 'string') return null;
  if (!isValidGrant(e.grant)) return null;
  // Strip the envelope metadata; callers only ever see the MemberSession.
  return {
    kind, sa: e.sa as Address, name: e.name, orgName: e.orgName, signatory: e.signatory,
    grant: e.grant, idToken: typeof e.idToken === 'string' ? e.idToken : undefined,
  };
}

/** The connected session for a kind, or null. Validates version + shape + TTL (fail-closed). An
 *  invalid / expired blob is purged so it can't linger as a half-valid credential. */
export function loadSession(kind: SessionKind): MemberSession | null {
  if (typeof localStorage === 'undefined') return null;
  let raw: string | null;
  try { raw = localStorage.getItem(KEY(kind)); } catch { return null; }
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { purge(kind); return null; }
  const s = validate(kind, parsed);
  if (!s) { purge(kind); return null; }
  return s;
}

/** Persist (or replace) a member's session, stamped with the current version + savedAt. */
export function setSession(s: MemberSession): void {
  if (typeof localStorage !== 'undefined') {
    const env: SessionEnvelope = { ...s, v: SESSION_VERSION, savedAt: Date.now() };
    try { localStorage.setItem(KEY(s.kind), JSON.stringify(env)); } catch { /* ignore */ }
  }
  bump();
}

/** Remove the stored blob for a kind WITHOUT notifying subscribers (used by the loader on a rejected
 *  blob, where a re-render is already in flight). */
function purge(kind: SessionKind): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(KEY(kind)); } catch { /* ignore */ }
}

/** Sign a member out (clears the login credential; their vault data is untouched). Also clears the
 *  dependent active-role UI preference for this identity so stale workspace state can't linger after a
 *  sign-out / session-expiry. */
export function clearSession(kind: SessionKind): void {
  const s = loadSession(kind);
  purge(kind);
  if (s) {
    // The active-role preference is keyed by the person identity: KC = its SA, GCO = its signatory.
    const personKey = kind === 'kc' ? s.sa : (s.signatory ?? s.name);
    if (personKey) clearActiveRole(personKey);
  }
  bump();
}
