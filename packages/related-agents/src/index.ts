/**
 * @agenticprimitives/related-agents — private, holder-resident credentials that
 * link a person to a RELATED agent (e.g. an org they created via a relying app),
 * plus the scoped-delegation caveats a grantee gets to read related-agent
 * metadata.
 *
 * person↔org is PRIVATE vault state, NEVER an on-chain edge (ADR-0025). This
 * package owns the credential SHAPE + the scoped-delegation caveat set + the
 * list-query types — not the storage (Connect-home vault) nor the vocabulary
 * (`purpose` is a free string; no vertical terms — ADR-0021).
 *
 * Composes `verifiable-credentials` (DOLCE+DnS Situation + EIP-712 proof) +
 * `delegation` (caveats). Sibling of `agent-relationships`, which owns ON-CHAIN
 * edges only — this is the off-chain, holder-resident, private counterpart.
 *
 * Authoritative spec: specs/246-related-agents-vault.md
 */

import {
  buildSituation,
  credentialHash,
  VC_CONTEXT_V2,
  type Situation,
  type UnsignedCredential,
  type Hex32,
  type VisibilityTier,
} from '@agenticprimitives/verifiable-credentials';
import {
  buildCaveat,
  encodeTimestampTerms,
  encodeValueTerms,
  encodeAllowedTargetsTerms,
} from '@agenticprimitives/delegation';
import type { Address, Hex, Caveat, Delegation } from '@agenticprimitives/delegation';

export const PACKAGE_NAME = '@agenticprimitives/related-agents';
export const PACKAGE_STATUS = 'w1-foundational' as const;
export const SPEC_REF = 'specs/246-related-agents-vault.md';

/** DOLCE Description for the related-agent situation credential. */
export const RELATED_AGENT_DESCRIPTION = 'apra:RelatedAgentCredential';

/** The freeform body of a related-agent credential (NOT the roles/participants). */
export interface RelatedAgentBody extends Record<string, unknown> {
  /** Human-readable name of the related agent (e.g. the org's `.impact` name). */
  agentName: string;
  /** Optional app-level kind tag (opaque to this package). */
  agentKind?: string;
}

export type RelatedAgentCredential = UnsignedCredential<Situation<{ payload: RelatedAgentBody }>>;

export interface BuildRelatedAgentCredentialArgs {
  /** The person SA — holder AND (self-issued) issuer of the credential. */
  holder: Address;
  /** The related agent SA (e.g. the org). */
  relatedAgent: Address;
  /** App-level purpose tag, e.g. `jp-adopter-org` (free string — no vocabulary here). */
  purpose: string;
  /** The relying app that requested the link (its OIDC `client_id`). */
  requestedBy: string;
  /** CAIP-10 issuer id (the person home); `eip155:<chainId>:<holder>`. */
  issuerCaip10: string;
  body: RelatedAgentBody;
  validFrom: string;
  validUntil?: string;
  /** Defaults to 'private' — person↔org links are private by default (ADR-0025). */
  visibility?: VisibilityTier;
}

/** Build the unsigned, self-issued related-agent situation credential. The caller
 *  signs it with the holder's ROOT credential (issuer = holder = personSA). */
export function buildRelatedAgentCredential(args: BuildRelatedAgentCredentialArgs): RelatedAgentCredential {
  const situation = buildSituation<{ payload: RelatedAgentBody }>({
    description: RELATED_AGENT_DESCRIPTION,
    roles: {
      holder: args.holder,
      relatedAgent: args.relatedAgent,
      issuer: args.holder, // self-issued
    },
    body: { payload: args.body },
    participants: {
      purpose: args.purpose,
      requestedBy: args.requestedBy,
      visibility: args.visibility ?? 'private',
    },
  });
  return {
    '@context': [VC_CONTEXT_V2],
    type: ['VerifiableCredential', 'RelatedAgentCredential'],
    issuer: args.issuerCaip10,
    validFrom: args.validFrom,
    validUntil: args.validUntil,
    credentialSubject: situation,
  };
}

/** The credential hash a relying app holds as `proofHash` (RFC-8785 JCS keccak). */
export function relatedAgentProofHash(credential: RelatedAgentCredential): Hex32 {
  return credentialHash(credential);
}

// ─── Scoped delegation a grantee gets to READ related-agent metadata ────────

export interface RelatedAgentReadCaveatArgs {
  /** Deployment enforcer addresses (supplied by the app — NOT hardcoded here). */
  enforcers: { timestamp: Address; value: Address; allowedTargets: Address };
  /** Unix seconds the grant is valid until. */
  validUntil: number;
  /** The read targets the grantee may call (e.g. naming + relationship contracts). */
  allowedTargets: Address[];
  /** Optional valid-after (defaults 0). */
  validAfter?: number;
}

/** Build the standard scoped-read caveat set for a related-agent delegation
 *  (org→relying-site OR org→broker-org): time-bounded, zero-value, target-scoped.
 *  Reuses the `delegation` caveat primitives — no new enforcer. */
export function relatedAgentReadCaveats(args: RelatedAgentReadCaveatArgs): Caveat[] {
  return [
    buildCaveat(args.enforcers.timestamp, encodeTimestampTerms(args.validAfter ?? 0, args.validUntil)),
    buildCaveat(args.enforcers.value, encodeValueTerms(0n)),
    buildCaveat(args.enforcers.allowedTargets, encodeAllowedTargetsTerms(args.allowedTargets)),
  ];
}

// ─── List-query shapes (served by Connect; consumed by relying apps) ────────

/** A related-agent link a relying app receives or lists — carries NO person id. */
export interface RelatedAgentLink {
  orgAgent: Address;
  orgName: string;
  purpose: string;
  requestedBy: string;
  /** The scoped org→grantee delegation. */
  delegation: Delegation;
  /** Hash of the private vault credential backing this link. */
  proofHash: Hex32;
}

/** Response of `GET /connect/related-orgs?client_id=` (person-session-authorized). */
export interface ListRelatedAgentsResponse {
  orgs: RelatedAgentLink[];
}

/** A single org that delegated to a grantee agent (e.g. the broker org). */
export interface DelegatedAgentLink {
  orgAgent: Address;
  orgName: string;
  delegation: Delegation;
}

/** Response of `GET /connect/delegated-orgs?delegate=` (delegate-control-authorized). */
export interface ListDelegatedAgentsResponse {
  orgs: DelegatedAgentLink[];
}

export type { Address, Hex };
