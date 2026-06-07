import { keccak256, concat, toBytes, type Hex } from 'viem';
import type { Address } from '@agenticprimitives/types';
import { jcsCanonicalize } from '@agenticprimitives/verifiable-credentials';
import type { CanonicalLocusEnvelope, CanonicalReference } from './types.js';

/** The single canonical-locus id construction (pick-one; spec 266 §2.1). */
export const LOCUS_ID_SCHEME = 'ap-locus-id-v1' as const;

/** Domain separator — prevents cross-primitive / cross-version hash collisions. */
const LOCUS_ID_DOMAIN_SEP = 'ap:canonical-locus-id:v1\0';

/**
 * Deterministic, scheme-independent canonical-locus id (spec 266 §2.1):
 *   `keccak256(utf8(DOMAIN_SEP) || utf8(JCS(envelope)))`.
 *
 * The CORE treats `envelope.canonicalLocus` as opaque controlled-token bytes;
 * the vertical extension owns its meaning + validates it before this call.
 * Because the id hashes a *normalized structured envelope* (not a surface
 * string) under an explicit `locusProfile`, all surface grammars that denote the
 * same locus collide to the same id, and only a deliberate profile/versification
 * change moves it. Registry-free + reproducible — no allocator, no Smart Agent
 * (ADR-0033). keccak keeps it EVM-anchorable for the Phase-3 registry. JCS does
 * NOT Unicode-normalize strings, so callers MUST pass controlled tokens only.
 */
export function computeCanonicalId(envelope: CanonicalLocusEnvelope): Hex {
  return keccak256(concat([toBytes(LOCUS_ID_DOMAIN_SEP), toBytes(jcsCanonicalize(envelope))]));
}

/** Build a {@link CanonicalReference} from an envelope (+ optional human alias). */
export function canonicalReference(envelope: CanonicalLocusEnvelope, alias?: string): CanonicalReference {
  return { id: computeCanonicalId(envelope), envelope, ...(alias ? { alias } : {}) };
}

/**
 * Deterministic corpus reference (spec 266 §2.2).
 * `corpusRef = keccak256(utf8(`${issuer}/${edition}/${version}`))`. Issuer
 * address is lowercased so the id is independent of checksum casing.
 */
export function corpusRef(issuer: Address, edition: string, version: string): Hex {
  return keccak256(toBytes(`${issuer.toLowerCase()}/${edition}/${version}`));
}
