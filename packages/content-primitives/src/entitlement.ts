import type { UnsignedCredential } from '@agenticprimitives/verifiable-credentials';
import type { Address, Hex } from '@agenticprimitives/types';
import type { AccessPolicy, ContentCommitment, Entitlement } from './types.js';

export interface EntitlementDecision {
  decision: 'allow' | 'deny';
  reason?: string;
}

/**
 * Gate retrieval against a corpus's access policy (spec 266 §3 step 5).
 * Deterministic, fail-closed (spec 266 §7). An accessPolicy is a POLICY INPUT,
 * not a legal grant (ADR-0033 R5): the platform still decides here.
 *  - `public`   → allow.
 *  - `licensed`/`private` → require a presented {@link Entitlement} whose subject
 *    corpusRef matches and which has not expired.
 *  - unknown policy → deny.
 *
 * Cryptographic verification of the entitlement VC (issuer signature,
 * revocation) is the caller's job via the `verifiable-credentials` verifier —
 * pass an already-verified credential (ADR-0013: one mechanism, no fallback).
 */
export function evaluateEntitlement(
  accessPolicy: AccessPolicy,
  corpusRef: Hex,
  entitlement?: Entitlement,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): EntitlementDecision {
  if (accessPolicy === 'public') return { decision: 'allow' };
  if (accessPolicy !== 'licensed' && accessPolicy !== 'private') {
    return { decision: 'deny', reason: `unknown accessPolicy: ${String(accessPolicy)}` };
  }
  if (!entitlement) {
    return { decision: 'deny', reason: `${accessPolicy} corpus requires an entitlement` };
  }
  if (entitlement.credentialSubject.corpusRef.toLowerCase() !== corpusRef.toLowerCase()) {
    return { decision: 'deny', reason: 'entitlement is for a different corpus' };
  }
  if (entitlement.validUntil) {
    const exp = Math.floor(new Date(entitlement.validUntil).getTime() / 1000);
    if (Number.isFinite(exp) && exp < nowSeconds) {
      return { decision: 'deny', reason: 'entitlement expired' };
    }
  }
  return { decision: 'allow' };
}

export interface CitationInput {
  /** Issuer of the citation (the resolving agent's SA, CAIP-10 or DID). */
  issuer: string;
  subjectId: string;
  canonicalId: Hex;
  descriptorId: string;
  contentType: string;
  citationKind: 'quote' | 'reference' | 'summary' | 'paraphrase';
  commitment?: ContentCommitment;
  commitmentVerified: boolean;
  contentIssuer: Address;
  validFrom: string;
  /** Agentic provenance (which run/output produced the citation). */
  agentRunId?: string;
  outputId?: string;
  /** Optional hash of the specific quoted span + the normalization spec used. */
  quoteSpanHash?: Hex;
  normalizationSpec?: string;
  underEntitlement?: string;
}

/**
 * Build an UNSIGNED citation credential — the AI-safe citation record. The
 * caller signs it via `verifiable-credentials.signCredential` and emits it to
 * the audit/provenance package (spec 266 §audit; do NOT invent a parallel audit
 * model). Carries the commitment + verification result + agentic provenance,
 * NEVER the rendering text (ADR-0033 R3).
 */
export function buildCitationAssertion(input: CitationInput): UnsignedCredential<{
  id: string;
  agentRunId?: string;
  outputId?: string;
  citationKind: 'quote' | 'reference' | 'summary' | 'paraphrase';
  canonicalId: Hex;
  descriptorId: string;
  contentType: string;
  commitment?: ContentCommitment;
  commitmentVerified: boolean;
  quoteSpanHash?: Hex;
  normalizationSpec?: string;
  issuer: Address;
  underEntitlement?: string;
}> {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential', 'CitationAssertion'],
    issuer: input.issuer,
    validFrom: input.validFrom,
    credentialSubject: {
      id: input.subjectId,
      ...(input.agentRunId ? { agentRunId: input.agentRunId } : {}),
      ...(input.outputId ? { outputId: input.outputId } : {}),
      citationKind: input.citationKind,
      canonicalId: input.canonicalId,
      descriptorId: input.descriptorId,
      contentType: input.contentType,
      ...(input.commitment ? { commitment: input.commitment } : {}),
      commitmentVerified: input.commitmentVerified,
      ...(input.quoteSpanHash ? { quoteSpanHash: input.quoteSpanHash } : {}),
      ...(input.normalizationSpec ? { normalizationSpec: input.normalizationSpec } : {}),
      issuer: input.contentIssuer,
      ...(input.underEntitlement ? { underEntitlement: input.underEntitlement } : {}),
    },
  };
}
