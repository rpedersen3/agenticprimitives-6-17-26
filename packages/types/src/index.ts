// @agenticprimitives/types — cross-cutting branded primitives. Types-only.

export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type ChainId = number & { readonly __chainId: unique symbol };
export type BrandedId<T extends string> = string & { readonly __brand: T };

/**
 * The canonical identity of every agent IS its ERC-4337 Smart Agent
 * address ([ADR-0010](../../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md)).
 * This alias names that role: a value typed `CanonicalAgentIdentity` is
 * THE identity — never a name, profile, EOA, or passkey (those are
 * facets that point AT it and rotate without changing it; see ADR-0011).
 * It is a plain `Address`, so it composes with every viem/`Address` API
 * without a cast — the name is the contract, the brand is doctrinal.
 */
export type CanonicalAgentIdentity = Address;

// ─── Agent identity shape ─────────────────────────────────────────────
//
// Cross-cutting shape so downstream packages (audit, tool-policy,
// delegation, mcp-runtime, identity-auth) can accept name + type as
// optional context WITHOUT importing @agenticprimitives/agent-naming.
//
// See ADR-0006 ("agent-naming is a resolution layer"). Naming is the
// rendering layer; binding stays at addresses. NameContext is the
// injected display + filter axis other packages can branch on.

/** Discriminator for the kind of Smart Agent a name points to. */
export type AgentType = 'person' | 'org' | 'service' | 'treasury';

/**
 * Optional naming context other packages accept as injected
 * parameter. Apps that don't use naming pass nothing; apps that do
 * resolve names via @agenticprimitives/agent-naming and populate
 * this shape before invoking downstream packages.
 *
 * Invariants every consumer MUST respect:
 *   - `agentName` is a DISPLAY field. Policy decisions / signature
 *     bindings MUST be derivable from address; name can never be
 *     the sole authority.
 *   - Missing fields are not a security failure — name is optional.
 *   - Consumers MUST NOT treat name as a stable identifier across
 *     transfers. The address is the stable identifier.
 */
export interface NameContext {
  /** Resolved name of the subject (e.g. 'alice.agent'). */
  agentName?: string;
  /** Discriminator for branching: person vs org vs service vs treasury. */
  agentType?: AgentType;
}
