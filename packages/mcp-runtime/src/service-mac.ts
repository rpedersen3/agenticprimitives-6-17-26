/**
 * Service-to-service MAC envelope. Audit C1.
 *
 * Closes the gap where MCP requests rely solely on bearer delegation
 * tokens with no route-level service authenticity or replay control.
 * The MAC binds:
 *   - `audience` (the MCP server identity, e.g. `urn:mcp:server:person`)
 *   - `service` (the caller identity, e.g. `a2a-to-mcp`)
 *   - `route` (the tool name being invoked)
 *   - `nonce` (one-shot, replay-tracked via JtiStore)
 *   - `timestamp` (millisecond epoch, clock-skew bounded)
 *   - `bodyDigest` (sha256 of the raw request body)
 *
 * Both sides (a2a caller + mcp verifier) share an HMAC key via
 * `key-custody.buildMacProvider(...)`. For dev, a local-aes provider
 * with a shared 32-byte secret. For production, a GCP KMS HMAC key
 * with IAM scoped to the two service accounts. The wire format is
 * provider-agnostic.
 *
 * Doctrine: MCP runtime stays transport-agnostic. This module ships
 * pure helpers; the demo's Hono middleware wires them to HTTP headers.
 */

import { sha256, toHex } from 'viem';
import type { Hex } from '@agenticprimitives/types';
import type { JtiStore } from '@agenticprimitives/delegation';
import { buildEvent, type AuditSink } from '@agenticprimitives/audit';

// Minimal interface so we don't take a hard dep on the whole
// `A2AKeyProvider` type — only `generateMac` is needed here.
export interface MacProviderLike {
  readonly keyVersion: string;
  generateMac?(input: {
    canonicalMessage: Uint8Array;
    service: string;
    audience: string;
  }): Promise<{ mac: Uint8Array; keyId: string }>;
}

export interface ServiceMacContext {
  /** MCP server identity. Same value MUST be used on both sides. */
  audience: string;
  /** Caller identity (e.g. 'a2a-to-mcp'). */
  service: string;
  /** Route family — typically the tool name. */
  route: string;
  /** sha256 of the raw request body. */
  bodyDigest: Hex;
}

export interface ServiceMacHeaders {
  /** base64url(HMAC) over the canonical message. */
  mac: string;
  /** base64url(16 random bytes). One-shot; tracked via JtiStore. */
  nonce: string;
  /** Epoch milliseconds at generate time, as decimal string. */
  timestamp: string;
  /** Provider-supplied key ID (for log/forensics + key rotation). */
  keyId: string;
}

const VERSION = 'agentic-a2a-mcp-v1';
const DEFAULT_CLOCK_SKEW_MS = 60_000;

function canonicalMessage(ctx: ServiceMacContext, nonce: string, timestamp: string): Uint8Array {
  const text =
    VERSION +
    '\n' +
    ctx.audience +
    '\n' +
    ctx.service +
    '\n' +
    ctx.route +
    '\n' +
    nonce +
    '\n' +
    timestamp +
    '\n' +
    ctx.bodyDigest.toLowerCase();
  return new TextEncoder().encode(text);
}

function base64urlEncode(bytes: Uint8Array): string {
  const bin = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  const b64 = typeof btoa === 'function'
    ? btoa(bin)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    : (globalThis as any).Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(s: string): Uint8Array {
  const padded =
    s.replace(/-/g, '+').replace(/_/g, '/') +
    '=='.slice((2 - (s.length & 3)) & 3);
  const bin = typeof atob === 'function'
    ? atob(padded)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    : (globalThis as any).Buffer.from(padded, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** Hex-encoded sha256 of a body string. Helper for callers. */
export function bodyDigestHex(body: string): Hex {
  return sha256(toHex(body)) as Hex;
}

/**
 * Caller side: generate the MAC + headers for an outgoing request.
 * The provider MUST support `generateMac`.
 */
export async function generateServiceMac(args: {
  ctx: ServiceMacContext;
  provider: MacProviderLike;
  /** Override for tests. Production: leave undefined for crypto.randomBytes-derived nonce. */
  nonce?: Uint8Array;
  /** Override for tests. Production: leave undefined. */
  now?: () => number;
}): Promise<ServiceMacHeaders> {
  if (!args.provider.generateMac) {
    throw new Error('serviceMac: provider lacks generateMac (use a MAC-capable backend)');
  }
  const nonceBytes = args.nonce ?? cryptoRandomBytes(16);
  const nonce = base64urlEncode(nonceBytes);
  const timestamp = String((args.now ?? Date.now)());
  const canonical = canonicalMessage(args.ctx, nonce, timestamp);
  const { mac, keyId } = await args.provider.generateMac({
    canonicalMessage: canonical,
    service: args.ctx.service,
    audience: args.ctx.audience,
  });
  return {
    mac: base64urlEncode(mac),
    nonce,
    timestamp,
    keyId,
  };
}

/**
 * Verifier side: recompute the MAC + check it matches in constant time,
 * + check clock skew, + consume the nonce (replay tracking via JtiStore).
 *
 * Fail-closed: any failure returns `{ ok: false, reason }`. Callers MUST
 * NOT echo `reason` to external clients — log it, return generic 401.
 */
export async function verifyServiceMac(args: {
  ctx: ServiceMacContext;
  headers: ServiceMacHeaders;
  provider: MacProviderLike;
  jtiStore: JtiStore;
  /** Default 60_000ms. */
  maxClockSkewMs?: number;
  now?: () => number;
  /**
   * Audit sink (audit C3). When provided, every rejection emits a
   * `mcp-runtime.service-mac.reject` event so forensics can reconstruct
   * who attempted what. Successful verifies are typically left to the
   * downstream `withDelegation` event to avoid double-emission per
   * request; emitters wanting per-MAC accept events can wire a
   * separate emit themselves.
   */
  auditSink?: AuditSink;
  /** Correlation ID threaded into emitted events. */
  correlationId?: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const emitReject = async (reason: string) => {
    if (!args.auditSink) return;
    try {
      await args.auditSink.write(
        buildEvent({
          action: 'mcp-runtime.service-mac.reject',
          outcome: 'denied',
          correlationId: args.correlationId,
          actor: { type: 'service', id: args.ctx.service },
          subject: { type: 'tool', id: args.ctx.route },
          audience: args.ctx.audience,
          reason,
          context: {
            keyId: args.headers.keyId,
            // Hash of the nonce so the raw value (which is one-shot
            // and tied to a specific request) isn't surfaced in logs
            // beyond what's already required for the rejection trail.
            nonceHash: nonceHashShort(args.headers.nonce),
          },
        }),
      );
    } catch {
      /* fail-soft */
    }
  };
  const reject = async (reason: string): Promise<{ ok: false; reason: string }> => {
    await emitReject(reason);
    return { ok: false, reason };
  };
  if (!args.provider.generateMac) {
    return reject('verifier provider lacks generateMac');
  }
  // Clock-skew gate.
  const ts = Number(args.headers.timestamp);
  if (!Number.isFinite(ts) || ts <= 0) {
    return reject('malformed timestamp');
  }
  const now = (args.now ?? Date.now)();
  const skew = args.maxClockSkewMs ?? DEFAULT_CLOCK_SKEW_MS;
  if (Math.abs(now - ts) > skew) {
    return reject(`clock skew ${Math.abs(now - ts)}ms exceeds ${skew}ms`);
  }
  // MAC recompute + constant-time compare.
  const canonical = canonicalMessage(args.ctx, args.headers.nonce, args.headers.timestamp);
  let expected: Uint8Array;
  try {
    const got = await args.provider.generateMac({
      canonicalMessage: canonical,
      service: args.ctx.service,
      audience: args.ctx.audience,
    });
    expected = got.mac;
  } catch (e) {
    return reject(`mac recompute failed: ${e instanceof Error ? e.message : e}`);
  }
  let received: Uint8Array;
  try {
    received = base64urlDecode(args.headers.mac);
  } catch (e) {
    return reject(`malformed mac base64url: ${e instanceof Error ? e.message : e}`);
  }
  if (!constantTimeEqual(expected, received)) {
    return reject('mac mismatch');
  }
  // Replay: track the nonce via JTI store. limit=1 means single-use:
  // first call succeeds (usage=1, allowed=true); second sees usage=2,
  // allowed=false. JTI key is namespaced to distinguish from
  // delegation-token JTIs.
  const jti = `mac:${args.ctx.audience}:${args.ctx.service}:${args.headers.nonce}`;
  const tracked = await args.jtiStore.trackUsage(jti, 1);
  if (!tracked.allowed) {
    return reject('mac nonce already consumed (replay)');
  }
  void ts; // ts is bounded by clock-skew gate above; no further use here.
  return { ok: true };
}

// ─── Internals ────────────────────────────────────────────────────────

function nonceHashShort(nonce: string): string {
  // 8-byte prefix of sha256(nonce) — enough to correlate events
  // without surfacing the raw one-shot nonce in logs.
  const digest = sha256(toHex(nonce));
  return digest.slice(0, 18); // '0x' + 16 hex chars
}

function cryptoRandomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  // Both Web Crypto (browsers, Workers) and Node 18+ have globalThis.crypto.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(out);
    return out;
  }
  throw new Error('serviceMac: crypto.getRandomValues unavailable');
}
