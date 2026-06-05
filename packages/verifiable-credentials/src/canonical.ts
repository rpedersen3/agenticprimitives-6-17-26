/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) — deterministic JSON serialisation
 * for cross-stack hash equality (TS ↔ Solidity ↔ Java/Go verifiers).
 *
 * The substrate's `credentialHash` is `keccak256(jcsCanonicalize(vc-without-proof))`.
 * Every package that needs to recompute the hash MUST go through this helper.
 *
 * RFC 8785 rules:
 *  - UTF-8 strings, NFC normalisation (browsers ship NFC already)
 *  - Object keys sorted by UTF-16 code unit (== lexicographic in BMP)
 *  - No insignificant whitespace
 *  - Numbers as the shortest IEEE 754 round-trip representation
 *  - Booleans `true` / `false` / `null` lowercase
 *  - Strings JSON-escape U+0000..U+001F, U+0022, U+005C only; emit other code points as-is
 *
 * This implementation is intentionally narrow: substrate VCs use a constrained
 * subset of JSON (string / number / boolean / null / object / array). We do not
 * handle BigInt or Date — callers must serialise those upstream.
 */

import { keccak_256 } from '@noble/hashes/sha3.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

export class JcsError extends Error {
  constructor(message: string, readonly path: string) {
    super(`[JCS] ${message} at ${path}`);
  }
}

/**
 * Canonicalize a JSON-compatible value per RFC 8785.
 * Returns the canonical string (UTF-8 text; callers wrap with `utf8ToBytes` to hash).
 */
export function jcsCanonicalize(value: unknown, path: string = '$'): string {
  if (value === null) return 'null';
  if (value === undefined) {
    throw new JcsError('undefined is not JSON', path);
  }
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return serializeString(value);
    case 'number':
      return serializeNumber(value, path);
    case 'object': {
      if (Array.isArray(value)) {
        const items = value.map((v, i) => jcsCanonicalize(v, `${path}[${i}]`));
        return `[${items.join(',')}]`;
      }
      // Plain object
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => sortByCodeUnit(a, b));
      const items = entries.map(([k, v]) => `${serializeString(k)}:${jcsCanonicalize(v, `${path}.${k}`)}`);
      return `{${items.join(',')}}`;
    }
    default:
      throw new JcsError(`unsupported JSON type: ${typeof value}`, path);
  }
}

/** UTF-16 code unit comparison — exactly what RFC 8785 §3.2.3 requires. */
function sortByCodeUnit(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a.charCodeAt(i);
    const bv = b.charCodeAt(i);
    if (av !== bv) return av - bv;
  }
  return a.length - b.length;
}

/** RFC 8259 string serialisation with JCS-compatible escaping (RFC 8785 §3.2.2.2). */
function serializeString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 0x22) {
      out += '\\"';
    } else if (code === 0x5c) {
      out += '\\\\';
    } else if (code < 0x20) {
      // Control characters
      switch (code) {
        case 0x08:
          out += '\\b';
          break;
        case 0x09:
          out += '\\t';
          break;
        case 0x0a:
          out += '\\n';
          break;
        case 0x0c:
          out += '\\f';
          break;
        case 0x0d:
          out += '\\r';
          break;
        default:
          out += `\\u${code.toString(16).padStart(4, '0')}`;
      }
    } else {
      out += s[i];
    }
  }
  out += '"';
  return out;
}

/** RFC 8785 §3.2.2.3 — shortest round-tripping IEEE 754 representation. */
function serializeNumber(n: number, path: string): string {
  if (!Number.isFinite(n)) {
    throw new JcsError(`non-finite number (${n})`, path);
  }
  if (Object.is(n, -0)) return '0';
  if (n === 0) return '0';
  if (Number.isInteger(n) && Math.abs(n) < 1e21) {
    return n.toString();
  }
  // Browsers + Node give us the shortest round-trip via `toString()`
  // (per ECMA-262 §6.1.6.1.13). RFC 8785 expects the ES round-trip form.
  return n.toString();
}

/**
 * Compute the canonical hash of a value: `keccak256(jcsCanonicalize(value))`.
 * Returns the 32-byte hex hash.
 */
export function canonicalHash(value: unknown): `0x${string}` {
  const canonical = jcsCanonicalize(value);
  const bytes = utf8ToBytes(canonical);
  const digest = keccak_256(bytes);
  return `0x${bytesToHex(digest)}` as `0x${string}`;
}

function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (const v of b) {
    s += v.toString(16).padStart(2, '0');
  }
  return s;
}
