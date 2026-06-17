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

// Context-DERIVING wrapper: the DEK is derived FROM the aadContext (a SHA-256
// stand-in for key-custody's HKDF LocalAesProvider). Unlike `testWrapper`, this
// one re-derives on unwrap, so wrap + unwrap MUST be handed byte-identical
// context — the realistic shape the mock above misses. Regression guard for the
// keyVersion-in-wrap-context bug (seal wrapped under keyVersion='', open unwrapped
// under the real keyVersion → different derived DEK → decrypt failure).
function contextDerivingWrapper(): DekWrapper {
  const enc = new TextEncoder();
  async function deriveKey(aadContext: Record<string, string>): Promise<Uint8Array> {
    const canonical = Object.keys(aadContext).sort().map((k) => `${k}=${aadContext[k]}`).join('\n');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', enc.encode('master-secret|' + canonical) as unknown as ArrayBuffer);
    return new Uint8Array(digest);
  }
  return {
    async generateSessionDataKey({ aadContext }) {
      return { plaintextDataKey: await deriveKey(aadContext), encryptedDataKey: new Uint8Array(0), keyId: 'ctx-kid', keyVersion: 'v1' };
    },
    async decryptSessionDataKey({ aadContext }) {
      return deriveKey(aadContext);
    },
  };
}

describe('sealEnvelope / openEnvelope', () => {
  it('round-trips with a context-DERIVING wrapper (DEK bound to aadContext)', async () => {
    // Pre-fix this threw "Decryption failed" because seal wrapped the DEK under a
    // keyVersion='' context while open unwrapped under keyVersion='v1'.
    const w = contextDerivingWrapper();
    const data = { grant: 'urn:ap:mcp-grant:1', scopes: ['mcp:invoke'] };
    const sealed = await sealEnvelope({ owner: OWNER, resource: 'urn:ap:mcp-grant:1', classification: 'delegation.private', data, wrapper: w });
    const out = await openEnvelope<typeof data>({
      envelope: sealed.envelope,
      ciphertext: sealed.ciphertext,
      wrappedDek: sealed.wrappedDek,
      wrapper: w,
    });
    expect(out).toEqual(data);
  });

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
