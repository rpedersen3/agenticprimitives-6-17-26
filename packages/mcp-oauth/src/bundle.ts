// Agentic Grant Bundle bridge (spec 277 §7). The bundle is the OAuth↔AP
// authorization handoff: a validated token references it by id + hash, and the
// normal delegated vault path runs off the bundle's delegation/entitlement
// hashes. Bundles are stored ENCRYPTED (vault objects) — this module owns the
// canonical hash + the token→bundle resolution (the store is injected).

import type { McpGrantBundleV1, McpAccessTokenClaims, GrantBundleStore, Sha256 } from './types.js';

const enc = new TextEncoder();

function canonicalize(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalize(o[k])}`).join(',')}}`;
}

export async function sha256Hex(input: string): Promise<Sha256> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', enc.encode(input) as unknown as ArrayBuffer);
  return `sha256:${Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Compute the canonical bundle hash (over the body, excluding `hash`). */
export async function computeGrantBundleHash(body: Omit<McpGrantBundleV1, 'hash'>): Promise<Sha256> {
  return sha256Hex(canonicalize(body));
}

/** Assemble a grant bundle, stamping its canonical `hash`. */
export async function createMcpGrantBundle(input: Omit<McpGrantBundleV1, 'type' | 'hash'>): Promise<McpGrantBundleV1> {
  const body: Omit<McpGrantBundleV1, 'hash'> = { type: 'McpGrantBundleV1', ...input };
  const hash = await computeGrantBundleHash(body);
  return { ...body, hash };
}

/** The token-side binding the AS stamps into the access token (never the payload). */
export function bindOAuthTokenToGrantBundle(bundle: McpGrantBundleV1): Pick<McpAccessTokenClaims, 'ap_grant_ref' | 'ap_grant_hash' | 'ap_principal' | 'ap_delegate' | 'ap_policy_profile'> {
  return {
    ap_grant_ref: bundle.id,
    ap_grant_hash: bundle.hash,
    ap_principal: bundle.principal.id,
    ap_delegate: bundle.delegate?.id,
    ap_policy_profile: bundle.policy.profile,
  };
}

export type GrantBundleResolution =
  | { ok: true; bundle: McpGrantBundleV1 }
  | { ok: false; reason: 'grant_ref_missing' | 'not_found' | 'hash_mismatch' | 'revoked' | 'expired' };

/** Resolve + validate the grant bundle referenced by a validated token: the
 *  stored bundle's hash must match the token's `ap_grant_hash` (anti-swap), and
 *  the bundle must be active + unexpired. Fail-closed. */
export async function resolveGrantBundleFromToken(claims: McpAccessTokenClaims, store: GrantBundleStore, now: Date = new Date()): Promise<GrantBundleResolution> {
  if (!claims.ap_grant_ref) return { ok: false, reason: 'grant_ref_missing' };
  const bundle = await store.get(claims.ap_grant_ref);
  if (!bundle) return { ok: false, reason: 'not_found' };
  if (claims.ap_grant_hash && bundle.hash !== claims.ap_grant_hash) return { ok: false, reason: 'hash_mismatch' };
  if (bundle.status === 'revoked') return { ok: false, reason: 'revoked' };
  if (bundle.status === 'expired' || now.getTime() > new Date(bundle.expiresAt).getTime()) return { ok: false, reason: 'expired' };
  return { ok: true, bundle };
}
