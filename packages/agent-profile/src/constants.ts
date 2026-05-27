import { keccak256, toHex, type Hex } from 'viem';

/**
 * `authOrigin` profile predicate (spec 229 §4). A person agent declares
 * **where its central auth lives** (their own `<handle>.impact-agent.io`
 * subdomain, which holds the ROOT passkey) as an on-chain string property:
 * `getStringProperty(agent, AUTH_ORIGIN)` → e.g. `"https://alice.impact-agent.io"`.
 *
 * Relying sites resolve `name → agent → authOrigin` as a SINGLE read
 * (ADR-0013, one mechanism). An UNSET facet is an *answer*, not a trigger to
 * try a second lookup — it resolves to the relying site's configured platform
 * default origin (a pure constant). Predicate = `keccak256("authOrigin")`.
 */
export const AUTH_ORIGIN: Hex = keccak256(toHex('authOrigin'));

/**
 * Phase 1 CAIP-10 namespace allowlist. Per ADR-0008 the encoder is
 * strict (validate-at-write); the decoder is permissive
 * (forward-compatible). Expand this list when a concrete consumer
 * needs cross-resolver interop with a new chain family — PR + golden
 * vector test required.
 */
export const CAIP10_NAMESPACE_ALLOWLIST: ReadonlySet<string> = new Set([
  'eip155', // EVM chains
  'hedera', // Hedera Hashgraph
  'solana', // Solana
]);

/**
 * AgentCard schema version. Bump on any breaking change to the typed
 * profile shape; canonical-JSON content-hash incorporates this field
 * so old + new profiles never collide.
 */
export const AGENT_CARD_SCHEMA_VERSION = 1 as const;
