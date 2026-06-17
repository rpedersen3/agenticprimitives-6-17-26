// DecryptGrant construction + canonical hashing (spec 277 §14).

import type { DecryptGrantV1, Sha256 } from './types.js';

const enc = new TextEncoder();

/** Deterministic JSON (sorted object keys) so grantHash is reproducible. */
export function canonicalize(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalize(o[k])}`)
    .join(',')}}`;
}

export async function sha256Hex(input: string | Uint8Array): Promise<Sha256> {
  const bytes = typeof input === 'string' ? enc.encode(input) : input;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}

/** The grant body that gets hashed — everything EXCEPT `grantHash` + `proof`. */
type GrantBody = Omit<DecryptGrantV1, 'grantHash' | 'proof'>;

export async function computeGrantHash(body: GrantBody): Promise<Sha256> {
  return sha256Hex(canonicalize(body));
}

/** Assemble a DecryptGrant: set `type`, compute `grantHash` over the canonical body,
 *  and (optionally) attach a signature over that hash via an injected signer. */
export async function createDecryptGrant(
  input: Omit<DecryptGrantV1, 'type' | 'grantHash' | 'proof'>,
  opts?: { sign?: (grantHash: Sha256) => Promise<{ type: string; signature: string }> },
): Promise<DecryptGrantV1> {
  const body: GrantBody = { type: 'DecryptGrantV1', ...input };
  const grantHash = await computeGrantHash(body);
  const grant: DecryptGrantV1 = { ...body, grantHash };
  if (opts?.sign) grant.proof = await opts.sign(grantHash);
  return grant;
}
