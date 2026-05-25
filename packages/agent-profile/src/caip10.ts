/**
 * CAIP-10 chain-agnostic account identifier helpers (HCS-14 +
 * ERC-8004 aligned; ADR-0008).
 *
 * Subpath: `@agenticprimitives/agent-profile/caip10`.
 *
 * Grammar (per CAIP-10):
 *   <namespace>:<reference>:<address>
 *
 * Encoder is strict (allowlist-only namespaces); decoder is permissive
 * (any grammar-valid string accepted) — this is the "validate at write,
 * forward-compat at read" pattern.
 */

import { CAIP10_NAMESPACE_ALLOWLIST } from './constants';
import { InvalidCaip10Error } from './errors';
import type { Caip10Address } from './types';

export { CAIP10_NAMESPACE_ALLOWLIST };

const CAIP10_GRAMMAR = /^([-a-z0-9]{3,8}):([-_a-zA-Z0-9]{1,32}):([-.%a-zA-Z0-9]{1,128})$/;

export interface Caip10Parts {
  namespace: string;
  reference: string;
  address: string;
}

/**
 * Build a CAIP-10 string. Strict on the encode side — namespace must
 * be in `CAIP10_NAMESPACE_ALLOWLIST`. Address half is lowercased for
 * `eip155` so callers can't smuggle two different on-chain canonical
 * forms past the equality check.
 */
export function buildCaip10Address(parts: Caip10Parts): Caip10Address {
  const { namespace, reference, address } = parts;
  if (!CAIP10_NAMESPACE_ALLOWLIST.has(namespace)) {
    throw new InvalidCaip10Error(
      `${namespace}:${reference}:${address}`,
      `namespace "${namespace}" not in allowlist (${[...CAIP10_NAMESPACE_ALLOWLIST].join('|')})`,
    );
  }
  const normalizedAddress = namespace === 'eip155' ? address.toLowerCase() : address;
  const out = `${namespace}:${reference}:${normalizedAddress}`;
  if (!CAIP10_GRAMMAR.test(out)) {
    throw new InvalidCaip10Error(out, 'does not match CAIP-10 grammar');
  }
  return out as Caip10Address;
}

/**
 * Parse any grammar-valid CAIP-10 string into its parts. Permissive on
 * the read side — does NOT require namespace allowlist membership
 * (forward-compat: future indexers may publish namespaces we haven't
 * yet added). Throws only on grammar violations.
 */
export function parseCaip10(value: string): Caip10Parts {
  const m = CAIP10_GRAMMAR.exec(value);
  if (!m) {
    throw new InvalidCaip10Error(value, 'does not match CAIP-10 grammar');
  }
  return { namespace: m[1]!, reference: m[2]!, address: m[3]! };
}

/**
 * Grammar-only validity check (does NOT enforce the allowlist).
 * Use `buildCaip10Address` if you need allowlist enforcement.
 */
export function isValidCaip10(value: string): boolean {
  return CAIP10_GRAMMAR.test(value);
}
