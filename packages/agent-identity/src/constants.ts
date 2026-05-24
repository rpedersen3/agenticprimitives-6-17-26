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
