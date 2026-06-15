/**
 * W3C Verifiable Credentials 2.0 envelope types + `Eip712Signature2026` proof
 * type. Substrate for all spine credential classes (Association, Evidence,
 * Outcome, Validation, TrustUpdate, AgreementCredential, PaymentReceipt, ...).
 *
 * Authoritative spec: specs/242-trust-credentials-and-public-assertions.md §4.
 * Architecture-of-record: ADR-0023 + ADR-0024 (composability table).
 */

import type { Address, Hex } from '@agenticprimitives/types';

export type Hex32 = `0x${string}`;
export type ISODate = string;

/** W3C VC 2.0 default context. */
export const VC_CONTEXT_V2 = 'https://www.w3.org/ns/credentials/v2' as const;

/** Substrate's Eip712Signature2026 context (proof-type alongside W3C VC). */
export const EIP712_SIG_2026_CONTEXT =
  'https://agenticprimitives.dev/contexts/eip712-signature-2026/v1' as const;

/**
 * Discriminator for the proof type. Primary in W1; BBS+ / SD-JWT reserved per
 * PD-28 (privacy doc §2.3).
 */
export type ProofType =
  | 'Eip712Signature2026'
  | 'DataIntegrityProof' // reserved for BBS+ (W2)
  | 'SdJwtProof'; // reserved (W2)

/**
 * The primary W1 proof shape — EIP-712 typed-data signature verified via
 * ERC-1271 against the issuer SA.
 *
 * Per ADR-0023:
 * - `verificationMethod` SHOULD be a CAIP-10 reference to the issuer's SA.
 * - `proofPurpose` is `assertionMethod` for issuer-attested credentials,
 *   `authentication` for holder-asserted ones.
 */
export interface Eip712Signature2026Proof {
  type: 'Eip712Signature2026';
  created: ISODate;
  verificationMethod: string; // e.g. `eip155:8453:0xIssuer#assertion-key-1`
  proofPurpose: 'assertionMethod' | 'authentication' | 'capabilityInvocation';
  /** Hex-encoded ERC-1271-verifiable signature. */
  proofValue: Hex;
  /** Optional EIP-712 domain hash for cross-stack reconciliation. */
  eip712Domain?: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: Address;
  };
  /** Optional canonical-hash receipt of the credential body (RFC 8785 JCS). */
  credentialHash?: Hex32;
  /** Present when an issuer-AUTHORIZED operational key (e.g. Cloud KMS) signed this credential instead of
   *  the issuer's own custodian. `proofValue` is then the delegate key's signature; trust still roots in
   *  the issuer SA (`delegatorIssuer` == the credential's issuer). Lives in the proof (stripped from the
   *  credential hash), so attaching it does NOT change the signed digest. The verifier checks the leaf. */
  delegatingSigner?: DelegatingSignerProof;
}

/** Issuer authorization of an operational signing key (mirrors content-primitives' DelegatingSigner). */
export interface DelegatingSignerProof {
  /** The issuer SA the credential's trust roots in (== the credential issuer). */
  delegatorIssuer: Address;
  /** The operational key that actually signed (authorized by `delegatorIssuer`). */
  delegateKey: Address;
  /** The signed delegation binding `delegateKey` → `delegatorIssuer`. OPAQUE; the app validates it. */
  delegationLeaf: unknown;
}

/** Discriminated union for all supported proof types (W1: Eip712Signature2026 only). */
export type Proof = Eip712Signature2026Proof;

/** W3C VC StatusList2021 envelope (per `credentialStatus`). */
export interface CredentialStatus2021 {
  id: string;
  type: 'StatusList2021Entry' | 'RevocationList2020Status';
  statusPurpose?: 'revocation' | 'suspension';
  statusListIndex?: number;
  statusListCredential?: string;
}

/**
 * Per privacy doc D-42: every field MAY carry a per-field VisibilityTier
 * override; consumers MAY render a partial VC by tier.
 */
export type VisibilityTier =
  | 'Public'
  | 'PublicCoarse'
  | 'PrivateCommitment'
  | 'PrivateZK'
  | 'OffchainOnly';

export interface DisclosurePolicy {
  /** JSON-encoded { fieldPath → tier }. */
  fieldDisclosure?: Record<string, VisibilityTier>;
  /** Default tier applied to every unmapped field. */
  defaultTier: VisibilityTier;
}

/**
 * The canonical W3C VC 2.0 envelope, parameterised by the credential-subject
 * shape. Implementations of substrate credential types (Association, Evidence,
 * Outcome, Validation, TrustUpdate, AgreementCredential, PaymentReceipt) live
 * in their owning packages; this envelope is substrate-wide.
 */
export interface VerifiableCredential<TSubject extends Record<string, unknown> = Record<string, unknown>> {
  '@context': readonly string[];
  /** First element MUST be `'VerifiableCredential'`; subsequent are class names. */
  type: readonly [...string[]];
  /** CAIP-10 reference to the issuer SA (preferred), or a DID. */
  issuer: string;
  /** Issuance time. */
  validFrom: ISODate;
  /** Optional expiry. */
  validUntil?: ISODate;
  /** Credential subject — discriminated by class. */
  credentialSubject: TSubject;
  /** Optional revocation envelope (StatusList2021). */
  credentialStatus?: CredentialStatus2021;
  /** Optional schema pointer — `did:shape:<name>:<version>` (per PD-12 round-trip). */
  credentialSchema?: {
    id: string;
    type: 'JsonSchema' | 'ShaclShape';
  };
  /** Substrate per-field DisclosurePolicy (D-42). */
  disclosurePolicy?: DisclosurePolicy;
  /** The proof (W1: Eip712Signature2026). */
  proof?: Proof;
}

/** Convenience alias for a VC without a proof attached (pre-signing). */
export type UnsignedCredential<TSubject extends Record<string, unknown> = Record<string, unknown>> = Omit<
  VerifiableCredential<TSubject>,
  'proof'
>;

/**
 * Standard EIP-712 domain for the substrate's `Eip712Signature2026` proof.
 *
 * Cross-stack typehash equality: any Solidity verifier MUST compute the same
 * `typeHash` from the same primary type string + same field types. The
 * canonical primary type is `VerifiableCredentialAttestation`:
 *
 *   VerifiableCredentialAttestation(
 *     bytes32 credentialHash,
 *     string  issuer,
 *     uint64  validFrom,
 *     uint64  validUntil,
 *     string  proofPurpose
 *   )
 */
export const VC_EIP712_TYPES = {
  VerifiableCredentialAttestation: [
    { name: 'credentialHash', type: 'bytes32' },
    { name: 'issuer', type: 'string' },
    { name: 'validFrom', type: 'uint64' },
    { name: 'validUntil', type: 'uint64' },
    { name: 'proofPurpose', type: 'string' },
  ],
} as const;

export const VC_DOMAIN_NAME = 'AgenticPrimitivesVC' as const;
export const VC_DOMAIN_VERSION = '1' as const;
