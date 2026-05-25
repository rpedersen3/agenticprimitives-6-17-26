import type { Address, Hex, Caip10Address } from '@agenticprimitives/types';

// `Caip10Address` is the canonical CAIP-10 brand, now owned by
// `@agenticprimitives/types` (one brand — audit P0-2). Re-exported here so
// existing `@agenticprimitives/agent-profile` importers keep working.
export type { Caip10Address };

/**
 * Discriminator for AgentCard sub-shapes. Mirrors HCS-11 § typed-profile
 * categories with two additions specific to our model:
 *   - `treasury` (custody-policy-governed asset account)
 *   - `multisig` (collective Smart Agent with named members)
 *
 * Adding a new ProfileType requires: (a) a new sub-interface here,
 * (b) handling in `canonicalProfileJson`, (c) a golden vector test
 * in `test/profile.test.ts`.
 */
export type ProfileType =
  | 'person'
  | 'org'
  | 'service'
  | 'treasury'
  | 'mcpServer'
  | 'multisig';

/**
 * Endpoint-control verification methods (matches GoDaddy ANS
 * `mcpServer.verification` pattern; we don't import their PKI).
 *
 * - `dns-txt` — owner publishes a TXT record at a known label;
 *   resolver fetches and matches against the on-chain digest.
 * - `signed-url` — endpoint URL signed by the owner Smart Agent's
 *   ERC-1271 key.
 * - `http-challenge` — well-known path returns a value derived
 *   from the agent address.
 * - `verifiable-presentation` — W3C VP signed by the owner.
 */
export type VerificationMethod =
  | 'dns-txt'
  | 'signed-url'
  | 'http-challenge'
  | 'verifiable-presentation';

/** Common fields across all profile sub-shapes. */
interface BaseProfile {
  /** Human-friendly display name (may differ from agent-naming `displayName`). */
  displayName?: string;
  /** Free-text description. */
  description?: string;
  /** External profile / brand URL. */
  homepage?: string;
  /** Optional CAIP-10 chain-agnostic identifier (ADR-0008). */
  nativeId?: Caip10Address;
  /** Optional avatar / logo URL. */
  avatar?: string;
}

export interface AiAgentProfile extends BaseProfile {
  type: 'person' | 'org';
  /** For `org`: list of member Smart Agent addresses (informational only — authority lives in agent-relationships edges). */
  members?: Address[];
}

export interface McpServerProfile extends BaseProfile {
  type: 'mcpServer';
  /** Canonical MCP endpoint URL. */
  endpoint: string;
  /** Verification methods the owner publishes for this endpoint. */
  verification: VerificationMethod[];
  /** Optional list of tool names the server exposes (for discovery UIs). */
  tools?: string[];
}

export interface MultisigProfile extends BaseProfile {
  type: 'multisig';
  /** Threshold for the collective Smart Agent's CustodyPolicy. */
  threshold: number;
  /** Named members — each member's Smart Agent address. */
  members: Address[];
}

export interface ServiceProfile extends BaseProfile {
  type: 'service' | 'treasury';
  /** Canonical service endpoint (A2A / MCP / HTTP). */
  endpoint?: string;
}

export type AgentCard = AiAgentProfile | McpServerProfile | MultisigProfile | ServiceProfile;

export interface AgentIdentityClientOpts {
  rpcUrl: string;
  chainId: number;
}

/**
 * Input to `AgentIdentityClient.publishProfile`. The client computes
 * `profileContentHash` from `profile` and asserts it matches the
 * caller-supplied `expectedHash` (anti-mutation invariant).
 */
export interface PublishProfileInput {
  /** Smart Agent address publishing the profile. */
  agent: Address;
  /** Profile JSON to publish. The SDK computes its canonical content-hash. */
  profile: AgentCard;
  /**
   * URI where the canonical-JSON profile is hosted. The caller is
   * responsible for uploading the JSON to this URI BEFORE calling
   * publishProfile — storage is intentionally out of the SDK's scope
   * (per ADR-0007: identity stack stays storage-agnostic).
   */
  metadataURI: string;
  /** Optional caller-computed hash for self-check (asserted == computed). */
  expectedHash?: Hex;
  /**
   * For first-time publication only — registers the agent's profile
   * with these initial fields before setting the metadata anchor.
   * Omit (or pass {}) once the agent has already called `register`.
   */
  registerWith?: {
    displayName?: string;
    description?: string;
    agentKind?: Hex;
    profileSchemaURI?: string;
  };
}
