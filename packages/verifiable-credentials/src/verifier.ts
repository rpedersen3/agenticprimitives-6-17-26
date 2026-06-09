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

/** Parsed `eip155:<chainId>:<address>` CAIP-10 reference. */
export interface Caip10Eip155 {
  chainId: number;
  address: `0x${string}`;
}

/** Parse an `eip155:<chainId>:0x…40` CAIP-10 account id, or null. Both `vc.issuer` and the
 *  `verificationMethod` prefix use this form — the VC-2 domain-binding source of truth. */
export function parseEip155Caip10(ref: string): Caip10Eip155 | null {
  const m = /^eip155:(\d+):(0x[0-9a-fA-F]{40})$/.exec(ref);
  if (!m) return null;
  return { chainId: Number(m[1]), address: m[2] as `0x${string}` };
}

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
  // VC-1: `credentialHash` is MANDATORY — a forger must not be able to drop it to skip the
  // body-integrity check. Missing OR mismatched is a structural failure.
  if (!proof.credentialHash) {
    issues.push('proof.credentialHash is required (binds the proof to the canonical credential body)');
  } else if (proof.credentialHash !== bodyHash) {
    issues.push(
      `proof.credentialHash (${proof.credentialHash}) does not match canonical hash of credential body (${bodyHash})`,
    );
  }

  // VC-2: the EIP-712 domain is attacker-supplied inside the proof. Bind it to the credential's
  // declared `issuer` SA — the digest is meaningless if it can be computed against a contract /
  // chain the attacker controls. `verifyingContract` MUST equal the issuer SA, `chainId` MUST equal
  // the issuer's chain, and the `verificationMethod` address MUST resolve to the same SA.
  const issuerAcct = parseEip155Caip10(vc.issuer);
  if (!issuerAcct) {
    issues.push(`vc.issuer is not a verifiable eip155 CAIP-10 account id: ${vc.issuer}`);
  } else {
    if (proof.eip712Domain.verifyingContract.toLowerCase() !== issuerAcct.address.toLowerCase()) {
      issues.push(
        `proof.eip712Domain.verifyingContract (${proof.eip712Domain.verifyingContract}) MUST equal the issuer SA (${issuerAcct.address})`,
      );
    }
    if (proof.eip712Domain.chainId !== issuerAcct.chainId) {
      issues.push(
        `proof.eip712Domain.chainId (${proof.eip712Domain.chainId}) MUST equal the issuer chainId (${issuerAcct.chainId})`,
      );
    }
    const vmAcct = parseEip155Caip10(proof.verificationMethod.split('#')[0] ?? '');
    if (!vmAcct || vmAcct.address.toLowerCase() !== issuerAcct.address.toLowerCase()) {
      issues.push(
        `proof.verificationMethod (${proof.verificationMethod}) MUST resolve to the issuer SA (${issuerAcct.address})`,
      );
    }
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

/** Minimal ERC-1271 verifier seam — satisfied structurally by a viem `PublicClient`
 *  (`client.verifyHash({ address, hash, signature })`). Kept structural so the package stays a
 *  graph leaf and isn't pinned to a single viem version. */
export interface Erc1271Verifier {
  verifyHash(args: {
    address: `0x${string}`;
    hash: `0x${string}`;
    signature: `0x${string}`;
  }): Promise<boolean>;
}

export interface VerifyCredentialResult {
  /** True ONLY when the structural checks pass AND the issuer SA's ERC-1271 path validates the
   *  signature over the expected digest. Fail-closed: any error/anomaly → false. */
  valid: boolean;
  /** The structural sub-result (digest, proof value, issuer ref, issues). */
  structuralResult: VerificationResult;
  /** All issues — structural plus signature/verification failures. */
  issues: string[];
}

/**
 * Full credential verification (VC-1): structural checks PLUS the on-chain ERC-1271 round-trip
 * against the issuer SA resolved from `vc.issuer`. This is the function consumers (content
 * entitlements, agent-skills, geo-features, related-agents) MUST gate on — `verifyCredentialStructural`
 * alone proves nothing about the signature.
 *
 * Fail-closed per ADR-0013: a structural failure, an unresolvable issuer, a verification-call error,
 * or a non-validating signature all return `valid: false` — never a silent accept.
 */
export async function verifyCredential(
  vc: VerifiableCredential,
  client: Erc1271Verifier,
): Promise<VerifyCredentialResult> {
  const structuralResult = verifyCredentialStructural(vc);
  const issues = [...structuralResult.issues];
  if (!structuralResult.structural || !structuralResult.expectedDigest || !structuralResult.proofValue) {
    return { valid: false, structuralResult, issues };
  }
  const issuerAcct = parseEip155Caip10(vc.issuer);
  if (!issuerAcct) {
    issues.push('cannot resolve issuer SA for ERC-1271 verification');
    return { valid: false, structuralResult, issues };
  }
  let ok: boolean;
  try {
    ok = await client.verifyHash({
      address: issuerAcct.address,
      hash: structuralResult.expectedDigest,
      signature: structuralResult.proofValue,
    });
  } catch (e) {
    issues.push(`ERC-1271 verification call failed: ${e instanceof Error ? e.message : String(e)}`);
    return { valid: false, structuralResult, issues };
  }
  if (!ok) issues.push('issuer ERC-1271 signature did not validate over the expected digest');
  return { valid: ok, structuralResult, issues };
}
