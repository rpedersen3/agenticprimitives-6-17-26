/**
 * GcpKmsProvider unit tests — fetch mocked, no real Cloud KMS calls.
 *
 * Asserts the envelope-encryption round-trip:
 *   - generateSessionDataKey produces a 32-byte plaintext key + the
 *     base64-decoded ciphertext from Cloud KMS :encrypt.
 *   - decryptSessionDataKey unwraps with the same AAD; tampering with
 *     AAD must surface as a KMS-side error (we simulate by returning
 *     HTTP 400 from the mock when AAD doesn't match).
 *   - keyVersion mismatch is rejected client-side (defense-in-depth).
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { GcpKmsProvider } from '../../src/providers/gcp';

const TEST_KEY_NAME =
  'projects/test-project/locations/us-central1/keyRings/test-ring/cryptoKeys/agent-envelope';

let rsaPrivPem: string;
let serviceAccountJson: string;

beforeAll(async () => {
  const { privateKey } = (await globalThis.crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pkcs8 = await globalThis.crypto.subtle.exportKey('pkcs8', privateKey);
  const der = new Uint8Array(pkcs8);
  let bin = '';
  for (let i = 0; i < der.length; i++) bin += String.fromCharCode(der[i]!);
  const b64 = btoa(bin);
  const lines = b64.match(/.{1,64}/g) ?? [];
  rsaPrivPem = `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`;
  serviceAccountJson = JSON.stringify({
    type: 'service_account',
    project_id: 'test-project',
    client_email: 'test-encrypt@test-project.iam.gserviceaccount.com',
    private_key: rsaPrivPem,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function bytesToBase64(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]!);
  return btoa(str);
}

function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function tokenResponse(): Response {
  return new Response(
    JSON.stringify({ access_token: 'fake-access-token', expires_in: 3600, token_type: 'Bearer' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('GcpKmsProvider', () => {
  it('throws when GCP_KMS_ENCRYPT_KEY_NAME is missing', () => {
    expect(() => new GcpKmsProvider({ serviceAccountJson })).toThrow(/GCP_KMS_ENCRYPT_KEY_NAME/);
  });

  it('throws when service account JSON is malformed', () => {
    expect(
      () => new GcpKmsProvider({ cryptoKeyName: TEST_KEY_NAME, serviceAccountJson: 'nope' }),
    ).toThrow(/not valid JSON/);
  });

  it('generateSessionDataKey + decryptSessionDataKey round-trips with matching AAD', async () => {
    const aadContext = { sessionId: 'sa_test', accountAddress: '0xaaaa', chainId: '31337' };
    // The "cipher" we simulate: just return the plaintext with a 4-byte prefix so we can
    // verify the AAD-bound contract — the mock's "decrypt" recovers the plaintext only
    // when the requested AAD matches the AAD recorded at "encrypt" time.
    let storedCiphertext: Uint8Array | null = null;
    let storedAad: string | null = null;
    let storedPlaintext: Uint8Array | null = null;

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/oauth2.googleapis.com/token')) return tokenResponse();
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (url.endsWith(':encrypt')) {
        storedPlaintext = base64ToBytes(body.plaintext);
        storedAad = body.additionalAuthenticatedData;
        // Simulated ciphertext: prefix to make it visibly distinct.
        const ct = new Uint8Array(storedPlaintext.length + 4);
        ct.set([0xab, 0xcd, 0xef, 0x01], 0);
        ct.set(storedPlaintext, 4);
        storedCiphertext = ct;
        return new Response(JSON.stringify({ ciphertext: bytesToBase64(ct), name: TEST_KEY_NAME + '/cryptoKeyVersions/1' }), {
          status: 200,
        });
      }
      if (url.endsWith(':decrypt')) {
        // Verify AAD matches what we saw at encrypt time. If not, return 400 like KMS would.
        if (body.additionalAuthenticatedData !== storedAad) {
          return new Response(JSON.stringify({ error: { message: 'AAD mismatch' } }), { status: 400 });
        }
        const ct = base64ToBytes(body.ciphertext);
        if (!storedCiphertext || ct.length !== storedCiphertext.length) {
          return new Response(JSON.stringify({ error: 'ciphertext mismatch' }), { status: 400 });
        }
        for (let i = 0; i < ct.length; i++) {
          if (ct[i] !== storedCiphertext[i]) {
            return new Response(JSON.stringify({ error: 'ciphertext tampered' }), { status: 400 });
          }
        }
        return new Response(JSON.stringify({ plaintext: bytesToBase64(storedPlaintext!) }), { status: 200 });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as unknown as typeof fetch);

    const provider = new GcpKmsProvider({ cryptoKeyName: TEST_KEY_NAME, serviceAccountJson });
    const wrapped = await provider.generateSessionDataKey({ aadContext });
    expect(wrapped.plaintextDataKey.length).toBe(32);
    expect(wrapped.encryptedDataKey.length).toBeGreaterThan(32);
    expect(wrapped.keyId).toBe(TEST_KEY_NAME);
    // H7-F.4: keyVersion now derives from the GCP encrypt response's
    // `name` field (cryptoKeyVersions/<N>) rather than the legacy
    // hardcoded 'gcp-kms:v1' string.
    expect(wrapped.keyVersion).toMatch(/^gcp-kms:v\d+$/);

    const unwrapped = await provider.decryptSessionDataKey({
      encryptedDataKey: wrapped.encryptedDataKey,
      aadContext,
      keyId: wrapped.keyId,
      keyVersion: wrapped.keyVersion,
    });
    expect(unwrapped.length).toBe(32);
    expect(Array.from(unwrapped)).toEqual(Array.from(wrapped.plaintextDataKey));
  });

  it('decrypt with TAMPERED AAD surfaces as an error (AAD trip-wire)', async () => {
    const aadContext = { sessionId: 'sa_test', chainId: '31337' };
    let storedAad: string | null = null;

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/oauth2.googleapis.com/token')) return tokenResponse();
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (url.endsWith(':encrypt')) {
        storedAad = body.additionalAuthenticatedData;
        return new Response(JSON.stringify({ ciphertext: 'YWJjZA==', name: TEST_KEY_NAME + '/cryptoKeyVersions/1' }), { status: 200 });
      }
      if (url.endsWith(':decrypt')) {
        if (body.additionalAuthenticatedData !== storedAad) {
          return new Response('AAD mismatch', { status: 400 });
        }
        return new Response(JSON.stringify({ plaintext: bytesToBase64(new Uint8Array(32)) }), { status: 200 });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as unknown as typeof fetch);

    const provider = new GcpKmsProvider({ cryptoKeyName: TEST_KEY_NAME, serviceAccountJson });
    const wrapped = await provider.generateSessionDataKey({ aadContext });

    const tamperedContext = { ...aadContext, sessionId: 'sa_DIFFERENT' };
    await expect(
      provider.decryptSessionDataKey({
        encryptedDataKey: wrapped.encryptedDataKey,
        aadContext: tamperedContext,
        keyId: wrapped.keyId,
        keyVersion: wrapped.keyVersion,
      }),
    ).rejects.toThrow(/HTTP 400/);
  });

  it('H7-F.4: decrypt rejects a non-conforming keyVersion shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => tokenResponse()) as unknown as typeof fetch);
    const provider = new GcpKmsProvider({ cryptoKeyName: TEST_KEY_NAME, serviceAccountJson });
    await expect(
      provider.decryptSessionDataKey({
        encryptedDataKey: new Uint8Array(16),
        aadContext: {},
        keyId: TEST_KEY_NAME,
        // Not 'gcp-kms:v<N>' or 'gcp-kms:unknown' — must reject.
        keyVersion: 'gcp-kms:OLD',
      }),
    ).rejects.toThrow(/doesn't match the expected/);
  });

  it('H7-F.4: default keyVersion is gcp-kms:unknown (test fallback)', () => {
    const provider = new GcpKmsProvider({ cryptoKeyName: TEST_KEY_NAME, serviceAccountJson });
    // The legacy 'gcp-kms:v1' default was hardcoded and gave a false
    // rotation marker. The new default is 'gcp-kms:unknown' so a
    // misconfigured mock that doesn't return `name` still gets flagged.
    expect(provider.keyVersion).toBe('gcp-kms:unknown');
  });

  it('H7-F.4: keyVersion derives from the GCP encrypt response name', async () => {
    // Mock GCP encrypt to return cryptoKeyVersions/7 — keyVersion should
    // surface as 'gcp-kms:v7' (not the hardcoded fallback).
    const aadContext = { sessionId: 'sa_v7', chainId: '31337' };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/oauth2.googleapis.com/token')) return tokenResponse();
      if (url.endsWith(':encrypt')) {
        return new Response(JSON.stringify({
          ciphertext: bytesToBase64(new Uint8Array([1, 2, 3, 4])),
          name: TEST_KEY_NAME + '/cryptoKeyVersions/7',
        }), { status: 200 });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as unknown as typeof fetch);

    const provider = new GcpKmsProvider({ cryptoKeyName: TEST_KEY_NAME, serviceAccountJson });
    const wrapped = await provider.generateSessionDataKey({ aadContext });
    expect(wrapped.keyVersion).toBe('gcp-kms:v7');
  });
});
