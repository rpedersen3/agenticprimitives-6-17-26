import { describe, it, expect, beforeEach, vi } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { createMemoryAuditSink } from '@agenticprimitives/audit';
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
    delete process.env.A2A_ALLOW_LOCAL_MASTER_KEY;
    expect(() => new LocalSecp256k1Signer({ privateKeyHex: TEST_PRIV })).toThrow(/refuses to start/);
    process.env.NODE_ENV = 'test';
  });

  it('production opt-in: A2A_ALLOW_LOCAL_MASTER_KEY=true permits instantiation', () => {
    process.env.NODE_ENV = 'production';
    process.env.A2A_ALLOW_LOCAL_MASTER_KEY = 'true';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const s = new LocalSecp256k1Signer({ privateKeyHex: TEST_PRIV });
      expect(s).toBeInstanceOf(LocalSecp256k1Signer);
      // Loud boot warning is required so reviewers / operators see it.
      expect(warn).toHaveBeenCalled();
      expect(warn.mock.calls[0]![0]).toMatch(/A2A_ALLOW_LOCAL_MASTER_KEY=true/);
    } finally {
      warn.mockRestore();
      delete process.env.A2A_ALLOW_LOCAL_MASTER_KEY;
      process.env.NODE_ENV = 'test';
    }
  });

  it('production opt-in: any value other than "true" still throws', () => {
    process.env.NODE_ENV = 'production';
    process.env.A2A_ALLOW_LOCAL_MASTER_KEY = '1'; // truthy but not "true"
    try {
      expect(() => new LocalSecp256k1Signer({ privateKeyHex: TEST_PRIV })).toThrow(/refuses to start/);
    } finally {
      delete process.env.A2A_ALLOW_LOCAL_MASTER_KEY;
      process.env.NODE_ENV = 'test';
    }
  });

  // C3 pass 5b: every signing op emits a key-custody.sign audit row.
  // The invariant we test is hashed (not raw) sessionId in event.context.
  it('emits a key-custody.sign audit event when auditSink is wired', async () => {
    const sink = createMemoryAuditSink();
    const auditedSigner = new LocalSecp256k1Signer({ privateKeyHex: TEST_PRIV, auditSink: sink });
    const digest = keccak_256(new TextEncoder().encode('audit-emit-test'));
    const RAW_SESSION = 'session-abc-this-must-never-appear-raw';
    await auditedSigner.signA2AAction({
      digest,
      auditContext: { toolId: 'demo.tool', actionId: 'read_profile', sessionId: RAW_SESSION },
    });

    const events = sink.events();
    expect(events).toHaveLength(1);
    const evt = events[0]!;
    expect(evt.action).toBe('key-custody.sign');
    expect(evt.outcome).toBe('success');
    expect(evt.context?.keyId).toBe('local-master-secp256k1');
    expect(evt.context?.toolId).toBe('demo.tool');
    expect(evt.context?.actionId).toBe('read_profile');
    // Raw sessionId MUST NEVER appear; sessionHash is the only carry.
    expect(JSON.stringify(evt)).not.toContain(RAW_SESSION);
    expect(typeof evt.context?.sessionHash).toBe('string');
    expect((evt.context?.sessionHash as string).length).toBeGreaterThan(0);
  });

  it('fail-soft: sink throws do not propagate to the caller', async () => {
    const throwingSink = {
      async write() {
        throw new Error('sink unavailable');
      },
    };
    const auditedSigner = new LocalSecp256k1Signer({ privateKeyHex: TEST_PRIV, auditSink: throwingSink });
    const digest = keccak_256(new TextEncoder().encode('fail-soft-test'));
    await expect(auditedSigner.signA2AAction({ digest })).resolves.toBeDefined();
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
