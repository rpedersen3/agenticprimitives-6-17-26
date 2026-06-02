/**
 * Schema registration helper — produces the `did:shape:<name>:<version>` ↔
 * on-chain `ShapeRegistry.defineShape(...)` round-trip per PD-12.
 *
 * In W1 this module ships pure helpers (no on-chain call). The caller wires
 * the actual `defineShape` call against their viem clients; we provide:
 *  - the canonical schema URI form (`did:shape:<name>:<version>`)
 *  - the canonical hash bytes (`keccak256` of the canonical SHACL string)
 *  - a parser to round-trip schema URIs
 */

import { keccak_256 } from '@noble/hashes/sha3';
import { utf8ToBytes } from '@noble/hashes/utils';

import type { Hex32 } from './types.js';

export const SHAPE_DID_PREFIX = 'did:shape:' as const;

/**
 * Build the canonical `did:shape:<name>:<version>` URI.
 *
 * @throws if name or version contains characters outside `[A-Za-z0-9-_.]`.
 */
export function buildShapeUri(name: string, version: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error(`[verifiable-credentials/schema] invalid shape name: ${name}`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(version)) {
    throw new Error(`[verifiable-credentials/schema] invalid shape version: ${version}`);
  }
  return `${SHAPE_DID_PREFIX}${name}:${version}`;
}

/**
 * Parse a `did:shape:<name>:<version>` URI.
 */
export function parseShapeUri(uri: string): { name: string; version: string } | null {
  if (!uri.startsWith(SHAPE_DID_PREFIX)) return null;
  const body = uri.slice(SHAPE_DID_PREFIX.length);
  const colonIdx = body.lastIndexOf(':');
  if (colonIdx === -1) return null;
  const name = body.slice(0, colonIdx);
  const version = body.slice(colonIdx + 1);
  if (!name || !version) return null;
  return { name, version };
}

/**
 * Canonicalise SHACL bytes for the on-chain hash. The canonical form is:
 *  - UTF-8 normalised (callers are responsible for upstream NFC if needed)
 *  - keccak256 of the raw bytes
 *
 * This matches the on-chain `ShapeRegistry.defineShape(shapeHash)` expectation
 * — both sides hash the exact same SHACL string.
 */
export function shapeHash(shaclBytes: string | Uint8Array): Hex32 {
  const bytes = typeof shaclBytes === 'string' ? utf8ToBytes(shaclBytes) : shaclBytes;
  const digest = keccak_256(bytes);
  let hex = '0x';
  for (const v of digest) {
    hex += v.toString(16).padStart(2, '0');
  }
  return hex as Hex32;
}
