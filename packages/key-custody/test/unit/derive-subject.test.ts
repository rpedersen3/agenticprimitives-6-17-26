import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { hexToBytes } from 'viem';
import {
  deriveSubjectSigner,
  deriveSubjectPrivateKeyHex,
  subjectCanonicalMessage,
  type SubjectId,
} from '../../src/derive-subject';

// A 32-byte master (Anvil's first key reused as a fixture — value irrelevant,
// only its bytes matter for the derivation).
const MASTER = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const GOOGLE = 'https://accounts.google.com';

function addrOf(privHex: `0x${string}`): string {
  const pub = secp256k1.getPublicKey(hexToBytes(privHex), false); // 65-byte uncompressed
  const hash = keccak_256(pub.slice(1));
  let s = '0x';
  for (const b of hash.slice(12)) s += b.toString(16).padStart(2, '0');
  return s;
}

describe('deriveSubjectSigner / deriveSubjectPrivateKeyHex', () => {
  const master = hexToBytes(MASTER);

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.A2A_MASTER_PRIVATE_KEY = MASTER;
    process.env.A2A_KMS_BACKEND = 'local-aes';
  });
  afterEach(() => {
    delete process.env.A2A_KMS_BACKEND;
  });

  it('is deterministic: same subject → same key + address', async () => {
    const subject: SubjectId = { iss: GOOGLE, sub: '108125' };
    const k1 = deriveSubjectPrivateKeyHex(master, subject);
    const k2 = deriveSubjectPrivateKeyHex(master, subject);
    expect(k1).toBe(k2);
    const a1 = await deriveSubjectSigner({ subject, developmentMode: true }).getSignerAddress();
    const a2 = await deriveSubjectSigner({ subject, developmentMode: true }).getSignerAddress();
    expect(a1).toBe(a2);
    expect(a1.toLowerCase()).toBe(addrOf(k1));
  });

  it('different sub → different key (isolation)', () => {
    const a = deriveSubjectPrivateKeyHex(master, { iss: GOOGLE, sub: '111' });
    const b = deriveSubjectPrivateKeyHex(master, { iss: GOOGLE, sub: '222' });
    expect(a).not.toBe(b);
  });

  it('different iss → different key', () => {
    const a = deriveSubjectPrivateKeyHex(master, { iss: GOOGLE, sub: '111' });
    const b = deriveSubjectPrivateKeyHex(master, { iss: 'https://login.microsoftonline.com', sub: '111' });
    expect(a).not.toBe(b);
  });

  it('rotation bumps the key', () => {
    const r0 = deriveSubjectPrivateKeyHex(master, { iss: GOOGLE, sub: '111', rotation: 0 });
    const r1 = deriveSubjectPrivateKeyHex(master, { iss: GOOGLE, sub: '111', rotation: 1 });
    expect(r0).not.toBe(r1);
    // default rotation === 0
    expect(deriveSubjectPrivateKeyHex(master, { iss: GOOGLE, sub: '111' })).toBe(r0);
  });

  it('separator injection cannot collide fields (iss/sub are percent-encoded)', () => {
    // ("a","b:c") must NOT equal ("a:b","c") — the ":" is unforgeable.
    const x = deriveSubjectPrivateKeyHex(master, { iss: 'a', sub: 'b:c' });
    const y = deriveSubjectPrivateKeyHex(master, { iss: 'a:b', sub: 'c' });
    expect(x).not.toBe(y);
    expect(subjectCanonicalMessage({ iss: 'a', sub: 'b:c' })).toBe('kms-custodian:v1:a:b%3Ac:0');
    expect(subjectCanonicalMessage({ iss: 'a:b', sub: 'c' })).toBe('kms-custodian:v1:a%3Ab:c:0');
  });

  it('derived key is a valid secp256k1 scalar in [1, n-1]', () => {
    const priv = BigInt(deriveSubjectPrivateKeyHex(master, { iss: GOOGLE, sub: 'x' }));
    expect(priv).toBeGreaterThan(0n);
    expect(priv).toBeLessThan(secp256k1.Point.Fn.ORDER);
  });

  it('the signer signs a 32-byte digest, recoverable to C_sub', async () => {
    const subject: SubjectId = { iss: GOOGLE, sub: 'sign-test' };
    const signer = deriveSubjectSigner({ subject, developmentMode: true });
    const cSub = (await signer.getSignerAddress()).toLowerCase();
    const digest = keccak_256(new TextEncoder().encode('userop-hash'));
    const { signature } = await signer.signA2AAction({ digest });
    expect(signature.length).toBe(65);
    const sig = new secp256k1.Signature(
      bytesToBig(signature.slice(0, 32)),
      bytesToBig(signature.slice(32, 64)),
    ).addRecoveryBit(signature[64]! - 27);
    const recovered = sig.recoverPublicKey(digest).toBytes(false);
    let recoveredAddr = '0x';
    for (const b of keccak_256(recovered.slice(1)).slice(12)) recoveredAddr += b.toString(16).padStart(2, '0');
    expect(recoveredAddr).toBe(cSub);
  });

  it('rejects empty iss/sub', () => {
    expect(() => subjectCanonicalMessage({ iss: '', sub: 'x' })).toThrow(/iss is required/);
    expect(() => subjectCanonicalMessage({ iss: GOOGLE, sub: '' })).toThrow(/sub is required/);
  });

  it('rejects a master shorter than 32 bytes', () => {
    expect(() => deriveSubjectPrivateKeyHex(new Uint8Array(16), { iss: GOOGLE, sub: 'x' })).toThrow(/≥ 32 bytes/);
  });

  it('local-aes path throws without a derivation master', () => {
    delete process.env.A2A_MASTER_PRIVATE_KEY;
    expect(() => deriveSubjectSigner({ subject: { iss: GOOGLE, sub: 'x' }, developmentMode: true })).toThrow(
      /A2A_MASTER_PRIVATE_KEY/,
    );
  });

  it('config.derivationSecretHex overrides the env master', async () => {
    const a = await deriveSubjectSigner({
      subject: { iss: GOOGLE, sub: 'x' },
      developmentMode: true,
      config: { derivationSecretHex: MASTER },
    }).getSignerAddress();
    const b = await deriveSubjectSigner({
      subject: { iss: GOOGLE, sub: 'x' },
      developmentMode: true,
      config: { derivationSecretHex: '0x' + '11'.repeat(32) },
    }).getSignerAddress();
    expect(a).not.toBe(b);
  });

  it('KMS backends fail closed (no silent local fallback)', () => {
    expect(() =>
      deriveSubjectSigner({ subject: { iss: GOOGLE, sub: 'x' }, backend: 'gcp-kms', developmentMode: true }),
    ).toThrow(/not yet implemented/);
    expect(() =>
      deriveSubjectSigner({ subject: { iss: GOOGLE, sub: 'x' }, backend: 'aws-kms', developmentMode: true }),
    ).toThrow(/not yet implemented/);
  });
});

function bytesToBig(b: Uint8Array): bigint {
  let n = 0n;
  for (const byte of b) n = (n << 8n) | BigInt(byte);
  return n;
}
