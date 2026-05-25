import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mintSession, verifySession, SESSION_COOKIE, SESSION_TTL_SECONDS } from '../../src/sessions';
import type { JwtClaims } from '../../src/types';

const SECRET_A = 'kidA:' + 'aa'.repeat(32);
const SECRET_B = 'kidB:' + 'bb'.repeat(32);
const SECRET_C = 'kidC:' + 'cc'.repeat(32);

function baseClaims(): Omit<JwtClaims, 'iat' | 'exp'> {
  return {
    sub: 'did:ethr:31337:0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
    walletAddress: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
    smartAccountAddress: '0x1234567890123456789012345678901234567890',
    name: 'Demo User',
    email: null,
    via: 'siwe',
    kind: 'session',
  };
}

describe('sessions', () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.SESSION_JWT_SECRETS;
    process.env.SESSION_JWT_SECRETS = SECRET_A;
  });
  afterEach(() => {
    if (prev !== undefined) process.env.SESSION_JWT_SECRETS = prev;
    else delete process.env.SESSION_JWT_SECRETS;
  });

  it('exports stable constants', () => {
    expect(SESSION_COOKIE).toBe('agentic-session');
    expect(SESSION_TTL_SECONDS).toBe(86_400);
  });

  it('mintSession produces a 3-part dot-separated JWT', () => {
    const token = mintSession(baseClaims());
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    for (const p of parts) expect(p.length).toBeGreaterThan(0);
  });

  it('verifySession returns claims for a freshly-minted token', () => {
    const claims = baseClaims();
    const token = mintSession(claims);
    const parsed = verifySession(token);
    expect(parsed).not.toBeNull();
    expect(parsed!.sub).toBe(claims.sub);
    expect(parsed!.via).toBe('siwe');
    expect(typeof parsed!.iat).toBe('number');
    expect(typeof parsed!.exp).toBe('number');
    expect(parsed!.exp - parsed!.iat).toBe(SESSION_TTL_SECONDS);
  });

  it('verifySession rejects a tampered payload', () => {
    const token = mintSession(baseClaims());
    const [header, _payload, sig] = token.split('.');
    // Replace payload with another valid base64url (forged claims)
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 'attacker', exp: 9999999999 })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const tampered = `${header}.${forgedPayload}.${sig}`;
    expect(verifySession(tampered)).toBeNull();
  });

  it('verifySession rejects a tampered signature', () => {
    const token = mintSession(baseClaims());
    const [h, p] = token.split('.');
    const tampered = `${h}.${p}.AAAAAAAAAAAAAAAAAAAA`;
    expect(verifySession(tampered)).toBeNull();
  });

  it('verifySession rejects malformed input', () => {
    expect(verifySession('')).toBeNull();
    expect(verifySession('not.a.jwt.has.too.many.dots')).toBeNull();
    expect(verifySession('only.two')).toBeNull();
    expect(verifySession('xxx.yyy.zzz')).toBeNull();
  });

  it('rotation: token signed under kidA verifies under multi-key config including kidA', () => {
    const tokenA = mintSession(baseClaims());
    process.env.SESSION_JWT_SECRETS = `${SECRET_B},${SECRET_A}`; // signer is now B; A still valid for verify
    const parsed = verifySession(tokenA);
    expect(parsed).not.toBeNull();
  });

  it('rotation: token under retired key is rejected', () => {
    const tokenA = mintSession(baseClaims());
    process.env.SESSION_JWT_SECRETS = SECRET_C; // A is gone entirely
    expect(verifySession(tokenA)).toBeNull();
  });

  it('rejects malformed SESSION_JWT_SECRETS at mint time', () => {
    process.env.SESSION_JWT_SECRETS = 'not-a-valid-entry';
    expect(() => mintSession(baseClaims())).toThrow(/malformed SESSION_JWT_SECRETS/);
  });

  it('rejects too-short secret', () => {
    process.env.SESSION_JWT_SECRETS = 'kidX:' + 'aa'.repeat(8); // 8 bytes < 16
    expect(() => mintSession(baseClaims())).toThrow(/too short/);
  });

  it('throws when SESSION_JWT_SECRETS env is missing', () => {
    delete process.env.SESSION_JWT_SECRETS;
    expect(() => mintSession(baseClaims())).toThrow(/SESSION_JWT_SECRETS is required/);
  });
});
