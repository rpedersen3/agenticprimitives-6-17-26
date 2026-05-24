import type { Address, Hex } from '@agenticprimitives/types';

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
 * Branded CAIP-10 string — `<namespace>:<reference>:<address>`.
 * Constructed only via `buildCaip10Address` so callers can't bypass
 * the namespace allowlist (Phase 1 enforcement; see ADR-0008).
 */
export type Caip10Address = string & { readonly __brand: 'caip10' };

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
  /** Profile JSON to publish. */
  profile: AgentCard;
  /** Caller-computed content hash for self-check. */
  expectedHash?: Hex;
}
