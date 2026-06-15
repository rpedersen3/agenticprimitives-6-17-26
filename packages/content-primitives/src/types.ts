import type { Address, Hex } from '@agenticprimitives/types';
import type { VerifiableCredential } from '@agenticprimitives/verifiable-credentials';

/**
 * Who may retrieve a rendering (apcnt:accessPolicy codelist; spec 266 §2.2).
 * `public` needs no entitlement; `licensed`/`private` are gated. An accessPolicy
 * is a POLICY INPUT, never a legal grant (ADR-0033 R5; spec 266 §threat-model).
 */
export type AccessPolicy = 'public' | 'licensed' | 'private';

/**
 * How a descriptor's authenticity/inclusion is proven (apcnt:proofPolicy). The
 * enum is fixed now so apps can target it; Phase 1 implements the `*-v1`
 * signature/hash/merkle paths — the rest are reserved (spec 266 §6/§8).
 */
export type ProofPolicy =
  | 'issuer-signature-v1'
  | 'issuer-signature-and-hash-v1'
  | 'merkle-membership-v1'
  | 'signed-api-response-v1' // reserved
  | 'entitlement-attestation-v1' // reserved
  | 'zk-membership-v1'; // reserved (Phase 4)

/** Lifecycle of a descriptor. Verification is fail-closed on non-`active`. */
export type DescriptorStatus = 'active' | 'revoked' | 'superseded';

/** Rights posture of the underlying work (a policy input, not a grant). */
export type RightsStatus = 'public-domain' | 'open-license' | 'licensed' | 'unknown';

/** Phase-1 trust profiles (spec 266 §policy). Only `public-domain-demo` is wired.
 *  Generic, vertical-agnostic names — an app may map them to domain labels. */
export type TrustProfile =
  | 'public-domain-demo'
  | 'strict-verified-issuer'
  | 'community-experimental'
  | 'restricted-high-assurance';

/**
 * A scheme-independent, structured canonical locus. The CORE treats this as an
 * OPAQUE record. Its keys MUST be controlled tokens (never user strings, display
 * labels, or surface-grammar strings) supplied by a vertical-extension package,
 * because JCS does NOT Unicode-normalize strings — the extension normalizes all
 * surface forms to controlled tokens BEFORE they reach the hash. Two surface
 * grammars that denote the same locus MUST produce an equal canonical locus.
 */
export type CanonicalLocus = Record<string, unknown>;

/**
 * The hashed envelope (spec 266 §2.1). The id commits not just to the locus
 * fields but to the PROFILE that defines their meaning + the domain — so the
 * same JSON can never conceptually collide across primitives or versions.
 */
export interface CanonicalLocusEnvelope {
  /** Fixed id construction scheme, e.g. 'ap-locus-id-v1'. */
  idScheme: string;
  /** Vertical domain tag, e.g. 'lyrics' / 'legal-code' / 'doc'. */
  contentDomain: string;
  /** Versioned locus profile (the governance seam), e.g. 'ap.<domain>.locus.v1'. */
  locusProfile: string;
  /** The controlled-token canonical locus (opaque to the core). */
  canonicalLocus: CanonicalLocus;
}

/** FRBR Work locus: the deterministic, domain-separated id of an envelope. */
export interface CanonicalReference {
  /** keccak256("ap:canonical-locus-id:v1\0" || JCS(envelope)) — registry-free. */
  id: Hex;
  /** The envelope the id was computed from. */
  envelope: CanonicalLocusEnvelope;
  /** Optional human alias that resolved to this reference (e.g. 'doc:section-1.2'). */
  alias?: string;
}

/** Commitment to off-platform rendering text (structured + versioned; spec 266 §7). */
export interface ContentCommitment {
  type: 'canonicalTextCommitment';
  /** The frozen normalization profile id, e.g. 'ap:normalization:canonical-text-v1'. */
  normalization: string;
  /** Digest algorithm of the normalized text. */
  algorithm: 'sha-256';
  /** Digest value (hex). NEVER the text (ADR-0033 R3). */
  value: Hex;
}

/**
 * FRBR Expression/Manifestation — a versioned body of renderings published by an
 * issuer Smart Agent, committed by a Merkle `corpusRoot` + signed manifest.
 * Carries NO rendering text (ADR-0033 R3).
 */
export interface CorpusManifest {
  /** keccak256(utf8(`${issuer}/${edition}/${version}`)). */
  corpusRef: Hex;
  issuer: Address;
  edition: string;
  version: string;
  /** The content type this corpus renders (e.g. 'text.passage'). */
  scheme: string;
  /** Merkle root over the per-locus descriptor commitments. */
  corpusRoot: Hex;
  accessPolicy: AccessPolicy;
  proofPolicy: ProofPolicy;
  /** keccak/sha digest of the off-chain license-terms doc (R5). Never the terms. */
  licenseTermsHash: Hex;
  metadataUri?: string;
}

/** Bibliographic metadata about the underlying work (policy inputs). */
export interface WorkMeta {
  title?: string;
  abbreviation?: string;
  language?: string;
  edition?: string;
  rightsStatus?: RightsStatus;
}

/** Issuer reference — a Smart Agent address plus an optional DID/CAIP-10 label. */
export interface IssuerIdentityRef {
  address: Address;
  /** Optional CAIP-10 / DID label for display + verificationMethod. */
  did?: string;
}

/**
 * FRBR Item — an issuer's signed claim about a rendering of a canonical locus.
 * Points AT off-chain text via `retrievalPointer`; NEVER contains it (R3).
 * Trust flows from `signature` (issuer ERC-1271), not the platform (R5).
 */
export interface ContentDescriptor {
  /** Stable descriptor id (issuer-scoped), e.g. 'desc_bsb_<canonicalIdShort>'. */
  id: string;
  /** The scheme-independent canonical locus this describes. */
  canonicalId: Hex;
  /** Opaque app content type, e.g. 'text.passage'. */
  contentType: string;
  issuer: IssuerIdentityRef;
  issuedAt: string;
  status: DescriptorStatus;
  version?: string;
  validFrom?: string;
  validUntil?: string;
  revocationRef?: string;
  /** Bibliographic metadata (title/language/edition/rightsStatus). */
  work?: WorkMeta;
  /** Structured domain semantics supplied by the vertical (e.g. section/line/edition). */
  selector?: Record<string, unknown>;
  /** Commitment to the off-platform rendering (optional for signature-only proofs). */
  commitment?: ContentCommitment;
  /** URI/locator for the off-chain text. NEVER the text itself (R3). */
  retrievalPointer: string;
  proofPolicy: ProofPolicy;
  accessPolicy: AccessPolicy;
  /** Membership corpus (when proofPolicy is merkle-membership-v1). */
  corpusRef?: Hex;
  /** Signature over descriptorHash(unsigned). Either the issuer's own ERC-1271 signature, OR — when
   *  `delegatingSigner` is present — a signature by the delegated signing key the issuer authorized. */
  signature: Hex;
  /** Present when the descriptor was signed by an issuer-AUTHORIZED operational key (e.g. a Cloud-KMS
   *  key the issuer delegated) rather than the issuer's own custodian. Trust still roots in the issuer
   *  SA (`delegatorIssuer` == `issuer.address`); the leaf proves the issuer authorized `delegateKey`. */
  delegatingSigner?: DelegatingSigner;
}

/** An issuer's authorization of an operational signing key (spec 266 + spec 270 session-delegation). */
export interface DelegatingSigner {
  /** The canonical issuer SA the descriptor's trust roots in (e.g. lbsb.impact). Equals `issuer.address`. */
  delegatorIssuer: Address;
  /** The operational key that actually signed the descriptor — authorized by `delegatorIssuer`. */
  delegateKey: Address;
  /** The signed delegation binding `delegateKey` → `delegatorIssuer`. OPAQUE here; the app's injected
   *  {@link DelegatedAuthorityVerifier} validates it (keeps content-primitives delegation-agnostic). */
  delegationLeaf: unknown;
}

/**
 * Verifies a signature over a hash by `signer`. Apps inject one backed by an
 * `AgentAccountClient.isValidSignature` (ERC-1271/6492); tests inject a fake.
 * Decoupled per ADR-0006's injected-context pattern.
 */
export type SignatureVerifier = (args: {
  signer: Address;
  hash: Hex;
  signature: Hex;
}) => Promise<boolean> | boolean;

/**
 * Verifies that `delegatorIssuer` authorized `delegateKey` to sign content on its behalf, by validating
 * the signed `delegationLeaf` (the leaf's delegator == delegatorIssuer, delegate == delegateKey, signed by
 * delegatorIssuer's ERC-1271, within caveats). Injected (ADR-0006) so content-primitives stays free of the
 * delegation package.
 */
export type DelegatedAuthorityVerifier = (args: DelegatingSigner) => Promise<boolean> | boolean;

/** Input to {@link buildContentDescriptor} (everything but the signature + how-it-was-signed metadata). */
export type BuildDescriptorInput = Omit<ContentDescriptor, 'signature' | 'delegatingSigner'>;

/** A credential asserting a subject may access a corpus (apcnt:Entitlement). */
export type Entitlement = VerifiableCredential<{
  id: string;
  corpusRef: Hex;
  accessPolicy: AccessPolicy;
  terms?: string;
}>;

/** The AI-safe citation record (apcnt:CitationAssertion). Carries provenance,
 *  never rendering text. */
export type CitationAssertion = VerifiableCredential<{
  id: string;
  /** Agentic provenance — which run/output cited this. */
  agentRunId?: string;
  outputId?: string;
  citationKind: 'quote' | 'reference' | 'summary' | 'paraphrase';
  canonicalId: Hex;
  descriptorId: string;
  contentType: string;
  commitment?: ContentCommitment;
  commitmentVerified: boolean;
  /** Optional hash of the specific quoted span + the normalization used. */
  quoteSpanHash?: Hex;
  normalizationSpec?: string;
  issuer: Address;
  underEntitlement?: string;
}>;
