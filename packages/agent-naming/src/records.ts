/**
 * Predicate ids + typed record encoders/decoders for the on-chain
 * ontology-backed resolver (ADR-0009 / NS Phase 3 pivot).
 *
 * Subpath: `@agenticprimitives/agent-naming/records`.
 *
 * The `AgentNameAttributeResolver` (apps/contracts/src/naming/) inherits
 * `AttributeStorage` and validates every write against the
 * `OntologyTermRegistry`. Predicate keys are `bytes32` ids
 * (`keccak256("atl:displayName")` etc.), not strings; this module is
 * the canonical TS mirror of those ids — kept in lockstep with
 * `apps/contracts/src/naming/AgentNamePredicates.sol`.
 *
 * Datatype binding:
 *   - `addr`, `custodyPolicy`                 → on-chain `address`
 *   - `agentKind`, `metadataHash`,
 *     `passkeyCredentialDigest`              → on-chain `bytes32`
 *   - `displayName`, `a2aEndpoint`,
 *     `mcpEndpoint`, `metadataUri`,
 *     `nativeId`                              → on-chain `string`
 *
 * The encoder routes each predicate to its typed setter; the decoder
 * routes each predicate to its typed getter. Unknown predicates are
 * dropped on decode (fail-closed on read); encoders refuse unknown
 * predicates (fail-loud on write).
 */

import { keccak256, toHex, type Hex } from 'viem';
import type { AgentKind, AgentNameRecords } from './types';

// ─── Predicate ids (mirror AgentNamePredicates.sol) ─────────────────

/**
 * keccak256 of the `atl:*` CURIE. Computed at module load. These
 * MUST equal the `AgentNamePredicates.ATL_*` constants in the
 * Solidity library — verified by `predicates.test.ts` golden vectors.
 */
function _predId(curie: string): Hex {
  return keccak256(toHex(curie));
}

export const PREDICATE_ID = {
  addr: _predId('atl:addr'),
  agentKind: _predId('atl:agentKind'),
  displayName: _predId('atl:displayName'),
  a2aEndpoint: _predId('atl:a2aEndpoint'),
  mcpEndpoint: _predId('atl:mcpEndpoint'),
  metadataUri: _predId('atl:metadataURI'),
  metadataHash: _predId('atl:metadataHash'),
  passkeyCredentialDigest: _predId('atl:passkeyCredentialDigest'),
  custodyPolicy: _predId('atl:custodyPolicy'),
  nativeId: _predId('atl:nativeId'),
} as const;

export type PredicateName = keyof typeof PREDICATE_ID;

// ─── Enum value ids (mirror AgentNamePredicates.sol AGENT_KIND_*) ──

export const AGENT_KIND_ID: Record<AgentKind, Hex> = {
  person:   _predId('person'),
  org:      _predId('org'),
  service:  _predId('service'),
  treasury: _predId('treasury'),
};

const KNOWN_AGENT_KINDS: ReadonlySet<AgentKind> = new Set([
  'person',
  'org',
  'service',
  'treasury',
]);

// ─── Class + enum-set ids ──────────────────────────────────────────

/** `keccak256("atl:AgentName")` — the ShapeRegistry class id. */
export const CLASS_AGENT_NAME: Hex = _predId('atl:AgentName');
/** `keccak256("atl:AgentKindEnum")` — the enum-set id bound to `atl:agentKind`. */
export const AGENT_KIND_ENUM: Hex = _predId('atl:AgentKindEnum');

// ─── CAIP-10 namespace allowlist (ADR-0008) ────────────────────────

/**
 * Phase 1 CAIP-10 namespace allowlist for `nativeId`. Strict on
 * encode (validate-at-write), permissive on decode (forward-compat).
 */
export const CAIP10_NAMESPACE_ALLOWLIST: ReadonlySet<string> = new Set([
  'eip155',
  'hedera',
  'solana',
]);

const CAIP10_GRAMMAR = /^([-a-z0-9]{3,8}):([-_a-zA-Z0-9]{1,32}):([-.%a-zA-Z0-9]{1,128})$/;

// ─── Encode side (per-predicate typed setter args) ─────────────────

/**
 * The shape of one encoded predicate write. The consumer (Phase 4 SDK
 * client + demos) chooses the matching `setXxxAttribute` setter
 * by the `datatype` discriminator.
 */
export type EncodedRecord =
  | { predicate: Hex; datatype: 'string'; value: string }
  | { predicate: Hex; datatype: 'address'; value: `0x${string}` }
  | { predicate: Hex; datatype: 'bytes32'; value: Hex };

/**
 * Encode the typed `AgentNameRecords` bundle into per-predicate
 * encoded-call args. Caller dispatches each to the resolver's typed
 * `setXxxAttribute(node, predicate, value)` setter.
 */
export function encodeRecords(records: AgentNameRecords): EncodedRecord[] {
  const out: EncodedRecord[] = [];
  if (records.addr !== undefined) {
    out.push({ predicate: PREDICATE_ID.addr, datatype: 'address', value: _validateAddress(records.addr) });
  }
  if (records.agentKind !== undefined) {
    out.push({ predicate: PREDICATE_ID.agentKind, datatype: 'bytes32', value: _encodeAgentKind(records.agentKind) });
  }
  if (records.displayName !== undefined) {
    out.push({ predicate: PREDICATE_ID.displayName, datatype: 'string', value: records.displayName });
  }
  if (records.a2aEndpoint !== undefined) {
    out.push({ predicate: PREDICATE_ID.a2aEndpoint, datatype: 'string', value: records.a2aEndpoint });
  }
  if (records.mcpEndpoint !== undefined) {
    out.push({ predicate: PREDICATE_ID.mcpEndpoint, datatype: 'string', value: records.mcpEndpoint });
  }
  if (records.metadataUri !== undefined) {
    out.push({ predicate: PREDICATE_ID.metadataUri, datatype: 'string', value: records.metadataUri });
  }
  if (records.metadataHash !== undefined) {
    out.push({ predicate: PREDICATE_ID.metadataHash, datatype: 'bytes32', value: _validateBytes32(records.metadataHash) });
  }
  if (records.passkeyCredentialDigest !== undefined) {
    out.push({ predicate: PREDICATE_ID.passkeyCredentialDigest, datatype: 'bytes32', value: _validateBytes32(records.passkeyCredentialDigest) });
  }
  if (records.custodyPolicy !== undefined) {
    out.push({ predicate: PREDICATE_ID.custodyPolicy, datatype: 'address', value: _validateAddress(records.custodyPolicy) });
  }
  if (records.nativeId !== undefined) {
    out.push({ predicate: PREDICATE_ID.nativeId, datatype: 'string', value: _encodeNativeId(records.nativeId) });
  }
  return out;
}

// ─── Decode side (typed getters by predicate id → bundle) ──────────

/**
 * The shape of one decoded result the SDK reads from the resolver.
 * The reader pre-fetches `(predicateId → typed value)` pairs via the
 * three typed getter families on the universal resolver
 * (`resolveString`, `resolveBytes32`, `resolveAddress`).
 */
export interface DecodeInput {
  strings:  Partial<Record<Hex, string>>;
  addresses: Partial<Record<Hex, `0x${string}`>>;
  bytes32s:  Partial<Record<Hex, Hex>>;
}

export function decodeRecords(input: DecodeInput): AgentNameRecords {
  const out: AgentNameRecords = {};
  const addr = input.addresses[PREDICATE_ID.addr];
  if (addr) out.addr = addr;
  const kind = input.bytes32s[PREDICATE_ID.agentKind];
  if (kind) {
    const k = _decodeAgentKind(kind);
    if (k) out.agentKind = k;
  }
  const displayName = input.strings[PREDICATE_ID.displayName];
  if (displayName) out.displayName = displayName;
  const a2aEndpoint = input.strings[PREDICATE_ID.a2aEndpoint];
  if (a2aEndpoint) out.a2aEndpoint = a2aEndpoint;
  const mcpEndpoint = input.strings[PREDICATE_ID.mcpEndpoint];
  if (mcpEndpoint) out.mcpEndpoint = mcpEndpoint;
  const metadataUri = input.strings[PREDICATE_ID.metadataUri];
  if (metadataUri) out.metadataUri = metadataUri;
  const metadataHash = input.bytes32s[PREDICATE_ID.metadataHash];
  if (metadataHash) out.metadataHash = metadataHash;
  const digest = input.bytes32s[PREDICATE_ID.passkeyCredentialDigest];
  if (digest) out.passkeyCredentialDigest = digest;
  const custodyPolicy = input.addresses[PREDICATE_ID.custodyPolicy];
  if (custodyPolicy) out.custodyPolicy = custodyPolicy;
  const nativeId = input.strings[PREDICATE_ID.nativeId];
  if (nativeId) out.nativeId = nativeId;
  return out;
}

// ─── Internal validators ───────────────────────────────────────────

function _validateAddress(value: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`[agent-naming/records] expected a 20-byte hex address (got "${value}")`);
  }
  return value.toLowerCase() as `0x${string}`;
}

function _validateBytes32(value: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`[agent-naming/records] expected a 32-byte hex value (got "${value}")`);
  }
  return value.toLowerCase() as Hex;
}

function _encodeAgentKind(value: AgentKind): Hex {
  if (!KNOWN_AGENT_KINDS.has(value)) {
    throw new Error(
      `[agent-naming/records] agent-kind must be one of person|org|service|treasury (got "${value}")`,
    );
  }
  return AGENT_KIND_ID[value];
}

function _decodeAgentKind(id: Hex): AgentKind | undefined {
  for (const [name, value] of Object.entries(AGENT_KIND_ID) as [AgentKind, Hex][]) {
    if (value.toLowerCase() === id.toLowerCase()) return name;
  }
  return undefined;
}

function _encodeNativeId(value: string): string {
  const m = CAIP10_GRAMMAR.exec(value);
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
  if (namespace === 'eip155') {
    return `${namespace}:${m[2]}:${m[3]!.toLowerCase()}`;
  }
  return value;
}
