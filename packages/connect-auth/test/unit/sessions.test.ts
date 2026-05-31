import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mintSession, verifySession, SESSION_COOKIE, SESSION_TTL_SECONDS, DEFAULT_SESSION_CLOCK_SKEW_SEC } from '../../src/sessions';
import type { JwtClaims } from '../../src/types';

const SECRET_A = 'kidA:' + 'aa'.repeat(32);
const SECRET_B = 'kidB:' + 'bb'.repeat(32);
const SECRET_C = 'kidC:' + 'cc'.repeat(32);

const TEST_ISS = 'https://broker.example.test';
const TEST_AUD = 'https://relying-app.example.test';

function baseClaims(): Omit<JwtClaims, 'iat' | 'exp' | 'sid'> {
  return {
    sub: 'did:ethr:31337:0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
    walletAddress: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
    smartAccountAddress: '0x1234567890123456789012345678901234567890',
    name: 'Demo User',
    email: null,
    via: 'siwe',
    kind: 'session',
    iss: TEST_ISS,
    aud: TEST_AUD,
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

// ─── R5.10 / PKG-CONNECT-AUTH-003 — iss / aud / sid / future-iat (P1-1) ─

describe('R5.10 / PKG-CONNECT-AUTH-003 — iss / aud binding (external P1-1)', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let prevSecrets: string | undefined;
  beforeEach(() => {
    prevSecrets = process.env.SESSION_JWT_SECRETS;
    process.env.SESSION_JWT_SECRETS = SECRET_A;
  });
  afterEach(() => {
    if (prevSecrets !== undefined) process.env.SESSION_JWT_SECRETS = prevSecrets;
    else delete process.env.SESSION_JWT_SECRETS;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('exports DEFAULT_SESSION_CLOCK_SKEW_SEC', () => {
    expect(DEFAULT_SESSION_CLOCK_SKEW_SEC).toBe(30);
  });

  it('mintSession includes iss + aud + auto-generated sid in claims', () => {
    const token = mintSession(baseClaims());
    const parsed = verifySession(token);
    expect(parsed!.iss).toBe(TEST_ISS);
    expect(parsed!.aud).toBe(TEST_AUD);
    // sid must be present + non-empty (auto-generated)
    expect(typeof parsed!.sid).toBe('string');
    expect(parsed!.sid.length).toBeGreaterThanOrEqual(32); // 16 bytes -> 32 hex chars
  });

  it('mintSession honors caller-supplied sid', () => {
    const explicitSid = 'my-stable-session-id-abc';
    const token = mintSession({ ...baseClaims(), sid: explicitSid });
    const parsed = verifySession(token);
    expect(parsed!.sid).toBe(explicitSid);
  });

  it('mintSession generates DIFFERENT sids across calls when not supplied', () => {
    const t1 = mintSession(baseClaims());
    const t2 = mintSession(baseClaims());
    expect(verifySession(t1)!.sid).not.toBe(verifySession(t2)!.sid);
  });

  it('verifySession passes when expectedIss matches', () => {
    const token = mintSession(baseClaims());
    expect(verifySession(token, { expectedIss: TEST_ISS })).not.toBeNull();
  });

  it('verifySession REJECTS when expectedIss does not match', () => {
    const token = mintSession(baseClaims());
    expect(verifySession(token, { expectedIss: 'https://attacker.example.test' })).toBeNull();
  });

  it('verifySession passes when expectedAud matches (string aud)', () => {
    const token = mintSession(baseClaims());
    expect(verifySession(token, { expectedAud: TEST_AUD })).not.toBeNull();
  });

  it('verifySession REJECTS when expectedAud does not match', () => {
    const token = mintSession(baseClaims());
    expect(verifySession(token, { expectedAud: 'https://different-app.example.test' })).toBeNull();
  });

  it('verifySession passes when expectedAud is in claims.aud[] array', () => {
    const claims = { ...baseClaims(), aud: ['https://app-a.test', TEST_AUD, 'https://app-c.test'] };
    const token = mintSession(claims);
    expect(verifySession(token, { expectedAud: TEST_AUD })).not.toBeNull();
  });

  it('verifySession REJECTS when expectedAud is NOT in claims.aud[] array', () => {
    const claims = { ...baseClaims(), aud: ['https://app-a.test', 'https://app-b.test'] };
    const token = mintSession(claims);
    expect(verifySession(token, { expectedAud: TEST_AUD })).toBeNull();
  });

  it('verifySession passes both iss + aud together when both correct', () => {
    const token = mintSession(baseClaims());
    expect(verifySession(token, { expectedIss: TEST_ISS, expectedAud: TEST_AUD })).not.toBeNull();
  });

  it('verifySession REJECTS when iss matches but aud is wrong', () => {
    const token = mintSession(baseClaims());
    expect(verifySession(token, { expectedIss: TEST_ISS, expectedAud: 'https://wrong.test' })).toBeNull();
  });

  // ─── Production gate ─────────────────────────────────────────────

  it('production gate: throws when expectedIss is missing', () => {
    process.env.NODE_ENV = 'production';
    const token = mintSession(baseClaims());
    expect(() => verifySession(token, { expectedAud: TEST_AUD })).toThrow(/requires `expectedIss` in production/);
  });

  it('production gate: throws when expectedAud is missing', () => {
    process.env.NODE_ENV = 'production';
    const token = mintSession(baseClaims());
    expect(() => verifySession(token, { expectedIss: TEST_ISS })).toThrow(/requires `expectedAud` in production/);
  });

  it('production gate: developmentMode: true bypasses the gate', () => {
    process.env.NODE_ENV = 'production';
    const token = mintSession(baseClaims());
    expect(() => verifySession(token, { developmentMode: true })).not.toThrow();
  });

  it('production gate: NOT triggered when NODE_ENV is undefined', () => {
    delete process.env.NODE_ENV;
    const token = mintSession(baseClaims());
    expect(() => verifySession(token)).not.toThrow();
  });

  // ─── Future-iat + clock-skew ─────────────────────────────────────

  it('verifySession REJECTS a future-iat token beyond default skew', () => {
    // Forge a token with iat 5 minutes in the future + a valid signature.
    // We do this by minting normally then patching iat via re-encode.
    // Simpler: minting with Date.now mocked.
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 60 * 60 * 1000; // mint as if 1 hour ahead
      const futureToken = mintSession(baseClaims());
      Date.now = realNow; // restore — verify in the present
      // Default skew = 30s; iat is 1 hour ahead → must reject.
      expect(verifySession(futureToken)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it('verifySession ACCEPTS a future-iat token within clockSkewSec', () => {
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 10 * 1000; // mint 10s ahead
      const slightlyFutureToken = mintSession(baseClaims());
      Date.now = realNow;
      // Default skew = 30s; iat is 10s ahead → must accept.
      expect(verifySession(slightlyFutureToken)).not.toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it('verifySession ACCEPTS an expired token within clockSkewSec', () => {
    const realNow = Date.now;
    try {
      // Mint normally; advance clock to just past exp + within skew
      const token = mintSession(baseClaims());
      const movedAhead = realNow() + (SESSION_TTL_SECONDS + 15) * 1000;
      Date.now = () => movedAhead;
      // exp + 30s skew is still in the future → accept
      expect(verifySession(token)).not.toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it('verifySession REJECTS an expired token beyond clockSkewSec', () => {
    const realNow = Date.now;
    try {
      const token = mintSession(baseClaims());
      const movedAhead = realNow() + (SESSION_TTL_SECONDS + 120) * 1000;
      Date.now = () => movedAhead;
      // exp + 30s skew has passed → reject
      expect(verifySession(token)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it('verifySession custom clockSkewSec=0 rejects any drift', () => {
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 1000; // mint 1s ahead
      const token = mintSession(baseClaims());
      Date.now = realNow;
      // Custom skew = 0 → 1s future-iat should reject
      expect(verifySession(token, { clockSkewSec: 0 })).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });
});
