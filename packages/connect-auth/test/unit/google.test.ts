import { describe, it, expect, beforeAll } from 'vitest';
import { beginLogin, completeLogin, GOOGLE_OIDC, oidcFacetId } from '../../src/methods/google.js';

const enc = new TextEncoder();
function b64url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? enc.encode(input) : input;
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const KID = 'test-key-1';
let privateKey: CryptoKey;
let publicJwk: JsonWebKey & { kid?: string };

beforeAll(async () => {
  const kp = (await globalThis.crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  privateKey = kp.privateKey;
  publicJwk = { ...(await globalThis.crypto.subtle.exportKey('jwk', kp.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
});

async function makeIdToken(claims: Record<string, unknown>, opts?: { alg?: string; sign?: boolean }): Promise<string> {
  const header = { alg: opts?.alg ?? 'RS256', kid: KID, typ: 'JWT' };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  let sig = '';
  if (opts?.sign !== false) {
    const bytes = await globalThis.crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, privateKey, enc.encode(signingInput));
    sig = b64url(new Uint8Array(bytes));
  }
  return `${signingInput}.${sig}`;
}

function mockFetch(idToken: string | null): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = url.toString();
    if (u === GOOGLE_OIDC.tokenEndpoint) {
      return { ok: idToken !== null, status: idToken ? 200 : 400, json: async () => (idToken ? { id_token: idToken } : {}) } as Response;
    }
    if (u === GOOGLE_OIDC.jwksUri) {
      return { ok: true, status: 200, json: async () => ({ keys: [publicJwk] }) } as Response;
    }
    throw new Error('unexpected fetch ' + u);
  }) as unknown as typeof fetch;
}

const NOW = 1_900_000_000_000; // fixed clock (ms)
const CLIENT_ID = 'client-123.apps.googleusercontent.com';

function baseClaims(over: Record<string, unknown> = {}) {
  return {
    iss: 'https://accounts.google.com',
    sub: '11223344',
    aud: CLIENT_ID,
    exp: Math.floor(NOW / 1000) + 3600,
    iat: Math.floor(NOW / 1000),
    nonce: 'N',
    email: 'a@example.com',
    email_verified: true,
    name: 'Ada',
    ...over,
  };
}

function completeInput(idToken: string, over: Record<string, unknown> = {}) {
  return {
    code: 'auth-code',
    returnedState: 'S',
    expectedState: 'S',
    expectedNonce: 'N',
    codeVerifier: 'verifier',
    redirectUri: 'https://connect.example/cb',
    clientId: CLIENT_ID,
    clientSecret: 'secret',
    fetchImpl: mockFetch(idToken),
    now: () => NOW,
    ...over,
  };
}

describe('beginLogin', () => {
  it('builds an S256 PKCE authorization URL with state + nonce + openid', () => {
    const r = beginLogin({ clientId: CLIENT_ID, redirectUri: 'https://connect.example/cb' });
    const url = new URL(r.authUrl);
    expect(url.origin + url.pathname).toBe(GOOGLE_OIDC.authorizationEndpoint);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBe(r.state);
    expect(url.searchParams.get('nonce')).toBe(r.nonce);
    expect(url.searchParams.get('scope')).toContain('openid');
    expect(r.codeVerifier.length).toBeGreaterThanOrEqual(43);
  });

  it('generates fresh values each call', () => {
    const a = beginLogin({ clientId: CLIENT_ID, redirectUri: 'x' });
    const b = beginLogin({ clientId: CLIENT_ID, redirectUri: 'x' });
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
  });
});

describe('completeLogin — happy path', () => {
  it('verifies a real RS256 id_token and returns the principal', async () => {
    const idToken = await makeIdToken(baseClaims());
    const res = await completeLogin(completeInput(idToken));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.principal.sub).toBe('11223344');
      expect(res.principal.iss).toBe('https://accounts.google.com');
      expect(res.principal.emailVerified).toBe(true);
      expect(res.principal.email).toBe('a@example.com');
      expect(oidcFacetId(res.principal.iss, res.principal.sub)).toBe('https://accounts.google.com#11223344');
    }
  });
});

describe('completeLogin — rejections', () => {
  it('rejects a state mismatch before any network call', async () => {
    const res = await completeLogin(completeInput(await makeIdToken(baseClaims()), { returnedState: 'WRONG' }));
    expect(res).toMatchObject({ ok: false, reason: 'state mismatch' });
  });

  it('rejects a nonce mismatch', async () => {
    const res = await completeLogin(completeInput(await makeIdToken(baseClaims({ nonce: 'OTHER' }))));
    expect(res.ok).toBe(false);
  });

  it('rejects an expired id_token', async () => {
    const res = await completeLogin(completeInput(await makeIdToken(baseClaims({ exp: Math.floor(NOW / 1000) - 1 }))));
    expect(res).toMatchObject({ ok: false, reason: 'id_token expired' });
  });

  it('rejects email_verified !== true (audit CN-3)', async () => {
    const res = await completeLogin(completeInput(await makeIdToken(baseClaims({ email_verified: false }))));
    expect(res).toMatchObject({ ok: false, reason: 'email_verified is not true' });
  });

  it('rejects a wrong aud', async () => {
    const res = await completeLogin(completeInput(await makeIdToken(baseClaims({ aud: 'someone-else' }))));
    expect(res.ok).toBe(false);
  });

  it('rejects a non-RS256 alg (alg-confusion defense, audit CN-4)', async () => {
    const idToken = await makeIdToken(baseClaims(), { alg: 'none', sign: false });
    const res = await completeLogin(completeInput(idToken));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('RS256');
  });

  it('rejects a tampered signature', async () => {
    const good = await makeIdToken(baseClaims());
    const tampered = good.slice(0, -4) + 'AAAA';
    const res = await completeLogin(completeInput(tampered));
    expect(res.ok).toBe(false);
  });
});
