import type { Address, Hex } from '@agenticprimitives/types';

/**
 * Discriminator for the KIND of Smart Agent a name points to. Three kinds only
 * — mirrors `@agenticprimitives/types` `AgentType` and the on-chain
 * `AGENT_KIND_ENUM` (must stay in lockstep). `treasury` is NOT an agent kind: a
 * treasury is a SERVICE agent (`'service'`) distinguished at the profile layer
 * (`ProfileType: 'treasury'` / `serviceType`; specs 217/225 §6).
 * Demo UIs use this to render different cards; audit context attaches it so
 * forensics can filter "all events involving a service agent."
 */
export type AgentKind = 'person' | 'org' | 'service';

/**
 * The typed bag of records a resolver may hold for a name. Every
 * field is optional; an unresolved record is `undefined`. Encoders
 * (`agent-naming/records`) refuse unknown keys; decoders quietly
 * drop unknown predicates (fail-closed on read, fail-loud on write).
 *
 * Spec § 5 — record schema. New predicates must update both the
 * type and the encoder/decoder pair AND a golden-vector test.
 */
export interface AgentNameRecords {
  /** Forward resolution target — the Smart Agent address this name points to. */
  addr?: Address;
  /** Discriminator for UI + audit context. */
  agentKind?: AgentKind;
  /** Human-friendly label (may differ from the normalized name). */
  displayName?: string;
  /** A2A service endpoint URL. */
  a2aEndpoint?: string;
  /** MCP service endpoint URL. */
  mcpEndpoint?: string;
  /** Off-chain JSON manifest URL. */
  metadataUri?: string;
  /**
   * Public-safe identifier for the controlling passkey
   * (`keccak256(credentialId)` — NEVER raw credentialId).
   * Useful for UI affordances like "this name is controlled by
   * the same passkey as <other-name>".
   */
  passkeyCredentialDigest?: Hex;
  /** Address of the CustodyPolicy governing the owner Smart Agent. */
  custodyPolicy?: Address;
  /**
   * Off-chain JSON profile content-hash
   * (matches `agent-identity.profileContentHash(profile)`). Stored
   * as `bytes32` via the `atl:metadataHash` predicate. Pairs with
   * `metadataUri` for the standard URI + content-hash anchoring
   * pattern (ADR-0009 / NS Phase 3 pivot).
   */
  metadataHash?: Hex;
  /**
   * CAIP-10 chain-agnostic account identifier (e.g.
   * `eip155:84532:0xabc...`). Per ADR-0008, this enables low-cost
   * cross-resolver interop with HCS-14 / ERC-8004 indexers without
   * us generating UAID strings. Consumers MAY derive a UAID locally
   * by canonical-JSON-hashing this with their own context.
   */
  nativeId?: string;
}

/**
 * Input to `AgentNamingClient.registerSubname` — request to register
 * `<label>.<parent>` under the `parent` namespace.
 *
 * The CALLER must own `parent` (verified on-chain by the registry).
 * Phase 2+ will accept a custody-gated `Signer`; Phase 1 throws
 * `NS Phase 2` from the client write methods.
 */
export interface RegisterSubnameInput {
  /** Parent name (e.g. `'acme.agent'`). */
  parent: string;
  /** Child label (single label, no dots; e.g. `'treasury'`). */
  label: string;
  /** Smart Agent address that will own the new subname. */
  owner: Address;
  /** Resolver contract address to install for the new name. */
  resolver?: Address;
  /** Optional subregistry contract to grant further-down issuance. */
  subregistry?: Address;
  /** Optional initial record bundle. */
  initialRecords?: AgentNameRecords;
}

/**
 * Input to `AgentNamingClient.setPrimaryName` — set the reverse-record
 * on a Smart Agent address so `reverseResolve(agent)` returns `name`.
 *
 * Round-trip verification: the resolver must also have `addr(name) ==
 * agent`. If forward resolution disagrees, `reverseResolve` returns
 * null. This prevents primary-name squatting.
 */
export interface SetPrimaryNameInput {
  agent: Address;
  name: string;
}

/** Input to `AgentNamingClient.setAgentRecords`. */
export interface SetAgentRecordsInput {
  name: string;
  records: AgentNameRecords;
}

/**
 * Input to `AgentNamingClient.setSubregistry` — delegate child-name
 * issuance authority for a subtree to a subregistry contract.
 * Setting `subregistry = address(0)` reverts to the default registry.
 */
export interface SetSubregistryInput {
  name: string;
  subregistry: Address;
}

/** Read-only client constructor options. */
export interface AgentNamingClientOpts {
  rpcUrl: string;
  chainId: number;
  /** AgentNameRegistry contract address for this chain. */
  registry: Address;
  /** AgentNameUniversalResolver contract address for this chain. */
  universalResolver: Address;
  // No `eth_getLogs` knobs: reverse resolution is a single
  // `reverseResolveString` view call (ADR-0013, no-fallback doctrine).
  // The previous chunked log-walk fallback was removed — it was the
  // sole getLogs walker in any product read path.
}
