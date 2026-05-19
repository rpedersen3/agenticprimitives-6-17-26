/**
 * Integration: simulate what delegation.SessionManager will do.
 *   1. Wrap a data key with AAD context (sessionId, chainId, expiresAt).
 *   2. Encrypt a fake "session package" payload with AES-GCM using that key.
 *   3. Tamper with various pieces and assert the decryption fails or yields
 *      mismatched keys at the trip-wire layer.
 */

import { describe, it, expect } from 'vitest';
import { LocalAesProvider } from '../../src/providers/local';

const TEST_SECRET = '0x' + 'cc'.repeat(32);

async function aesGcmEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await globalThis.crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const ct = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    cryptoKey,
    plaintext,
  );
  return new Uint8Array(ct);
}

async function aesGcmDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await globalThis.crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
  const pt = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    cryptoKey,
    ciphertext,
  );
  return new Uint8Array(pt);
}

describe('data-key round trip (LocalAesProvider + AES-GCM payload)', () => {
  it('happy path: wrap → encrypt → unwrap → decrypt', async () => {
    process.env.NODE_ENV = 'test';
    const provider = new LocalAesProvider({ sessionSecretHex: TEST_SECRET });

    const aadContext = {
      session_id_h: 'deadbeef',
      account_address: '0xabc',
      chain_id: '31337',
      expires_at: '2026-12-31T00:00:00Z',
      key_version: provider.keyVersion,
    };

    const wrap = await provider.generateSessionDataKey({ aadContext });

    const iv = new Uint8Array(12);
    globalThis.crypto.getRandomValues(iv);
    const payload = new TextEncoder().encode(JSON.stringify({ sessionPrivateKey: '0xfeed', delegation: {} }));
    const aadBytes = new TextEncoder().encode(JSON.stringify(aadContext));
    const ct = await aesGcmEncrypt(wrap.plaintextDataKey, iv, payload, aadBytes);

    // Now simulate the decrypt side: unwrap data key + AES-GCM decrypt
    const unwrappedKey = await provider.decryptSessionDataKey({
      encryptedDataKey: wrap.encryptedDataKey,
      aadContext,
      keyId: wrap.keyId,
      keyVersion: wrap.keyVersion,
    });
    expect(unwrappedKey).toEqual(wrap.plaintextDataKey);

    const decrypted = await aesGcmDecrypt(unwrappedKey, iv, ct, aadBytes);
    expect(new TextDecoder().decode(decrypted)).toContain('0xfeed');
  });

  it('AAD trip-wire fires at the AES-GCM layer when chain_id is tampered', async () => {
    process.env.NODE_ENV = 'test';
    const provider = new LocalAesProvider({ sessionSecretHex: TEST_SECRET });
    const aadContext = { session_id_h: 'abc', chain_id: '31337', key_version: provider.keyVersion };
    const wrap = await provider.generateSessionDataKey({ aadContext });

    const iv = new Uint8Array(12);
    globalThis.crypto.getRandomValues(iv);
    const payload = new TextEncoder().encode('opaque payload');
    const aadBytes = new TextEncoder().encode(JSON.stringify(aadContext));
    const ct = await aesGcmEncrypt(wrap.plaintextDataKey, iv, payload, aadBytes);

    // Attacker tampers with aadContext during the unwrap
    const tamperedContext = { ...aadContext, chain_id: '99999' };
    const tamperedKey = await provider.decryptSessionDataKey({
      encryptedDataKey: wrap.encryptedDataKey,
      aadContext: tamperedContext,
      keyId: wrap.keyId,
      keyVersion: wrap.keyVersion,
    });

    // The HKDF derives a DIFFERENT key (no thrown error at unwrap).
    expect(tamperedKey).not.toEqual(wrap.plaintextDataKey);

    // The AES-GCM tag check fires when the attacker tries to decrypt the payload.
    const tamperedAadBytes = new TextEncoder().encode(JSON.stringify(tamperedContext));
    await expect(aesGcmDecrypt(tamperedKey, iv, ct, tamperedAadBytes)).rejects.toThrow();
    // Also fails even if the attacker keeps the original aadBytes:
    await expect(aesGcmDecrypt(tamperedKey, iv, ct, aadBytes)).rejects.toThrow();
  });
});
