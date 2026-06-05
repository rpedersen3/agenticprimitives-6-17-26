import { describe, it, expect } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { buildMessage, parseMessage, verify } from '../../src/methods/siwe';
import type { Address, Hex } from '@agenticprimitives/types';

// Deterministic test key (Anvil[0]).
const PRIV_HEX = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ADDRESS = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' as Address;

function privBytes(): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(PRIV_HEX.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function eip191Digest(message: string): Uint8Array {
  const bytes = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${bytes.length}`);
  const combined = new Uint8Array(prefix.length + bytes.length);
  combined.set(prefix, 0);
  combined.set(bytes, prefix.length);
  return keccak_256(combined);
}

function signEip191(message: string): Hex {
  const digest = eip191Digest(message);
  const sig = secp256k1.Signature.fromBytes(
    secp256k1.sign(digest, privBytes(), { prehash: false, format: "recovered" }),
    "recovered",
  );
  const r = sig.r.toString(16).padStart(64, '0');
  const s = sig.s.toString(16).padStart(64, '0');
  const v = (sig.recovery ?? 0) + 27;
  return ('0x' + r + s + v.toString(16).padStart(2, '0')) as Hex;
}

describe('siwe buildMessage', () => {
  it('produces the EIP-4361 shape we expect', () => {
    const msg = buildMessage({
      domain: 'demo.local',
      address: ADDRESS,
      uri: 'http://demo.local',
      chainId: 31337,
      nonce: 'abc123',
      issuedAt: '2026-05-19T00:00:00.000Z',
    });
    expect(msg).toContain('demo.local wants you to sign in with your Ethereum account:');
    expect(msg).toContain(ADDRESS);
    expect(msg).toContain('URI: http://demo.local');
    expect(msg).toContain('Version: 1');
    expect(msg).toContain('Chain ID: 31337');
    expect(msg).toContain('Nonce: abc123');
    expect(msg).toContain('Issued At: 2026-05-19T00:00:00.000Z');
  });

  it('roundtrips through parseMessage', () => {
    const built = buildMessage({
      domain: 'demo.local',
      address: ADDRESS,
      uri: 'http://demo.local',
      chainId: 31337,
      nonce: 'abc123',
      issuedAt: '2026-05-19T00:00:00.000Z',
    });
    const parsed = parseMessage(built);
    expect(parsed.domain).toBe('demo.local');
    expect(parsed.address.toLowerCase()).toBe(ADDRESS);
    expect(parsed.chainId).toBe(31337);
    expect(parsed.nonce).toBe('abc123');
    expect(parsed.version).toBe('1');
  });

  it('parses optional statement + expirationTime', () => {
    const built = buildMessage({
      domain: 'demo.local',
      address: ADDRESS,
      statement: 'Sign in to the demo.',
      uri: 'http://demo.local',
      chainId: 31337,
      nonce: 'xyz',
      issuedAt: '2026-05-19T00:00:00.000Z',
      expirationTime: '2030-01-01T00:00:00.000Z',
    });
    const parsed = parseMessage(built);
    expect(parsed.statement).toBe('Sign in to the demo.');
    expect(parsed.expirationTime).toBe('2030-01-01T00:00:00.000Z');
  });
});

describe('siwe verify', () => {
  it('accepts a valid signature from the right address', () => {
    const msg = buildMessage({
      domain: 'demo.local',
      address: ADDRESS,
      uri: 'http://demo.local',
      chainId: 31337,
      nonce: 'n1',
      issuedAt: new Date().toISOString(),
    });
    const sig = signEip191(msg);
    const res = verify(msg, sig);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.address.toLowerCase()).toBe(ADDRESS);
  });

  it('rejects when message address differs from recovered signer', () => {
    const msg = buildMessage({
      domain: 'demo.local',
      address: '0xffffffffffffffffffffffffffffffffffffffff' as Address, // wrong address
      uri: 'http://demo.local',
      chainId: 31337,
      nonce: 'n1',
      issuedAt: new Date().toISOString(),
    });
    const sig = signEip191(msg);
    const res = verify(msg, sig);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('recovered signer');
  });

  it('rejects expired messages', () => {
    const msg = buildMessage({
      domain: 'demo.local',
      address: ADDRESS,
      uri: 'http://demo.local',
      chainId: 31337,
      nonce: 'n1',
      issuedAt: '2026-01-01T00:00:00.000Z',
      expirationTime: '2026-01-02T00:00:00.000Z',
    });
    const sig = signEip191(msg);
    const res = verify(msg, sig, { now: () => Date.parse('2026-03-01T00:00:00.000Z') });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('expired');
  });

  it('enforces allowedDomains', () => {
    const msg = buildMessage({
      domain: 'attacker.local',
      address: ADDRESS,
      uri: 'http://attacker.local',
      chainId: 31337,
      nonce: 'n1',
      issuedAt: new Date().toISOString(),
    });
    const sig = signEip191(msg);
    const res = verify(msg, sig, { allowedDomains: ['demo.local'] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('not allowed');
  });

  it('enforces expectedNonce', () => {
    const msg = buildMessage({
      domain: 'demo.local',
      address: ADDRESS,
      uri: 'http://demo.local',
      chainId: 31337,
      nonce: 'theirs',
      issuedAt: new Date().toISOString(),
    });
    const sig = signEip191(msg);
    const res = verify(msg, sig, { expectedNonce: 'ours' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('nonce');
  });

  it('rejects malformed signatures', () => {
    const msg = buildMessage({
      domain: 'demo.local',
      address: ADDRESS,
      uri: 'http://demo.local',
      chainId: 31337,
      nonce: 'n1',
      issuedAt: new Date().toISOString(),
    });
    const res = verify(msg, '0xshort' as Hex);
    expect(res.ok).toBe(false);
  });
});
