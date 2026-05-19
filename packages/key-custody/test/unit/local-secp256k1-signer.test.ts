import { describe, it, expect, beforeEach } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { LocalSecp256k1Signer } from '../../src/providers/local';

// Deterministic test key (Anvil's first account's private key).
const TEST_PRIV = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const EXPECTED_ADDR = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'; // anvil[0], lowercased

describe('LocalSecp256k1Signer', () => {
  let signer: LocalSecp256k1Signer;
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    signer = new LocalSecp256k1Signer({ privateKeyHex: TEST_PRIV });
  });

  it('derives the correct address from the private key', async () => {
    const addr = await signer.getSignerAddress();
    expect(addr.toLowerCase()).toBe(EXPECTED_ADDR);
  });

  it('signA2AAction returns a 65-byte (r,s,v) signature', async () => {
    const digest = keccak_256(new TextEncoder().encode('hello world'));
    const { signature, keyId, signerAddress } = await signer.signA2AAction({ digest });
    expect(signature.length).toBe(65);
    expect(keyId).toBe('local-master-secp256k1');
    expect(signerAddress.toLowerCase()).toBe(EXPECTED_ADDR);
    // v must be 27 or 28
    expect([27, 28]).toContain(signature[64]);
  });

  it('signature is recoverable to the same public key', async () => {
    const digest = keccak_256(new TextEncoder().encode('round-trip test'));
    const { signature } = await signer.signA2AAction({ digest });

    const r = signature.slice(0, 32);
    const s = signature.slice(32, 64);
    const recovery = signature[64]! - 27;
    const sig = new secp256k1.Signature(bytesToBig(r), bytesToBig(s)).addRecoveryBit(recovery);
    const recovered = sig.recoverPublicKey(digest).toRawBytes(false);
    // Recover the address from the recovered pubkey
    const recoveredHash = keccak_256(recovered.slice(1));
    const recoveredAddr = '0x' + bytesToHex(recoveredHash.slice(12));
    expect(recoveredAddr).toBe(EXPECTED_ADDR);
  });

  it('rejects non-32-byte digests', async () => {
    const badDigest = new Uint8Array(31);
    await expect(signer.signA2AAction({ digest: badDigest })).rejects.toThrow(/32-byte digest/);
  });

  it('production guard: refuses to instantiate when NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => new LocalSecp256k1Signer({ privateKeyHex: TEST_PRIV })).toThrow(/refuses to start/);
    process.env.NODE_ENV = 'test';
  });
});

function bytesToBig(b: Uint8Array): bigint {
  let n = 0n;
  for (const byte of b) n = (n << 8n) | BigInt(byte);
  return n;
}

function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (const byte of b) s += byte.toString(16).padStart(2, '0');
  return s;
}
