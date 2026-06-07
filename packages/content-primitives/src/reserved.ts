// Reserved API surface for later phases (spec 266 §6). These lock the shape so
// apps can be written against them, and throw until implemented — mirroring the
// agent-naming Phase-1 skeleton discipline. NO silent no-ops (ADR-0013).

/**
 * Zero-knowledge inclusion / "AI-cited-correctly" proof (spec 266 Phase 4).
 * Reserved — proves a commitment is in a corpus (or that a citation is
 * faithful) without revealing the rendering.
 */
export async function buildInclusionZkProof(): Promise<never> {
  throw new Error('verifiable-content: ZK proofs are reserved (spec 266 Phase 4)');
}

/**
 * Bind a payment mandate to entitlement issuance for paid access (spec 266
 * Phase 5). Reserved.
 */
export function bindPaymentMandate(): never {
  throw new Error('verifiable-content: paid access is reserved (spec 266 Phase 5)');
}
