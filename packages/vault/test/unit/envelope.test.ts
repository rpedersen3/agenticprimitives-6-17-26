// spec 277 Phase 2 — envelope encryption codec (WebCrypto AES-256-GCM + AAD binding).
import { describe, it, expect } from 'vitest';
import { sealEnvelope, openEnvelope, type DekWrapper } from '../../src/index.js';

const OWNER = 'eip155:8453:0xABCdef0000000000000000000000000000000001';

// Test DEK wrapper: identity-wrap (returns a fresh random DEK as both plaintext
// and "encrypted"). Exercises the codec's AES-GCM + AAD path without real KMS.
// It records the aadContext it was handed so we can assert AAD propagation.
function testWrapper(): DekWrapper & { lastAad?: Record<string, string> } {
  const w: DekWrapper & { lastAad?: Record<string, string> } = {
    async generateSessionDataKey({ aadContext }) {
      w.lastAad = aadContext;
      const dek = globalThis.crypto.getRandomValues(new Uint8Array(32));
      return { plaintextDataKey: dek, encryptedDataKey: dek, keyId: 'test-kid', keyVersion: 'v1' };
    },
    async decryptSessionDataKey({ encryptedDataKey }) {
      return encryptedDataKey;
    },
  };
  return w;
}

describe('sealEnvelope / openEnvelope', () => {
  it('round-trips an object through encrypt → decrypt', async () => {
    const w = testWrapper();
    const data = { email: 'a@b.c', phone: '+1', ssn_last4: '0000' };
    const sealed = await sealEnvelope({ owner: OWNER, resource: 'person-pii', classification: 'pii.sensitive', data, wrapper: w });

    expect(sealed.envelope.type).toBe('VaultObjectEnvelopeV1');
    expect(sealed.envelope.crypto.alg).toBe('A256GCM');
    expect(sealed.envelope.crypto.keyVersion).toBe('v1');
    expect(sealed.envelope.crypto.aadHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    // ciphertext is iv(12) + GCM output, never the plaintext
    expect(sealed.ciphertext.length).toBeGreaterThan(12);
    expect(new TextDecoder().decode(sealed.ciphertext)).not.toContain('a@b.c');
    // AAD bound owner/resource/classification/keyVersion
    expect(w.lastAad?.owner).toBe(OWNER.toLowerCase());

    const out = await openEnvelope<typeof data>({
      envelope: sealed.envelope,
      ciphertext: sealed.ciphertext,
      wrappedDek: sealed.wrappedDek,
      wrapper: w,
    });
    expect(out).toEqual(data);
  });

  it('rejects an envelope whose resource was tampered (AAD hash mismatch)', async () => {
    const w = testWrapper();
    const sealed = await sealEnvelope({ owner: OWNER, resource: 'person-pii', classification: 'pii.sensitive', data: { x: 1 }, wrapper: w });
    const tampered = { ...sealed.envelope, resource: 'org-sensitive' };
    await expect(
      openEnvelope({ envelope: tampered, ciphertext: sealed.ciphertext, wrappedDek: sealed.wrappedDek, wrapper: w }),
    ).rejects.toThrow(/AAD hash mismatch/);
  });

  it('rejects tampered ciphertext (AES-GCM auth tag fails)', async () => {
    const w = testWrapper();
    const sealed = await sealEnvelope({ owner: OWNER, resource: 'r', classification: 'secret.high', data: { x: 1 }, wrapper: w });
    const corrupt = new Uint8Array(sealed.ciphertext);
    corrupt[corrupt.length - 1] ^= 0xff;
    await expect(
      openEnvelope({ envelope: sealed.envelope, ciphertext: corrupt, wrappedDek: sealed.wrappedDek, wrapper: w }),
    ).rejects.toThrow();
  });

  it('two seals of the same data produce different ciphertext (fresh DEK + IV)', async () => {
    const w = testWrapper();
    const a = await sealEnvelope({ owner: OWNER, resource: 'r', classification: 'pii.low', data: { x: 1 }, wrapper: w });
    const b = await sealEnvelope({ owner: OWNER, resource: 'r', classification: 'pii.low', data: { x: 1 }, wrapper: w });
    expect(Array.from(a.ciphertext)).not.toEqual(Array.from(b.ciphertext));
  });
});
