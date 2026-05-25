/**
 * Canonical-JSON serialization + content-hash for AgentCard profiles.
 *
 * Subpath: `@agenticprimitives/agent-profile/profile`.
 *
 * The hash is used as the on-chain `metadata-hash` record predicate
 * in agent-naming. Two semantically-equal profiles MUST produce the
 * same hash — sort keys, fixed numeric format, no whitespace.
 */

import { keccak256, toHex } from 'viem';
import { AGENT_CARD_SCHEMA_VERSION } from './constants';
import { InvalidProfileError } from './errors';
import type { AgentCard } from './types';

/**
 * Canonical-JSON encoding. Sorts object keys recursively, omits
 * `undefined`, refuses non-finite numbers, refuses functions.
 *
 * Note: `JSON.stringify` does NOT sort keys, so we do it manually.
 * Arrays preserve insertion order (semantically meaningful).
 */
export function canonicalProfileJson(profile: AgentCard): string {
  validateProfile(profile);
  const withVersion = { ...profile, schemaVersion: AGENT_CARD_SCHEMA_VERSION };
  return canonicalJsonStringify(withVersion);
}

/**
 * Keccak-256 of the canonical-JSON encoding of a profile. Matches
 * the `metadata-hash` predicate in `agent-naming/records`. Stable
 * across runtimes — UTF-8 byte-level deterministic.
 */
export function profileContentHash(profile: AgentCard): `0x${string}` {
  const json = canonicalProfileJson(profile);
  return keccak256(toHex(json));
}

// ─── Internal ───────────────────────────────────────────────────────

function validateProfile(profile: AgentCard): void {
  if (!profile || typeof profile !== 'object') {
    throw new InvalidProfileError('profile must be an object');
  }
  if (typeof profile.type !== 'string') {
    throw new InvalidProfileError('profile.type is required', 'type');
  }
  switch (profile.type) {
    case 'person':
    case 'org':
    case 'service':
    case 'treasury':
    case 'mcpServer':
    case 'multisig':
      break;
    default:
      throw new InvalidProfileError(`unknown profile.type "${(profile as { type: string }).type}"`, 'type');
  }
  if (profile.type === 'mcpServer') {
    if (typeof profile.endpoint !== 'string' || profile.endpoint.length === 0) {
      throw new InvalidProfileError('mcpServer profile requires endpoint', 'endpoint');
    }
    if (!Array.isArray(profile.verification) || profile.verification.length === 0) {
      throw new InvalidProfileError('mcpServer profile requires at least one verification method', 'verification');
    }
  }
  if (profile.type === 'multisig') {
    if (!Array.isArray(profile.members) || profile.members.length === 0) {
      throw new InvalidProfileError('multisig profile requires at least one member', 'members');
    }
    if (typeof profile.threshold !== 'number' || profile.threshold < 1 || profile.threshold > profile.members.length) {
      throw new InvalidProfileError(
        `multisig threshold must be in [1, members.length] (got ${profile.threshold})`,
        'threshold',
      );
    }
  }
}

function canonicalJsonStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new InvalidProfileError(`non-finite number ${value} not allowed in canonical JSON`);
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined') {
    throw new InvalidProfileError(`value of type ${typeof value} not allowed in canonical JSON`);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJsonStringify).join(',') + ']';
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return (
      '{' +
      entries
        .map(([k, v]) => JSON.stringify(k) + ':' + canonicalJsonStringify(v))
        .join(',') +
      '}'
    );
  }
  throw new InvalidProfileError(`unsupported value of type ${typeof value}`);
}
