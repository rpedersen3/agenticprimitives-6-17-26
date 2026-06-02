/**
 * Verifier — checks that a VC's proof is valid.
 *
 * For W1 the verifier is structural + signature-shape only; the ERC-1271
 * round-trip against the issuer SA on chain is delegated to consumers (who
 * already hold a viem public client). The verifier returns enough information
 * for the consumer to perform the on-chain check itself.
 *
 * Status-list resolution (StatusList2021) is likewise structural in W1 — we
 * record whether a status entry was present + which list to fetch. Per
 * ADR-0013 (no silent fallbacks) the consumer fetches the status list itself.
 */

import { credentialHash, eip712Digest, isoToSeconds } from './proof.js';
import type {
  Eip712Signature2026Proof,
  Hex32,
  Proof,
  VerifiableCredential,
} from './types.js';

export interface VerificationResult {
  /** Structural validity (envelope shape + canonical hash agreement). */
  structural: boolean;
  /** The digest the issuer SA's ERC-1271 path MUST validate. */
  expectedDigest: Hex32 | null;
  /** The proof value the consumer presents to `isValidSignatureNow`. */
  proofValue: `0x${string}` | null;
  /** The CAIP-10 issuer reference extracted from the verification method. */
  issuerCaip10: string | null;
  /** Status-list entry (if present); consumer fetches the list itself. */
  statusListId: string | null;
  /** Issues found — empty array if everything passes structural + canonical-hash checks. */
  issues: string[];
}

/**
 * Structural verification — does NOT make a network call. Returns the
 * expected digest + proof value the caller MUST forward to the issuer SA's
 * `isValidSignatureNow` (or other ERC-1271-aware path).
 */
export function verifyCredentialStructural(vc: VerifiableCredential): VerificationResult {
  const issues: string[] = [];

  if (!vc['@context'] || vc['@context'].length === 0) {
    issues.push('missing @context');
  }
  if (!vc.type || vc.type[0] !== 'VerifiableCredential') {
    issues.push('type[0] MUST be "VerifiableCredential"');
  }
  if (!vc.issuer) issues.push('missing issuer');
  if (!vc.validFrom) issues.push('missing validFrom');
  if (!vc.credentialSubject) issues.push('missing credentialSubject');

  if (vc.validUntil) {
    const until = isoToSeconds(vc.validUntil);
    const now = Math.floor(Date.now() / 1000);
    if (until < now) {
      issues.push(`credential expired at ${vc.validUntil}`);
    }
  }

  if (!vc.proof) {
    return {
      structural: false,
      expectedDigest: null,
      proofValue: null,
      issuerCaip10: null,
      statusListId: vc.credentialStatus?.statusListCredential ?? null,
      issues: [...issues, 'missing proof'],
    };
  }

  if (vc.proof.type !== 'Eip712Signature2026') {
    issues.push(`unsupported proof.type: ${(vc.proof as Proof).type}`);
    return {
      structural: false,
      expectedDigest: null,
      proofValue: null,
      issuerCaip10: null,
      statusListId: vc.credentialStatus?.statusListCredential ?? null,
      issues,
    };
  }

  const proof = vc.proof as Eip712Signature2026Proof;

  if (!proof.eip712Domain) {
    issues.push('Eip712Signature2026 proof MUST carry eip712Domain (for cross-stack verification)');
    return {
      structural: false,
      expectedDigest: null,
      proofValue: null,
      issuerCaip10: null,
      statusListId: vc.credentialStatus?.statusListCredential ?? null,
      issues,
    };
  }

  const bodyHash = credentialHash(vc);
  if (proof.credentialHash && proof.credentialHash !== bodyHash) {
    issues.push(
      `proof.credentialHash (${proof.credentialHash}) does not match canonical hash of credential body (${bodyHash})`,
    );
  }

  const expectedDigest = eip712Digest({
    credentialBodyHash: bodyHash,
    issuer: vc.issuer,
    validFrom: isoToSeconds(vc.validFrom),
    validUntil: isoToSeconds(vc.validUntil),
    proofPurpose: proof.proofPurpose,
    chainId: proof.eip712Domain.chainId,
    verifyingContract: proof.eip712Domain.verifyingContract,
  });

  const issuerCaip10 = parseCaip10IssuerFromVerificationMethod(proof.verificationMethod);

  return {
    structural: issues.length === 0,
    expectedDigest,
    proofValue: proof.proofValue,
    issuerCaip10,
    statusListId: vc.credentialStatus?.statusListCredential ?? null,
    issues,
  };
}

function parseCaip10IssuerFromVerificationMethod(method: string): string | null {
  // Format: `eip155:<chainId>:<address>#<keyName>`
  const hashIdx = method.indexOf('#');
  if (hashIdx === -1) return null;
  const ref = method.slice(0, hashIdx);
  // Light sanity check
  if (!/^eip155:\d+:0x[0-9a-fA-F]+$/.test(ref)) return null;
  return ref;
}
