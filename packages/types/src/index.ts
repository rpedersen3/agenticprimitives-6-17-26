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

// ─── CAIP-10 canonical agent id (ADR-0008 / ADR-0016) ─────────────────
//
// The TYPE lives here (types is the one brand home — audit P0-2); the
// runtime builder/parser stays in @agenticprimitives/agent-profile because
// this package is runtime-free (ADR-0008 placed `buildCaip10Address` there).

/**
 * Branded CAIP-10 account identifier — `<namespace>:<reference>:<address>`
 * (e.g. `eip155:8453:0x…`, `hedera:mainnet:0.0.x`). Constructed only via
 * `buildCaip10Address` (runtime helper in `@agenticprimitives/agent-profile`)
 * so callers can't bypass the namespace allowlist (ADR-0008).
 */
export type Caip10Address = string & { readonly __brand: 'caip10' };

/**
 * Semantic alias of {@link Caip10Address} for the SSO-subject / directory-key
 * role ([ADR-0016](../../docs/architecture/decisions/0016-canonical-agent-id-is-the-sso-subject.md)).
 * One brand, one builder. Cross-chain by construction. Distinct from
 * {@link CanonicalAgentIdentity} — that is the within-chain EVM `Address`
 * handle; THIS is the chain-qualified portable identifier.
 */
export type CanonicalAgentId = Caip10Address;

/** The three CAIP-10 parts; input to `agent-profile`'s `buildCaip10Address`. */
export interface Caip10Parts {
  namespace: string;
  reference: string;
  address: string;
}

// ─── SSO / session shapes (ADR-0016/0017; specs 223/224) ──────────────
//
// Cross-cutting so identity-directory, connect, connect-auth, and
// relying-site SDKs share one shape WITHOUT runtime coupling (same
// rationale as NameContext below). NO `owner` field — a credential
// CONTROLS an agent under custody policy; it never OWNS it (ADR-0016).

/** Assurance ladder, ordered low→high. Threads into SSO step-up (ADR-0017). */
export type Assurance = 'unverified' | 'asserted' | 'onchain-read' | 'onchain-confirmed';

/** Credential facet kinds that can authenticate a session. */
export type CredentialKind = 'passkey' | 'siwe-eoa' | 'hardware' | 'oidc';

/** What a credential is trusted for. login-grade ≠ custody-grade (ADR-0017). */
export type CredentialRole = 'login-grade' | 'custody-grade';

/** The credential that authenticated a session — a facet key, NOT the identity. */
export interface CredentialPrincipal {
  kind: CredentialKind;
  /** credentialId / EOA address / "iss#sub" — a facet key, not the identity. */
  id: string;
  assurance: Assurance;
  /** Optional: whether this credential is custody-grade (step-up) or login-grade. */
  role?: CredentialRole;
}

/**
 * The cross-origin SSO token a relying site receives from the Connect
 * broker (spec 224 §3). `sub` is the canonical subject; there is NO
 * `owner` field (ADR-0016). `BrokerSession` (the broker's own same-origin
 * session) is a different, connect-internal shape.
 */
export interface AgentSession {
  /** Canonical subject (CAIP-10). NEVER a name, NEVER a bare Address. */
  sub: CanonicalAgentId;
  /** The credential that authenticated this session. */
  principal: CredentialPrincipal;
  /** Effective assurance of the session (≤ `principal.assurance`). */
  assurance: Assurance;
  /** Relying-site `client_id` this token is bound to (exact-match). */
  aud: string;
  /** The Connect origin that issued it. */
  iss: string;
  /** Issued-at (epoch seconds). */
  iat: number;
  /** Expiry (epoch seconds). Short-lived. */
  exp: number;
  /** Replay id. */
  jti: string;
}

// ─── Agent identity shape ─────────────────────────────────────────────
//
// Cross-cutting shape so downstream packages (audit, tool-policy,
// delegation, mcp-runtime, identity-auth) can accept name + type as
// optional context WITHOUT importing @agenticprimitives/agent-naming.
//
// See ADR-0006 ("agent-naming is a resolution layer"). Naming is the
// rendering layer; binding stays at addresses. NameContext is the
// injected display + filter axis other packages can branch on.

/**
 * Discriminator for the KIND of Smart Agent a name points to.
 *
 * Three kinds only. `treasury` is NOT an agent kind — it is a kind of SERVICE
 * (`agentKind: 'service'` + a profile `serviceType` / `ProfileType: 'treasury'`
 * subtype; specs 217/225 §6). Do not re-add it here.
 */
export type AgentType = 'person' | 'org' | 'service';

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
  /** Discriminator for branching: person vs org vs service (treasury ⊂ service — not branched here). */
  agentType?: AgentType;
}
