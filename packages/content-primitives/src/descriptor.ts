import { keccak256, sha256, concat, toBytes, type Hex } from 'viem';
import { jcsCanonicalize } from '@agenticprimitives/verifiable-credentials';
import type { BuildDescriptorInput, ContentCommitment, ContentDescriptor, DelegatingSigner, DelegatedAuthorityVerifier, SignatureVerifier } from './types.js';
import { leafHash, verifyInclusion } from './merkle.js';
import { CommitmentMismatchError } from './errors.js';

/**
 * The frozen Phase-1 normalization profile id (spec 266 §7). Rules of
 * `canonical-text-v1`: NFC; trim leading/trailing whitespace; collapse internal
 * whitespace runs to a single space; text body only (verse numbers, labels,
 * footnotes, headings, cross-refs, formatting are excluded by the caller before
 * commitment); digest SHA-256 over UTF-8. Bump the version to change any rule.
 */
export const NORMALIZATION_V1 = 'ap:normalization:canonical-text-v1';

/** Apply the canonical-text-v1 normalization to a rendering body. */
export function canonicalizeRendering(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * Structured commitment to an off-platform rendering (spec 266 §7):
 * SHA-256 of the canonical-text-v1-normalized body. SHA-256 (not keccak) keeps
 * the content commitment portable/standard; it is verified off-chain and never
 * stored on-chain (ADR-0033 R3). Binds a descriptor to a rendering WITHOUT
 * revealing it.
 */
export function contentCommitment(text: string): ContentCommitment {
  return {
    type: 'canonicalTextCommitment',
    normalization: NORMALIZATION_V1,
    algorithm: 'sha-256',
    value: sha256(toBytes(canonicalizeRendering(text))),
  };
}

/** True iff `text` canonicalizes+hashes to the commitment value. */
export function verifyCommitment(text: string, commitment: ContentCommitment): boolean {
  if (commitment.algorithm !== 'sha-256' || commitment.normalization !== NORMALIZATION_V1) return false;
  return contentCommitment(text).value.toLowerCase() === commitment.value.toLowerCase();
}

/** Throwing variant of {@link verifyCommitment}. */
export function assertCommitment(text: string, commitment: ContentCommitment): void {
  if (!verifyCommitment(text, commitment)) {
    throw new CommitmentMismatchError('rendering does not match descriptor commitment');
  }
}

/** Domain separator for the descriptor identity (distinct from the locus id). */
const DESCRIPTOR_DOMAIN_SEP = 'ap:content-descriptor:v1\0';

/**
 * Deterministic, domain-separated hash of the unsigned descriptor — both its
 * cryptographic identity (ContentDescriptorId) AND the ERC-1271 signing
 * preimage. `keccak256("ap:content-descriptor:v1\0" || JCS(unsigned))`. The
 * domain separator keeps it from ever colliding with a canonical-locus id.
 */
export function descriptorHash(d: BuildDescriptorInput): Hex {
  return keccak256(concat([toBytes(DESCRIPTOR_DOMAIN_SEP), toBytes(jcsCanonicalize(d))]));
}

/**
 * Build a signed {@link ContentDescriptor}. `sign` signs {@link descriptorHash} — either as the issuer's
 * own Smart Agent (ERC-1271), or, when `delegatingSigner` is given, as the issuer-AUTHORIZED operational
 * key (e.g. Cloud KMS). The attached `delegatingSigner` lets a verifier root trust in the issuer SA while
 * the day-to-day signing key is delegated/rotatable (no issuer custodian key held).
 */
export async function buildContentDescriptor(
  input: BuildDescriptorInput,
  sign: (hash: Hex) => Promise<Hex> | Hex,
  delegatingSigner?: DelegatingSigner,
): Promise<ContentDescriptor> {
  const signature = await sign(descriptorHash(input));
  return { ...input, signature, ...(delegatingSigner ? { delegatingSigner } : {}) };
}

export interface VerifyDescriptorOpts {
  /** Verifies an ERC-1271/ECDSA signature by a signer (injected; ADR-0006). */
  verifySignature: SignatureVerifier;
  /** Verifies an issuer→delegate authorization leaf — REQUIRED when the descriptor carries
   *  `delegatingSigner` (else delegate-signed descriptors fail closed). Injected (ADR-0006). */
  verifyDelegatedAuthority?: DelegatedAuthorityVerifier;
  /** Required when proofPolicy is `merkle-membership-v1`. */
  corpusRoot?: Hex;
  inclusionProof?: Hex[];
  /** Current time (seconds) for validity/status checks; defaults to now. */
  nowSeconds?: number;
}

/** Result of {@link verifyContentDescriptor} — an auditable VerificationResult. */
export interface VerificationResult {
  ok: boolean;
  reason?: string;
  signatureVerified: boolean;
  statusOk: boolean;
  withinValidity: boolean;
  inclusionVerified?: boolean;
}

/**
 * Verify a descriptor fail-closed (spec 266 §7): status must be `active`, the
 * validity window must contain `now`, the issuer ERC-1271 signature over the
 * canonical descriptor hash must verify, and — for `merkle-membership-v1` — the
 * commitment must prove under `corpusRoot`. Reserved proof policies are rejected.
 */
export async function verifyContentDescriptor(
  d: ContentDescriptor,
  opts: VerifyDescriptorOpts,
): Promise<VerificationResult> {
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const statusOk = d.status === 'active';
  const fromOk = !d.validFrom || Math.floor(new Date(d.validFrom).getTime() / 1000) <= now;
  const untilOk = !d.validUntil || Math.floor(new Date(d.validUntil).getTime() / 1000) >= now;
  const withinValidity = fromOk && untilOk;

  const { signature, delegatingSigner, ...unsigned } = d;
  const hash = descriptorHash(unsigned);
  // Trust ALWAYS roots in the issuer SA. Either the issuer signed directly, or it authorized a delegate
  // key (proven by the leaf) that signed — and even then the descriptor's issuer.address must equal the
  // delegating issuer, so a delegate can never re-attribute a descriptor to a different issuer.
  let signatureVerified: boolean;
  let sigReason = 'issuer signature did not verify';
  if (delegatingSigner) {
    if (!opts.verifyDelegatedAuthority) {
      signatureVerified = false; sigReason = 'descriptor is delegate-signed but no delegated-authority verifier was provided';
    } else if (d.issuer.address.toLowerCase() !== delegatingSigner.delegatorIssuer.toLowerCase()) {
      signatureVerified = false; sigReason = 'delegatingSigner.delegatorIssuer ≠ descriptor issuer';
    } else {
      const authOk = await opts.verifyDelegatedAuthority(delegatingSigner);
      const sigOk = authOk && (await opts.verifySignature({ signer: delegatingSigner.delegateKey, hash, signature }));
      signatureVerified = sigOk;
      if (!authOk) sigReason = 'issuer did not authorize the delegate signing key';
      else if (!sigOk) sigReason = 'delegate-key signature did not verify';
    }
  } else {
    signatureVerified = await opts.verifySignature({ signer: d.issuer.address, hash, signature });
  }

  const base: VerificationResult = { ok: false, signatureVerified, statusOk, withinValidity };
  if (!statusOk) return { ...base, reason: `descriptor status is ${d.status}` };
  if (!withinValidity) return { ...base, reason: 'descriptor outside its validity window' };
  if (!signatureVerified) return { ...base, reason: sigReason };

  switch (d.proofPolicy) {
    case 'issuer-signature-v1':
    case 'issuer-signature-and-hash-v1':
      return { ...base, ok: true };
    case 'merkle-membership-v1': {
      if (!d.commitment || !opts.corpusRoot || !opts.inclusionProof) {
        return { ...base, reason: 'merkle-membership-v1 requires commitment + corpusRoot + inclusionProof' };
      }
      const inclusionVerified = verifyInclusion(leafHash(d.commitment.value), opts.inclusionProof, opts.corpusRoot);
      return { ...base, ok: inclusionVerified, inclusionVerified, reason: inclusionVerified ? undefined : 'commitment not included under corpusRoot' };
    }
    default:
      return { ...base, reason: `proofPolicy ${d.proofPolicy} is reserved (spec 266 §6/§8)` };
  }
}
