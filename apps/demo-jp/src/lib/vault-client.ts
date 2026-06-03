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
  ROOT_AUTHORITY,
} from '@agenticprimitives/delegation';
import type { Address } from '@agenticprimitives/types';
import { CHAIN_ID, CONTRACTS, personaSignHash } from './chain.js';
import { ensureCsrfToken, csrfHeaders } from '../csrf.js';
import type { PersonaState } from './personas.js';
import type { DelegationWire } from './delegation.js';

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

async function postVault(path: 'get' | 'set' | 'list', body: Record<string, unknown>): Promise<Record<string, unknown>> {
  await ensureCsrfToken();
  const r = await fetch(`/a2a/mcp/vault/${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (!r.ok || !j || j.ok !== true) {
    throw new Error(
      (j?.detail as string) ?? (j?.error as string) ?? `vault ${path} failed (HTTP ${r.status})`,
    );
  }
  return j;
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
