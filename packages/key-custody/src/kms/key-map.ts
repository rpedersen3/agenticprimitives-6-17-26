// Loose service-account + signer-key-map parsing (spec 276 KCS-D4). Peer-dep-free.
//
// External apps hand-rolled both of these and got the failure modes subtly
// wrong (silent defaults, accepting a key NAME where a key VERSION is required).
// They are generic, so they live here — one parse path, loud failure (ADR-0013).

import type { ServiceAccount } from './gcp-transport.js';

/** A full Cloud KMS key VERSION resource name (what a signer needs — not the bare key). */
const KEY_VERSION_RE =
  /^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+\/cryptoKeyVersions\/\d+$/;

function coerceJsonObject(input: string | object, label: string): Record<string, unknown> {
  if (typeof input === 'object' && input !== null) return input as Record<string, unknown>;
  if (typeof input !== 'string') throw new Error(`${label}: expected a JSON string or object`);
  const s = input.trim();
  if (!s) throw new Error(`${label}: empty input`);
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    // The common second shape: base64-encoded JSON (env vars / secret stores).
    try {
      return JSON.parse(atob(s)) as Record<string, unknown>;
    } catch {
      throw new Error(`${label}: not valid JSON or base64-encoded JSON`);
    }
  }
}

/** Parse Google service-account credentials from a raw JSON string, base64-encoded
 *  JSON, or an already-parsed object. Fail closed if `client_email`/`private_key` are absent. */
export function parseServiceAccountJson(input: string | object): ServiceAccount {
  const obj = coerceJsonObject(input, 'parseServiceAccountJson');
  if (typeof obj.client_email !== 'string' || typeof obj.private_key !== 'string') {
    throw new Error('parseServiceAccountJson: missing client_email or private_key');
  }
  return {
    client_email: obj.client_email,
    private_key: obj.private_key,
    project_id: typeof obj.project_id === 'string' ? obj.project_id : undefined,
  };
}

/** A validated `identity → cryptoKeyVersion resource name` map. */
export type SignerKeyMap = Record<string, string>;

/** Parse + validate a signer key-map (JSON string, base64-JSON, or object). Every value MUST be a
 *  full `…/cryptoKeyVersions/<N>` resource name — a bare key name would fail at first sign with a
 *  confusing error, so reject it here, loudly. Rejects an empty map. */
export function parseSignerKeyMap(input: string | object): SignerKeyMap {
  const obj = coerceJsonObject(input, 'parseSignerKeyMap');
  if (Array.isArray(obj)) throw new Error('parseSignerKeyMap: expected an object map, got an array');
  const out: SignerKeyMap = {};
  for (const [identity, value] of Object.entries(obj)) {
    if (typeof value !== 'string' || !KEY_VERSION_RE.test(value)) {
      throw new Error(
        `parseSignerKeyMap: identity "${identity}" must map to a full ` +
          `projects/.../cryptoKeyVersions/<N> resource name; got ${JSON.stringify(value)}`,
      );
    }
    out[identity] = value;
  }
  if (Object.keys(out).length === 0) throw new Error('parseSignerKeyMap: empty map');
  return out;
}

/** True iff `name` is a full Cloud KMS key VERSION resource name. */
export function isCryptoKeyVersionName(name: string): boolean {
  return KEY_VERSION_RE.test(name);
}
