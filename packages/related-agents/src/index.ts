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
import { keccak256, toBytes, encodeAbiParameters } from 'viem';

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
  /** spec 271 (W0) — the recoverable custody descriptor for this related agent SA. Private (the credential
   *  is `visibility: private`); lets an authenticated owner reconstruct the SA's custodian (ADR-0035). */
  custody?: CustodyDescriptor;
}

// ─── Recoverable custody descriptor (spec 271 / ADR-0035 pillar 1) ──────────

/** How an SA's custodian is reconstructed. For `kms-subject` the owner's `(iss,sub)` is DELIBERATELY
 *  absent — it is supplied by the live owner session at recovery time, so the descriptor alone never
 *  identifies the owner (RC-INV-3 / ADR-0025 privacy). */
export type CustodyKind =
  | { kind: 'kms-subject'; rotation: number }
  | { kind: 'passkey'; credentialId: string }
  | { kind: 'eoa'; address: Address };

/** The recoverable record of how an SA is custodied. Persisted (by the app/Connect, never this package)
 *  in the owner's PRIVATE related vault. The `salt` is the otherwise-discarded deployment salt
 *  (random per ADR-0010); reconstruction also needs the KMS master + an authenticated owner session, so
 *  the descriptor alone grants nothing (RC-INV-1). */
export interface CustodyDescriptor {
  /** The SA this descriptor reconstructs the custodian for (== the credential's `relatedAgent` role). */
  targetSA: Address;
  /** The deployment salt (bytes32). The piece lost today when an org SA deploys with a random salt. */
  salt: Hex;
  /** The custodian reconstruction method. */
  custody: CustodyKind;
}

const CD_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CD_BYTES32 = /^0x[0-9a-fA-F]{64}$/;

/** Validate + canonicalize a custody descriptor. Rebuilds `custody` field-by-field so no extra field
 *  (e.g. a smuggled `iss`/`sub`) can survive into the stored record (RC-INV-3). Fail-closed on bad input. */
export function buildCustodyDescriptor(d: CustodyDescriptor): CustodyDescriptor {
  if (!CD_ADDRESS.test(d.targetSA)) throw new Error('custody descriptor: targetSA must be a 20-byte address');
  if (!CD_BYTES32.test(d.salt)) throw new Error('custody descriptor: salt must be bytes32 (0x + 64 hex)');
  let custody: CustodyKind;
  switch (d.custody.kind) {
    case 'kms-subject': {
      const { rotation } = d.custody;
      if (!Number.isInteger(rotation) || rotation < 0) {
        throw new Error('custody descriptor: kms-subject rotation must be a non-negative integer');
      }
      custody = { kind: 'kms-subject', rotation }; // explicit — drops any smuggled owner identifier
      break;
    }
    case 'passkey': {
      if (!d.custody.credentialId) throw new Error('custody descriptor: passkey requires credentialId');
      custody = { kind: 'passkey', credentialId: d.custody.credentialId };
      break;
    }
    case 'eoa': {
      if (!CD_ADDRESS.test(d.custody.address)) throw new Error('custody descriptor: eoa address invalid');
      custody = { kind: 'eoa', address: d.custody.address };
      break;
    }
    default:
      throw new Error(`custody descriptor: unknown custody kind ${(d.custody as { kind?: string }).kind}`);
  }
  return { targetSA: d.targetSA, salt: d.salt, custody };
}

// ─── Related-agent write challenge (AUDIT NEW-RAG-2) ─────────────────────────
//
// The Connect home registers an externally-governed person→agent link (e.g. a relying-app operator's
// org) authorized by an ERC-1271 signature from a custodian of the PERSON SA. The original challenge was
// the CONSTANT `keccak256("related-orgs:write:<person>")` — no nonce/expiry/payload binding, so one
// captured signature authorized UNLIMITED writes to any link field forever (link poisoning /
// denial-of-recovery). These helpers bind the signature to (person, agent, the exact content, a one-shot
// nonce, a short expiry). Client and server BOTH derive the challenge from these so they can't drift; the
// server ALWAYS recomputes `contentHash` from the persisted fields and never trusts a client digest.

/** Bind the write to its exact content — a captured signature can only write THIS link, not arbitrary fields. */
export function relatedAgentWriteContentHash(f: {
  orgAgent: Address;
  orgName: string;
  purpose: string;
  requestedBy: string;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }],
      [f.orgAgent, keccak256(toBytes(f.orgName)), keccak256(toBytes(f.purpose)), keccak256(toBytes(f.requestedBy))],
    ),
  );
}

/** The digest a PERSON-SA custodian signs (ERC-1271) to authorize ONE related-agent write. Bound to the
 *  person, the agent, the content hash, a one-shot `nonce` (bytes32), and an `expiry` (unix seconds). */
export function hashRelatedAgentWriteChallenge(a: {
  person: Address;
  orgAgent: Address;
  contentHash: Hex;
  nonce: Hex;
  expiry: number;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'address' }, { type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }],
      [keccak256(toBytes('related-agents:write:v2')), a.person, a.orgAgent, a.contentHash, a.nonce, BigInt(a.expiry)],
    ),
  );
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
