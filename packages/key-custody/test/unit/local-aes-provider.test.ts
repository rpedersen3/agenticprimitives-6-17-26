import { describe, it, expect, beforeEach } from 'vitest';
import { LocalAesProvider } from '../../src/providers/local';

// 64 hex chars = 32 bytes. Stable test secret.
const TEST_SECRET = '0x' + 'aa'.repeat(32);

describe('LocalAesProvider', () => {
  let provider: LocalAesProvider;
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    provider = new LocalAesProvider({ sessionSecretHex: TEST_SECRET });
  });

  it('reports a stable keyVersion', () => {
    expect(provider.keyVersion).toBe('local-v1');
  });

  it('generateSessionDataKey returns 32-byte plaintext + random salt', async () => {
    const aadContext = { session_id_h: 'abcd', chain_id: '31337' };
    const out = await provider.generateSessionDataKey({ aadContext });
    expect(out.plaintextDataKey.length).toBe(32);
    expect(out.encryptedDataKey.length).toBe(16); // SALT_BYTES
    expect(out.keyId).toBe('local-master');
    expect(out.keyVersion).toBe('local-v1');
  });

  it('decryptSessionDataKey reproduces the same plaintext key given matching AAD', async () => {
    const aadContext = { session_id_h: 'abcd', chain_id: '31337' };
    const generated = await provider.generateSessionDataKey({ aadContext });
    const decrypted = await provider.decryptSessionDataKey({
      encryptedDataKey: generated.encryptedDataKey,
      aadContext,
      keyId: generated.keyId,
      keyVersion: generated.keyVersion,
    });
    expect(decrypted).toEqual(generated.plaintextDataKey);
  });

  it('AAD trip-wire: tampered aadContext produces a DIFFERENT key (not an error)', async () => {
    // HKDF doesn't throw on mismatch; it derives a different key. The
    // tampered key won't decrypt the AES-GCM payload (whose tag was computed
    // with the original key). The trip-wire fires at the AES-GCM layer above.
    const generated = await provider.generateSessionDataKey({
      aadContext: { session_id_h: 'abcd', chain_id: '31337' },
    });
    const decrypted = await provider.decryptSessionDataKey({
      encryptedDataKey: generated.encryptedDataKey,
      aadContext: { session_id_h: 'abcd', chain_id: '99999' }, // tampered chain_id
      keyId: generated.keyId,
      keyVersion: generated.keyVersion,
    });
    expect(decrypted).not.toEqual(generated.plaintextDataKey);
  });

  it('rejects mismatched keyVersion at decrypt', async () => {
    const generated = await provider.generateSessionDataKey({ aadContext: { x: '1' } });
    await expect(
      provider.decryptSessionDataKey({
        encryptedDataKey: generated.encryptedDataKey,
        aadContext: { x: '1' },
        keyId: generated.keyId,
        keyVersion: 'something-else',
      }),
    ).rejects.toThrow(/keyVersion mismatch/);
  });

  it('production guard: refuses session-data-key envelope ops when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    // Constructor is permitted in production (the MAC path needs it).
    // The guard fires on the envelope-encryption methods specifically —
    // those require a real KMS in prod.
    const p = new LocalAesProvider({ sessionSecretHex: TEST_SECRET });
    await expect(
      p.generateSessionDataKey({ aadContext: { sessionId: 'x' } }),
    ).rejects.toThrow(/refuses to start/);
    await expect(
      p.decryptSessionDataKey({
        encryptedDataKey: new Uint8Array(16),
        aadContext: { sessionId: 'x' },
        keyId: 'local-master',
        keyVersion: 'local-v1',
      }),
    ).rejects.toThrow(/refuses to start/);
    process.env.NODE_ENV = 'test';
  });

  it('production guard: PERMITS the MAC primitive when NODE_ENV=production', async () => {
    // MAC is a wrangler-secret-loaded HMAC, valid in production —
    // see LocalAesProvider class comment.
    process.env.NODE_ENV = 'production';
    const p = new LocalAesProvider({ sessionSecretHex: TEST_SECRET });
    const { mac } = await p.generateMac!({
      canonicalMessage: new TextEncoder().encode('hello'),
      service: 'a2a-to-mcp',
      audience: 'urn:mcp:server:person',
    });
    expect(mac.length).toBe(32); // sha256 = 32 bytes
    process.env.NODE_ENV = 'test';
  });

  it('rejects a too-short session secret', () => {
    expect(() => new LocalAesProvider({ sessionSecretHex: '0x' + 'aa'.repeat(16) })).toThrow(
      /at least 32 bytes/,
    );
  });

  it('rejects construction with no secret configured', () => {
    const prev = process.env.A2A_SESSION_SECRET;
    delete process.env.A2A_SESSION_SECRET;
    expect(() => new LocalAesProvider()).toThrow(/A2A_SESSION_SECRET/);
    if (prev !== undefined) process.env.A2A_SESSION_SECRET = prev;
  });

  it('generateMac is deterministic per audience+message and varies across audiences', async () => {
    const message = new TextEncoder().encode('canonical message bytes');
    const macA1 = await provider.generateMac!({ canonicalMessage: message, service: 'a2a-to-mcp', audience: 'urn:mcp:server:person' });
    const macA2 = await provider.generateMac!({ canonicalMessage: message, service: 'a2a-to-mcp', audience: 'urn:mcp:server:person' });
    const macB = await provider.generateMac!({ canonicalMessage: message, service: 'a2a-to-mcp', audience: 'urn:mcp:server:org' });
    expect(macA1.mac).toEqual(macA2.mac);
    expect(macA1.mac).not.toEqual(macB.mac);
    expect(macA1.mac.length).toBe(32); // HMAC-SHA-256
  });
});
