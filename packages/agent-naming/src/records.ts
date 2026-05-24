/**
 * Record predicates + typed encoders/decoders for resolver records.
 *
 * Subpath: `@agenticprimitives/agent-naming/records`.
 *
 * The on-chain `AgentNameAttributeResolver` stores arbitrary
 * `(node, key) → bytes` mappings; this module is the canonical
 * encoder/decoder for the keys this package defines. Unknown keys
 * are dropped on decode (fail-closed read) and rejected on encode
 * (fail-loud write).
 */

import type { Hex } from 'viem';
import type { AgentNameRecords, AgentKind } from './types';

/** Canonical predicate keys (the on-chain key in `setText(node, key, value)`). */
export const PREDICATE = {
  addr: 'addr',
  agentKind: 'agent-kind',
  displayName: 'display-name',
  a2aEndpoint: 'a2a-endpoint',
  mcpEndpoint: 'mcp-endpoint',
  metadataUri: 'metadata-uri',
  passkeyCredentialDigest: 'passkey-credential-digest',
  custodyPolicy: 'custody-policy',
  /**
   * CAIP-10 chain-agnostic account identifier (ADR-0008).
   * Format: `<namespace>:<reference>:<address>`. Enables low-cost
   * interop with HCS-14 / ERC-8004 resolvers; we don't generate
   * UAID strings, but consumers can derive them locally from this
   * field + their own canonical-JSON context.
   */
  nativeId: 'native-id',
} as const;

export type PredicateKey = (typeof PREDICATE)[keyof typeof PREDICATE];

const KNOWN_PREDICATES = new Set<string>(Object.values(PREDICATE));

const KNOWN_AGENT_KINDS: ReadonlySet<AgentKind> = new Set(['person', 'org', 'service', 'treasury']);

/**
 * Encode a single record value to its on-chain string form.
 * Throws if the predicate key is unknown.
 *
 * Addresses + bytes32 hashes are lowercased so the on-chain string
 * comparison is canonical.
 */
export function encodeRecordValue(key: PredicateKey, value: string | Hex | AgentKind): string {
  if (!KNOWN_PREDICATES.has(key)) {
    throw new Error(`[agent-naming/records] unknown predicate "${key}" — refusing to encode`);
  }
  if (key === PREDICATE.addr) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
      throw new Error(`[agent-naming/records] addr must be a 20-byte hex address (got "${value}")`);
    }
    return (value as string).toLowerCase();
  }
  if (key === PREDICATE.passkeyCredentialDigest || key === PREDICATE.custodyPolicy) {
    if (!/^0x[0-9a-fA-F]+$/.test(value)) {
      throw new Error(`[agent-naming/records] ${key} must be hex (got "${value}")`);
    }
    return (value as string).toLowerCase();
  }
  if (key === PREDICATE.agentKind) {
    if (!KNOWN_AGENT_KINDS.has(value as AgentKind)) {
      throw new Error(`[agent-naming/records] agent-kind must be one of person|org|service|treasury (got "${value}")`);
    }
    return value;
  }
  if (key === PREDICATE.nativeId) {
    // CAIP-10 grammar (ADR-0008): <namespace>:<reference>:<address>.
    // Phase 1 restricts to a known-good namespace allowlist.
    const m = /^([-a-z0-9]{3,8}):([-_a-zA-Z0-9]{1,32}):([-.%a-zA-Z0-9]{1,128})$/.exec(value);
    if (!m) {
      throw new Error(`[agent-naming/records] native-id must match CAIP-10 grammar (got "${value}")`);
    }
    const namespace = m[1]!;
    if (!CAIP10_NAMESPACE_ALLOWLIST.has(namespace)) {
      throw new Error(
        `[agent-naming/records] native-id namespace "${namespace}" not in allowlist ` +
          `(${[...CAIP10_NAMESPACE_ALLOWLIST].join('|')}). PR to expand if needed.`,
      );
    }
    // For eip155, lowercase the address half for canonical comparison.
    if (namespace === 'eip155') {
      return `${namespace}:${m[2]}:${m[3]!.toLowerCase()}`;
    }
    return value;
  }
  // String predicates pass through unchanged (URL / display name).
  return value;
}

/**
 * Phase 1 CAIP-10 namespace allowlist. Add namespaces here when a
 * concrete consumer needs cross-resolver interop with that chain
 * family. Decoder is permissive (forward-compatible); encoder is
 * strict (validate-at-write).
 */
export const CAIP10_NAMESPACE_ALLOWLIST: ReadonlySet<string> = new Set([
  'eip155',  // EVM chains
  'hedera',  // Hedera Hashgraph
  'solana',  // Solana
]);

/**
 * Decode the typed `AgentNameRecords` bundle from an
 * `(key → string)` map returned by the on-chain resolver. Unknown
 * keys are silently dropped (fail-closed on read).
 */
export function decodeRecords(raw: Record<string, string | undefined>): AgentNameRecords {
  const out: AgentNameRecords = {};
  if (raw[PREDICATE.addr]) out.addr = raw[PREDICATE.addr] as `0x${string}`;
  if (raw[PREDICATE.agentKind] && KNOWN_AGENT_KINDS.has(raw[PREDICATE.agentKind] as AgentKind)) {
    out.agentKind = raw[PREDICATE.agentKind] as AgentKind;
  }
  if (raw[PREDICATE.displayName]) out.displayName = raw[PREDICATE.displayName];
  if (raw[PREDICATE.a2aEndpoint]) out.a2aEndpoint = raw[PREDICATE.a2aEndpoint];
  if (raw[PREDICATE.mcpEndpoint]) out.mcpEndpoint = raw[PREDICATE.mcpEndpoint];
  if (raw[PREDICATE.metadataUri]) out.metadataUri = raw[PREDICATE.metadataUri];
  if (raw[PREDICATE.passkeyCredentialDigest]) {
    out.passkeyCredentialDigest = raw[PREDICATE.passkeyCredentialDigest] as Hex;
  }
  if (raw[PREDICATE.custodyPolicy]) {
    out.custodyPolicy = raw[PREDICATE.custodyPolicy] as `0x${string}`;
  }
  if (raw[PREDICATE.nativeId]) {
    // Permissive decode: any grammar-valid CAIP-10 string accepted
    // (forward-compat with namespaces added to the allowlist later).
    out.nativeId = raw[PREDICATE.nativeId];
  }
  return out;
}

/**
 * Encode an `AgentNameRecords` bundle into `(predicateKey → string)`
 * pairs ready to be written via the resolver's `setText` setter
 * (one tx per pair, batched off-chain by the caller).
 */
export function encodeRecords(records: AgentNameRecords): Array<[PredicateKey, string]> {
  const out: Array<[PredicateKey, string]> = [];
  if (records.addr !== undefined) out.push([PREDICATE.addr, encodeRecordValue(PREDICATE.addr, records.addr)]);
  if (records.agentKind !== undefined)
    out.push([PREDICATE.agentKind, encodeRecordValue(PREDICATE.agentKind, records.agentKind)]);
  if (records.displayName !== undefined)
    out.push([PREDICATE.displayName, encodeRecordValue(PREDICATE.displayName, records.displayName)]);
  if (records.a2aEndpoint !== undefined)
    out.push([PREDICATE.a2aEndpoint, encodeRecordValue(PREDICATE.a2aEndpoint, records.a2aEndpoint)]);
  if (records.mcpEndpoint !== undefined)
    out.push([PREDICATE.mcpEndpoint, encodeRecordValue(PREDICATE.mcpEndpoint, records.mcpEndpoint)]);
  if (records.metadataUri !== undefined)
    out.push([PREDICATE.metadataUri, encodeRecordValue(PREDICATE.metadataUri, records.metadataUri)]);
  if (records.passkeyCredentialDigest !== undefined)
    out.push([
      PREDICATE.passkeyCredentialDigest,
      encodeRecordValue(PREDICATE.passkeyCredentialDigest, records.passkeyCredentialDigest),
    ]);
  if (records.custodyPolicy !== undefined)
    out.push([PREDICATE.custodyPolicy, encodeRecordValue(PREDICATE.custodyPolicy, records.custodyPolicy)]);
  if (records.nativeId !== undefined)
    out.push([PREDICATE.nativeId, encodeRecordValue(PREDICATE.nativeId, records.nativeId)]);
  return out;
}
