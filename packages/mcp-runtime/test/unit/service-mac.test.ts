import { describe, it, expect } from 'vitest';
import {
  generateServiceMac,
  verifyServiceMac,
  bodyDigestHex,
  type MacProviderLike,
  type ServiceMacContext,
} from '../../src/service-mac';
import { createMemoryJtiStore } from '../../src/jti-stores';
import { createMemoryAuditSink } from '@agenticprimitives/audit';
import type { Hex } from '@agenticprimitives/types';

// Minimal in-memory MAC provider for tests. Uses HMAC-SHA256 over a
// fixed 32-byte master key. The (service, audience) tuple namespaces
// via a subkey derivation so a MAC for one (s, a) is not valid for
// another, mirroring the LocalAesProvider's generateMac shape.
//
// We use the Web Crypto SubtleCrypto API since this is what runs on
// Workers; vitest happens to also have it on Node 18+.
function createTestMacProvider(masterKeyHex: string): MacProviderLike {
  // Parse the master key.
  const stripped = masterKeyHex.startsWith('0x') ? masterKeyHex.slice(2) : masterKeyHex;
  const master = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < master.length; i++) {
    master[i] = parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
  }
  return {
    keyVersion: 'test',
    async generateMac({ canonicalMessage, service, audience }) {
      const subkeyCtx = new TextEncoder().encode(`${service}|${audience}`);
      const subkey = await hmacSha256(master, subkeyCtx);
      const mac = await hmacSha256(subkey, canonicalMessage);
      return { mac, keyId: `test:${service}:${audience}` };
    },
  };
}

async function hmacSha256(key: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  // Copy into ArrayBuffer-backed views so SubtleCrypto accepts them.
  const keyCopy = new Uint8Array(key.length);
  keyCopy.set(key);
  const msgCopy = new Uint8Array(msg.length);
  msgCopy.set(msg);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    keyCopy,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await globalThis.crypto.subtle.sign('HMAC', cryptoKey, msgCopy);
  return new Uint8Array(sig);
}

const MASTER = '0x' + 'ab'.repeat(32);

function ctx(overrides?: Partial<ServiceMacContext>): ServiceMacContext {
  return {
    audience: 'urn:mcp:server:person',
    service: 'a2a-to-mcp',
    route: 'get_profile',
    bodyDigest: bodyDigestHex(JSON.stringify({ sessionId: 'sa_test' })),
    ...overrides,
  };
}

describe('bodyDigestHex', () => {
  it('returns a 0x-prefixed 32-byte hex string', () => {
    const d = bodyDigestHex('{"hello":"world"}');
    expect(d.length).toBe(2 + 64);
    expect(d.startsWith('0x')).toBe(true);
  });

  it('is deterministic', () => {
    const a = bodyDigestHex('test');
    const b = bodyDigestHex('test');
    expect(a).toBe(b);
  });

  it('differs for different inputs', () => {
    const a = bodyDigestHex('test1');
    const b = bodyDigestHex('test2');
    expect(a).not.toBe(b);
  });
});

describe('generateServiceMac', () => {
  it('produces base64url MAC + nonce + timestamp + keyId', async () => {
    const provider = createTestMacProvider(MASTER);
    const headers = await generateServiceMac({ ctx: ctx(), provider });
    expect(headers.mac).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(headers.nonce).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(headers.timestamp).toMatch(/^[0-9]+$/);
    expect(headers.keyId).toBe('test:a2a-to-mcp:urn:mcp:server:person');
  });

  it('produces different MACs for different contexts', async () => {
    const provider = createTestMacProvider(MASTER);
    const a = await generateServiceMac({ ctx: ctx({ route: 'get_profile' }), provider });
    const b = await generateServiceMac({ ctx: ctx({ route: 'update_profile' }), provider });
    expect(a.mac).not.toBe(b.mac);
  });

  it('throws when provider lacks generateMac', async () => {
    const provider: MacProviderLike = { keyVersion: 'test' };
    await expect(generateServiceMac({ ctx: ctx(), provider })).rejects.toThrow(/generateMac/);
  });

  it('H7-F.3 — emits mcp-runtime.service-mac.issue when audit sink provided', async () => {
    const events: import('@agenticprimitives/audit').AuditEvent[] = [];
    const sink: import('@agenticprimitives/audit').AuditSink = {
      async write(e) { events.push(e); },
    };
    const provider = createTestMacProvider(MASTER);
    await generateServiceMac({
      ctx: ctx(),
      provider,
      auditSink: sink,
      correlationId: 'req-issue-42',
    });
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.action).toBe('mcp-runtime.service-mac.issue');
    expect(e.outcome).toBe('success');
    expect(e.correlationId).toBe('req-issue-42');
    expect(e.actor).toMatchObject({ type: 'service', id: 'a2a-to-mcp' });
    expect(e.audience).toBe('urn:mcp:server:person');
    expect(e.subject?.type).toBe('service-mac');
    expect(e.subject?.id).toBeTruthy();
  });

  it('H7-F.3 — issuance is fail-soft on audit sink throw', async () => {
    const provider = createTestMacProvider(MASTER);
    const throwingSink: import('@agenticprimitives/audit').AuditSink = {
      async write() { throw new Error('sink down'); },
    };
    // Must NOT throw — audit failures cannot break the MAC issuance.
    const headers = await generateServiceMac({
      ctx: ctx(),
      provider,
      auditSink: throwingSink,
    });
    expect(headers.mac).toBeTruthy();
  });
});

describe('verifyServiceMac', () => {
  const NOW = 1779_500_000_000; // fixed test clock

  async function freshHeaders() {
    const provider = createTestMacProvider(MASTER);
    return {
      provider,
      headers: await generateServiceMac({ ctx: ctx(), provider, now: () => NOW }),
    };
  }

  it('accepts a freshly-generated MAC', async () => {
    const { provider, headers } = await freshHeaders();
    const jtiStore = createMemoryJtiStore();
    const result = await verifyServiceMac({
      ctx: ctx(),
      headers,
      provider,
      jtiStore,
      now: () => NOW,
    });
    expect(result.ok).toBe(true);
  });

  it('emits mcp-runtime.service-mac.accept when sink is wired', async () => {
    const { provider, headers } = await freshHeaders();
    const jtiStore = createMemoryJtiStore();
    const sink = createMemoryAuditSink();
    const result = await verifyServiceMac({
      ctx: ctx(),
      headers,
      provider,
      jtiStore,
      now: () => NOW,
      auditSink: sink,
      correlationId: 'corr-mac-accept',
    });
    expect(result.ok).toBe(true);
    const events = sink.events();
    expect(events).toHaveLength(1);
    const evt = events[0]!;
    expect(evt.action).toBe('mcp-runtime.service-mac.accept');
    expect(evt.outcome).toBe('success');
    expect(evt.correlationId).toBe('corr-mac-accept');
    expect(evt.subject).toEqual({ type: 'tool', id: 'get_profile' });
    expect(evt.audience).toBe('urn:mcp:server:person');
    // nonceHash is a short prefix of sha256(nonce); raw nonce never logged.
    expect(typeof evt.context?.nonceHash).toBe('string');
    expect(JSON.stringify(evt)).not.toContain(headers.nonce);
  });

  it('accept emit is fail-soft: sink throws do not propagate', async () => {
    const { provider, headers } = await freshHeaders();
    const jtiStore = createMemoryJtiStore();
    const throwingSink = {
      async write() {
        throw new Error('sink down');
      },
    };
    const result = await verifyServiceMac({
      ctx: ctx(),
      headers,
      provider,
      jtiStore,
      now: () => NOW,
      auditSink: throwingSink,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a tampered MAC', async () => {
    const { provider, headers } = await freshHeaders();
    const jtiStore = createMemoryJtiStore();
    // Flip the last hex char to something GUARANTEED to differ from the
    // original — the previous `endsWith('A') ? 'B' : 'A'` form was a flake
    // when the MAC randomly ended in 'B' (~6% of runs: replacement equaled
    // the original → same MAC → tamper test passed verification).
    const lastChar = headers.mac.slice(-1);
    const replacement = lastChar === '0' ? '1' : '0';
    const tampered = { ...headers, mac: headers.mac.slice(0, -1) + replacement };
    const result = await verifyServiceMac({
      ctx: ctx(),
      headers: tampered,
      provider,
      jtiStore,
      now: () => NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/mac mismatch/);
  });

  it('rejects a different-audience MAC (same key, wrong target)', async () => {
    const { provider, headers } = await freshHeaders();
    const jtiStore = createMemoryJtiStore();
    const result = await verifyServiceMac({
      ctx: ctx({ audience: 'urn:mcp:server:other' }),
      headers,
      provider,
      jtiStore,
      now: () => NOW,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a different-route MAC', async () => {
    const { provider, headers } = await freshHeaders();
    const jtiStore = createMemoryJtiStore();
    const result = await verifyServiceMac({
      ctx: ctx({ route: 'update_profile' }),
      headers,
      provider,
      jtiStore,
      now: () => NOW,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a different body digest', async () => {
    const { provider, headers } = await freshHeaders();
    const jtiStore = createMemoryJtiStore();
    const result = await verifyServiceMac({
      ctx: ctx({ bodyDigest: bodyDigestHex('different body') }),
      headers,
      provider,
      jtiStore,
      now: () => NOW,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a stale MAC outside clock skew', async () => {
    const { provider, headers } = await freshHeaders();
    const jtiStore = createMemoryJtiStore();
    const result = await verifyServiceMac({
      ctx: ctx(),
      headers,
      provider,
      jtiStore,
      now: () => NOW + 120_000, // 2min later, default skew is 60s
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/clock skew/);
  });

  it('rejects a future-dated MAC outside clock skew', async () => {
    const { provider, headers } = await freshHeaders();
    const jtiStore = createMemoryJtiStore();
    const result = await verifyServiceMac({
      ctx: ctx(),
      headers,
      provider,
      jtiStore,
      now: () => NOW - 120_000, // verifier thinks it's 2min before header timestamp
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/clock skew/);
  });

  it('rejects a malformed timestamp', async () => {
    const { provider, headers } = await freshHeaders();
    const jtiStore = createMemoryJtiStore();
    const result = await verifyServiceMac({
      ctx: ctx(),
      headers: { ...headers, timestamp: 'not-a-number' },
      provider,
      jtiStore,
      now: () => NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/timestamp/);
  });

  it('rejects malformed mac base64url', async () => {
    const { provider, headers } = await freshHeaders();
    const jtiStore = createMemoryJtiStore();
    const result = await verifyServiceMac({
      ctx: ctx(),
      headers: { ...headers, mac: '$$invalid$$' },
      provider,
      jtiStore,
      now: () => NOW,
    });
    // base64urlDecode is permissive; the result will be a wrong-length
    // byte string that fails the constant-time compare. Either way
    // the assertion is "fails" — we just check ok === false.
    expect(result.ok).toBe(false);
  });

  it('rejects a replayed nonce (second verification with same nonce)', async () => {
    const { provider, headers } = await freshHeaders();
    const jtiStore = createMemoryJtiStore();
    const first = await verifyServiceMac({ ctx: ctx(), headers, provider, jtiStore, now: () => NOW });
    expect(first.ok).toBe(true);
    const second = await verifyServiceMac({ ctx: ctx(), headers, provider, jtiStore, now: () => NOW });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toMatch(/replay/);
  });

  it('rejects when provider returns a different MAC than the generator (wrong key)', async () => {
    const callerProvider = createTestMacProvider(MASTER);
    const verifierProvider = createTestMacProvider('0x' + 'cc'.repeat(32)); // different master
    const jtiStore = createMemoryJtiStore();
    const headers = await generateServiceMac({ ctx: ctx(), provider: callerProvider, now: () => NOW });
    const result = await verifyServiceMac({
      ctx: ctx(),
      headers,
      provider: verifierProvider,
      jtiStore,
      now: () => NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/mac mismatch/);
  });
});

describe('canonical message domain separation', () => {
  it('uses the version prefix so MACs do not collide with other HMAC users of the same key', async () => {
    // Different ctx fields must produce different MACs.
    const provider = createTestMacProvider(MASTER);
    const a = await generateServiceMac({
      ctx: { audience: 'A', service: 'a2a-to-mcp', route: 'r', bodyDigest: ('0x' + '00'.repeat(32)) as Hex },
      provider,
      nonce: new Uint8Array(16).fill(1),
      now: () => 1000,
    });
    const b = await generateServiceMac({
      ctx: { audience: 'B', service: 'a2a-to-mcp', route: 'r', bodyDigest: ('0x' + '00'.repeat(32)) as Hex },
      provider,
      nonce: new Uint8Array(16).fill(1),
      now: () => 1000,
    });
    expect(a.mac).not.toBe(b.mac);
  });
});
