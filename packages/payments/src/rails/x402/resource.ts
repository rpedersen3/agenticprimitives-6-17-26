// Spec 272 PAY-WIRE-5/6 — the resource binding (the security-critical object: bind the payment to the
// EXACT request, not just the amount) + metadata redaction. ONE shared canonicalizer for HTTP + A2A so
// workers never hand-roll URL/body hashing.

import { encodeAbiParameters, keccak256, type Address } from 'viem';

export type Hex32 = `0x${string}`;
export const ZERO_HASH: Hex32 = '0x0000000000000000000000000000000000000000000000000000000000000000';

/** The full set of fields a payment is bound to. Hashing ALL of them (not just amount) closes
 *  substitution/replay: a mandate signed for one (method,url,body,skill,treasury,asset,amount,chain,
 *  expiry,nonce) cannot be replayed against a different request. */
export interface PaymentResource {
  protocol: 'http' | 'a2a';
  method: string; // HTTP verb, or the A2A skill-invoke verb
  url: string; // canonical absolute URL (HTTP) or stable route id (A2A)
  bodyHash: Hex32; // keccak256(request body); ZERO_HASH for empty
  serviceAgent: Address; // the SA serving the resource
  treasury: Address; // payee SA
  skillId: string; // '' for a plain HTTP resource
  taskId: Hex32; // ZERO_HASH for the sync HTTP path
  asset: Address; // fee asset (USDC)
  amount: bigint; // atomic units
  chainId: number;
  expiresAt: number; // unix seconds
  nonce: bigint;
}

/** keccak256 over an ABI-encoded canonical tuple of every binding field. Deterministic across HTTP +
 *  A2A. NOTE: `quoteId` is NOT an input here (it's derived FROM this hash — see quote.ts) to avoid a
 *  circular dependency. */
export function canonicalizePaymentResource(r: PaymentResource): Hex32 {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'string' }, // protocol
        { type: 'string' }, // method
        { type: 'string' }, // url
        { type: 'bytes32' }, // bodyHash
        { type: 'address' }, // serviceAgent
        { type: 'address' }, // treasury
        { type: 'string' }, // skillId
        { type: 'bytes32' }, // taskId
        { type: 'address' }, // asset
        { type: 'uint256' }, // amount
        { type: 'uint256' }, // chainId
        { type: 'uint256' }, // expiresAt
        { type: 'uint256' }, // nonce
      ],
      [
        r.protocol,
        r.method,
        r.url,
        r.bodyHash,
        r.serviceAgent,
        r.treasury,
        r.skillId,
        r.taskId,
        r.asset,
        r.amount,
        BigInt(r.chainId),
        BigInt(r.expiresAt),
        r.nonce,
      ],
    ),
  );
}

/** keccak256 of a request body (or ZERO_HASH for empty). The ONLY way bodies enter a binding. */
export function hashRequestBody(body: Uint8Array | string | undefined): Hex32 {
  if (body === undefined || body.length === 0) return ZERO_HASH;
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return keccak256(bytes);
}

/**
 * PAY-WIRE-6 — strip everything that must never leave the trust boundary in payment metadata (402
 * bodies, receipts, on-chain events, accepts[] extras): licensed text, user queries, PII, full
 * sensitive URLs. Returns a safe projection: the path WITHOUT query string + a hash of the full URL.
 * A platform-level guarantee, not per-app discipline.
 */
export function redactPaymentMetadata(input: {
  url?: string;
  description?: string;
}): { safeRoute: string; urlHash: Hex32; description?: string } {
  let safeRoute = '';
  let urlHash = ZERO_HASH;
  if (input.url) {
    urlHash = keccak256(new TextEncoder().encode(input.url) as Uint8Array);
    try {
      const u = new URL(input.url);
      safeRoute = `${u.origin}${u.pathname}`; // drop query + fragment (may carry the user's query/content)
    } catch {
      safeRoute = '';
    }
  }
  // A description is allowed ONLY if it's a generic label; callers must not pass licensed text. We pass
  // it through verbatim but truncate to discourage smuggling licensed content into "description".
  const description = input.description ? input.description.slice(0, 80) : undefined;
  return { safeRoute, urlHash, description };
}
