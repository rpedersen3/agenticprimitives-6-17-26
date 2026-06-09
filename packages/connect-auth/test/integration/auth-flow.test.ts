/**
 * Integration: simulate the demo-a2a /auth/siwe-verify route end-to-end.
 *   1. Build a SIWE message
 *   2. Sign with the user's EOA (via @noble)
 *   3. Verify the SIWE message (recovers address, checks nonce)
 *   4. Mint a JWT session cookie
 *   5. Verify the JWT session round-trips
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { buildMessage, verify as siweVerify } from '../../src/methods/siwe';
import { mintSession, verifySession } from '../../src/sessions';
import type { Address, Hex } from '@agenticprimitives/types';
import type { JwtClaims } from '../../src/types';

const PRIV_HEX = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const EXPECTED_ADDR = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' as Address;

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

describe('SIWE → JWT session integration', () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.SESSION_JWT_SECRETS;
    process.env.SESSION_JWT_SECRETS = 'kid:' + 'aa'.repeat(32);
  });
  afterEach(() => {
    if (prev !== undefined) process.env.SESSION_JWT_SECRETS = prev;
    else delete process.env.SESSION_JWT_SECRETS;
  });

  it('full happy path: sign SIWE → verify → mint session → verify session', () => {
    // 1. Build SIWE message (web-side)
    const message = buildMessage({
      domain: 'demo.agenticprimitives.local',
      address: EXPECTED_ADDR,
      statement: 'Sign in to the agenticprimitives demo.',
      uri: 'http://127.0.0.1:5173',
      chainId: 31337,
      nonce: 'integration-test-nonce',
      issuedAt: new Date().toISOString(),
    });

    // 2. User signs (browser-side)
    const sig = signEip191(message);

    // 3. a2a verifies SIWE (server-side)
    const siweResult = siweVerify(message, sig, {
      allowedDomains: ['demo.agenticprimitives.local'],
      expectedNonce: 'integration-test-nonce',
    });
    expect(siweResult.ok).toBe(true);
    if (!siweResult.ok) return;

    // 4. a2a mints a JWT cookie
    const placeholderSmartAccount = '0x1234567890123456789012345678901234567890' as Address;
    const claims: Omit<JwtClaims, 'iat' | 'exp'> = {
      sub: `did:ethr:31337:${siweResult.address}`,
      walletAddress: siweResult.address,
      smartAccountAddress: placeholderSmartAccount,
      name: 'Demo User',
      email: null,
      via: 'siwe',
      kind: 'session',
    };
    const cookie = mintSession(claims);
    expect(cookie.split('.')).toHaveLength(3);

    // 5. Browser sends cookie on next request; a2a verifies
    const parsed = verifySession(cookie);
    expect(parsed).not.toBeNull();
    expect(parsed!.walletAddress).toBe(siweResult.address);
    expect(parsed!.via).toBe('siwe');
  });

  it('replay defense: SIWE verify rejects wrong nonce, even with valid signature', () => {
    const message = buildMessage({
      domain: 'demo.local',
      address: EXPECTED_ADDR,
      uri: 'http://demo.local',
      chainId: 31337,
      nonce: 'attacker-nonce',
      issuedAt: new Date().toISOString(),
    });
    const sig = signEip191(message);
    const res = siweVerify(message, sig, { expectedNonce: 'our-nonce' });
    expect(res.ok).toBe(false);
  });

  it('tampered session cookie is rejected after legitimate SIWE login', () => {
    const message = buildMessage({
      domain: 'demo.local',
      address: EXPECTED_ADDR,
      uri: 'http://demo.local',
      chainId: 31337,
      nonce: 'n',
      issuedAt: new Date().toISOString(),
    });
    const sig = signEip191(message);
    const res = siweVerify(message, sig, { expectedNonce: 'n' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const cookie = mintSession({
      sub: 'x', walletAddress: res.address, smartAccountAddress: res.address,
      name: '', email: null, via: 'siwe', kind: 'session',
    });
    const [h, p, s] = cookie.split('.');
    // Forge a different payload
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 'attacker', exp: 9999999999 })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(verifySession(`${h}.${forgedPayload}.${s}`)).toBeNull();
  });
});
