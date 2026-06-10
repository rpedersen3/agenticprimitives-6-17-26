// Per-agent MCP vault client (spec 247).
//
// An agent reads/writes its OWN vault by presenting a delegation it ISSUED:
// `delegator = the agent SA`, `delegate = the agent's custodian EOA`, signed by
// that custodian. The demo-a2a relayer ERC-1271-verifies the delegation, opens a
// session, mints a token with `sub = the agent`, and demo-mcp keys every record
// by that agent (the recovered principal). So an agent can only ever touch its
// own namespace — there is no caller-supplied owner address on the wire.
//
// Mirrors the existing `/a2a/mcp/person/pii` path; the delegation is the
// `issueSiteDelegation` template trimmed to the off-chain caveats (timestamp +
// value 0) — the vault call is not an on-chain redemption, so it needs no
// allowed-targets list.

import {
  type Delegation,
  buildCaveat,
  encodeTimestampTerms,
  encodeValueTerms,
  hashDelegation,
  mintDelegationToken,
  ROOT_AUTHORITY,
} from '@agenticprimitives/delegation';
import type { Address } from '@agenticprimitives/types';
import { CHAIN_ID, CONTRACTS, personaSignHash } from './chain.js';
import { sessionKeySigner } from '../connect-client.js';
import { ensureCsrfToken, csrfHeaders, refreshCsrfToken } from '../csrf.js';
import type { PersonaState } from './personas.js';
import type { DelegationWire } from './delegation.js';
import type { MemberSession } from './session.js';

// The MCP audience demo-mcp verifies tokens against — MUST match demo-a2a's MCP_AUDIENCE
// and demo-mcp's MCP_AUDIENCE env. A mismatch fails verification with an `aud` error.
const MCP_AUDIENCE = 'urn:mcp:server:person';

/** Rehydrate a stored wire delegation into the bigint-salt struct the token minter needs. */
function fromWire(w: DelegationWire): Delegation {
  return { ...w, salt: BigInt(w.salt) };
}

/** The agent + the custodian that controls it — all that's needed to act on its vault. */
export interface VaultOwner {
  /** The agent SA whose vault is read/written (the delegation delegator + record owner). */
  owner: Address;
  /** The custodian EOA persona that signs for the agent (the delegate + the ERC-1271 signer). */
  custodian: PersonaState;
}

const VALIDITY_SECONDS = 60 * 60 * 12; // 12h; the cached delegation is rebuilt on expiry.
const _cache = new Map<string, { wire: DelegationWire; expiresAt: number }>();

/** Build (or reuse) an owner-issued delegation `owner → custodian`, signed by the custodian. */
async function ownerDelegationWire(o: VaultOwner): Promise<DelegationWire> {
  const key = `${o.owner.toLowerCase()}:${o.custodian.address.toLowerCase()}`;
  const now = Math.floor(Date.now() / 1000);
  const hit = _cache.get(key);
  if (hit && hit.expiresAt - 60 > now) return hit.wire;

  const validUntil = now + VALIDITY_SECONDS;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let salt = 0n;
  for (const b of bytes) salt = (salt << 8n) | BigInt(b);
  const d: Delegation = {
    delegator: o.owner,
    delegate: o.custodian.address,
    authority: ROOT_AUTHORITY,
    caveats: [
      buildCaveat(CONTRACTS.timestampEnforcer, encodeTimestampTerms(0, validUntil)),
      buildCaveat(CONTRACTS.valueEnforcer, encodeValueTerms(0n)),
    ],
    salt,
    signature: '0x',
  };
  const digest = hashDelegation(d, CHAIN_ID, CONTRACTS.delegationManager);
  d.signature = await personaSignHash(o.custodian)(digest);
  const wire: DelegationWire = { ...d, salt: d.salt.toString() };
  _cache.set(key, { wire, expiresAt: validUntil });
  return wire;
}

// The IN-PLACE post-connect window can transiently 403: a stale/rotated CSRF token, or a freshly
// minted member→JP grant whose nameless SA is still confirming on-chain (ERC-1271 has no code yet →
// `delegation_invalid`). Both self-heal within ~1–2s. So we do a SMALL bounded retry of the SAME call
// — refreshing CSRF on a 403 — rather than let one transient miss storm the discovery hydrate. ADR-0013
// permits bounded retries of the same call; this is NOT a fallback to a different mechanism.
const VAULT_MAX_ATTEMPTS = 4;
// A stalled relayer/RPC must NOT hang the discovery hydrate forever (records load → `recordsLoaded`).
// Bound each attempt; a stall surfaces as a clear error the discovery screen shows + retry (ADR-0013).
const VAULT_TIMEOUT_MS = 20_000;
const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

async function postVault(path: 'get' | 'set' | 'list', body: Record<string, unknown>): Promise<Record<string, unknown>> {
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= VAULT_MAX_ATTEMPTS; attempt++) {
    await ensureCsrfToken();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), VAULT_TIMEOUT_MS);
    let r: Response;
    try {
      r = await fetch(`/a2a/mcp/vault/${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        throw new Error(`vault ${path} timed out after ${VAULT_TIMEOUT_MS / 1000}s — the relayer or RPC is slow/unreachable. Please retry.`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    if (r.ok && j && j.ok === true) return j;

    // Retry ONLY transient classes — CSRF/auth (403) + server (5xx) — never a 4xx contract error
    // (400 bad_body / 404). A 403 is most often a stale or rotated CSRF token, so force a fresh one
    // before retrying; the backoff also covers a brief grant/SA-confirmation propagation window.
    lastErr = new Error((j?.detail as string) ?? (j?.error as string) ?? `vault ${path} failed (HTTP ${r.status})`);
    const transient = r.status === 403 || r.status >= 500;
    if (!transient || attempt === VAULT_MAX_ATTEMPTS) throw lastErr;
    if (r.status === 403) { try { await refreshCsrfToken(); } catch { /* the next ensureCsrfToken retries */ } }
    await sleep(300 * attempt); // 300 / 600 / 900ms
  }
  throw lastErr ?? new Error(`vault ${path} failed`);
}

/** Read one record from the agent's vault; `null` if absent or tombstoned. */
export async function vaultRead<T = unknown>(o: VaultOwner, recordType: string): Promise<T | null> {
  const delegation = await ownerDelegationWire(o);
  const j = await postVault('get', { delegation, requester: o.custodian.address, recordType });
  return (j.data ?? null) as T | null;
}

/** Upsert a record in the agent's vault. `data === null` soft-deletes (tombstone). */
export async function vaultWrite(o: VaultOwner, recordType: string, data: unknown): Promise<void> {
  const delegation = await ownerDelegationWire(o);
  await postVault('set', { delegation, requester: o.custodian.address, recordType, data });
}

/** Enumerate the agent's live record types (no payloads). */
export async function vaultList(o: VaultOwner): Promise<Array<{ record_type: string; updated_at: string }>> {
  const delegation = await ownerDelegationWire(o);
  const j = await postVault('list', { delegation, requester: o.custodian.address });
  return (j.records ?? []) as Array<{ record_type: string; updated_at: string }>;
}

// ── Reads/writes on a MEMBER's vault via a delegation they already granted ─────
//
// spec 247 / the delegated-member-records model: when a member onboards through
// demo-jp, they grant JP a scoped read+write delegation (delegator = the member
// SA, delegate = JP's delegate). JP stores that delegation and uses it to write +
// read the member's JP-program records into the MEMBER's OWN vault — the data
// lives with the member, JP holds only the delegation. The relayer verifies the
// member's ERC-1271 signature and mints a token with sub = the member, so the MCP
// keys by the member (principal == owner == the member's namespace).

/** Read a record from the delegation's DELEGATOR vault (the member's own namespace). */
export async function vaultReadWithDelegation<T = unknown>(
  delegation: DelegationWire,
  recordType: string,
): Promise<T | null> {
  const j = await postVault('get', { delegation, requester: delegation.delegate, recordType });
  return (j.data ?? null) as T | null;
}

/** Upsert a record in the delegation's DELEGATOR vault. `data === null` soft-deletes. */
export async function vaultWriteWithDelegation(
  delegation: DelegationWire,
  recordType: string,
  data: unknown,
): Promise<void> {
  await postVault('set', { delegation, requester: delegation.delegate, recordType, data });
}

// ── Client-mint: a connected MEMBER reads/writes their OWN vault (spec 270 v4 W2) ──────────
//
// The DEL-001 closure. Instead of handing the raw `member→JP` grant to demo-a2a (which would mint
// the token itself), the member's browser session MINTS the delegation token directly — signed by
// the session key it generated at connect — and embeds the DEL-001 leaf (`member SA → session key`,
// signed by the member's home credential) in the token claims. demo-a2a only forwards it; demo-mcp
// recovers the session key from the signature and (W3) checks the leaf binds it to the member SA, so
// observing a token can't let anyone re-mint it under their own key. The session private key never
// leaves this origin. `sub` = the member SA, so demo-mcp keys the record in the MEMBER's namespace.

/** Mint a single-use-ish (usage-capped) delegation token for the connected member, signed by their
 *  session key, carrying the grant + the DEL-001 leaf. Throws if the session lacks the v4 material. */
async function memberVaultToken(s: MemberSession): Promise<string> {
  if (!s.sessionKey || !s.sessionDelegation || !s.grant) {
    throw new Error('member session is missing the session key, leaf, or grant (re-connect required)');
  }
  const { token } = await mintDelegationToken(
    {
      iss: 'demo-jp',
      aud: MCP_AUDIENCE,
      sub: s.address, // the canonical person SA (the grant's delegator) — demo-mcp keys by this
      delegation: fromWire(s.grant),
      sessionKeyAddress: s.sessionKey.address,
      sessionDelegation: fromWire(s.sessionDelegation),
      ttlSeconds: 300,
      usageLimit: 10, // covers postVault's bounded same-token retries; tokens are short-lived
    },
    sessionKeySigner(s.sessionKey),
  );
  return token;
}

/** Read one record from the connected member's OWN vault via a client-minted, leaf-bound token. */
export async function vaultReadAsMember<T = unknown>(s: MemberSession, recordType: string): Promise<T | null> {
  const token = await memberVaultToken(s);
  const j = await postVault('get', { token, recordType });
  return (j.data ?? null) as T | null;
}

/** Upsert a record in the connected member's OWN vault. `data === null` soft-deletes (tombstone). */
export async function vaultWriteAsMember(s: MemberSession, recordType: string, data: unknown): Promise<void> {
  const token = await memberVaultToken(s);
  await postVault('set', { token, recordType, data });
}
