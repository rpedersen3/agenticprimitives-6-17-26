// Per-agent MCP vault client (spec 247 substrate; demo-gs consumer, spec 252). Ported near-verbatim
// from demo-jp — the substrate + relayer proxy are shared and unchanged.
//
// An agent reads/writes its OWN vault by presenting a delegation it ISSUED: delegator = the agent SA,
// delegate = the agent's custodian EOA, signed by that custodian. The demo-a2a relayer ERC-1271-
// verifies the delegation, opens a session, mints a token with sub = the agent, and demo-mcp keys
// every record by that agent (the recovered principal). So an agent can only ever touch its own
// namespace — there is no caller-supplied owner address on the wire.

import {
  type Delegation,
  buildCaveat,
  encodeTimestampTerms,
  encodeValueTerms,
  hashDelegation,
  ROOT_AUTHORITY,
} from '@agenticprimitives/delegation';
import type { Address } from '@agenticprimitives/types';
import { CHAIN_ID, CONTRACTS, personaSignHash, type Signer } from './chain';
import { ensureCsrfToken, csrfHeaders, refreshCsrfToken } from '../csrf';
import type { DelegationWire } from './delegation';

/** The agent + the custodian that controls it — all that's needed to act on its vault. */
export interface VaultOwner {
  /** The agent SA whose vault is read/written (the delegation delegator + record owner). */
  owner: Address;
  /** The custodian EOA that signs for the agent (the delegate + the ERC-1271 signer). */
  custodian: Signer;
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

/** A stalled relayer (or RPC) must not hang the hydrate timeline forever. Bound every vault call with a
 *  timeout so a stall surfaces as a clear error the discovery screen can show + retry (ADR-0013: the
 *  error is the answer, never an infinite wait). */
const VAULT_TIMEOUT_MS = 20_000;
// The IN-PLACE post-connect window can transiently 403: a stale/rotated CSRF token, or a freshly
// minted person→Switchboard grant whose nameless SA is still confirming on-chain (ERC-1271 has no
// code yet → `delegation_invalid`). Both self-heal within ~1–2s. So we do a SMALL bounded retry of
// the SAME call — refreshing CSRF on a 403 — rather than let one transient miss storm the discovery
// hydrate (which pins the app on the discovery screen until a manual refresh). ADR-0013 explicitly
// permits bounded retries of the same call; this is NOT a fallback to a different mechanism.
const VAULT_MAX_ATTEMPTS = 4;
const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

async function postVault(
  path: 'get' | 'set' | 'list',
  body: Record<string, unknown>,
  maxAttempts: number = VAULT_MAX_ATTEMPTS,
): Promise<Record<string, unknown>> {
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
    if (!transient || attempt === maxAttempts) throw lastErr;
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

// ── Reads/writes on a MEMBER's vault via a delegation they already granted (Wave 2) ──

/** Read a record from the delegation's DELEGATOR vault (the member's own namespace). */
export async function vaultReadWithDelegation<T = unknown>(
  delegation: DelegationWire,
  recordType: string,
  /** The broker SURVEY of established members passes 1: a stale/orphaned/revoked member grant fails
   *  ERC-1271 PERMANENTLY (e.g. a pre-CA-F1 member SA orphaned by a factory-address move), and the
   *  default 4× CSRF-style retry would storm the discovery hydrate with 403s before the caller drops
   *  it. The user's OWN post-connect read keeps the default self-heal (its SA may still be confirming). */
  maxAttempts?: number,
): Promise<T | null> {
  const j = await postVault('get', { delegation, requester: delegation.delegate, recordType }, maxAttempts);
  return (j.data ?? null) as T | null;
}

/** Upsert a record in the delegation's DELEGATOR vault. `data === null` soft-deletes. */
export async function vaultWriteWithDelegation(delegation: DelegationWire, recordType: string, data: unknown): Promise<void> {
  await postVault('set', { delegation, requester: delegation.delegate, recordType, data });
}
