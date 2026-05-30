import { describe, it, expect, beforeAll } from 'vitest';
import type { CanonicalAgentId, CredentialPrincipal, Assurance } from '@agenticprimitives/types';
import type { Resolution, AgentWithEvidence } from '@agenticprimitives/identity-directory';
import {
  generateBrokerKeypair,
  mintAgentSession,
  verifyAgentSession,
  mintIdToken,
  mintBoundIdToken,
  verifyIdToken,
  verifyEnrollmentGrantBinding,
  verifyPkceS256,
  publishJwks,
  importJwks,
  convergence,
  canIssueSession,
  isCustodiedNamespace,
  selectFromResolution,
  requiresStepUp,
  issueForResolution,
  validateRedirectUri,
  newAuthCode,
  createInMemoryAuthCodeStore,
  type BrokerSigner,
} from '../../src/index.js';

const SUB = 'eip155:8453:0x1111111111111111111111111111111111111111' as CanonicalAgentId;
const HEDERA = 'hedera:mainnet:0.0.123' as CanonicalAgentId;
const PRINCIPAL: CredentialPrincipal = { kind: 'siwe-eoa', id: '0xeoa', assurance: 'onchain-confirmed' };

function b64url(s: string): string {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function agent(id: CanonicalAgentId, assurance: Assurance): AgentWithEvidence {
  return { id, assurance, evidence: [{ source: 'onchain', assurance, observedAt: new Date().toISOString(), ref: 'x' }] };
}
function res(...agents: AgentWithEvidence[]): Resolution {
  return { agents };
}

const NOW = 1_900_000_000_000;
const mintArgs = { aud: 'rp-1', iss: 'https://connect.example', ttlSeconds: 300, now: () => NOW };

describe('token — mint / verify roundtrip', () => {
  for (const alg of ['EdDSA', 'ES256'] as const) {
    it(`${alg}: mints and verifies`, async () => {
      const signer = await generateBrokerKeypair(alg);
      const token = await mintAgentSession({ sub: SUB, principal: PRINCIPAL, assurance: 'onchain-confirmed', ...mintArgs }, signer);
      const r = await verifyAgentSession(token, { keys: [signer], expectedIss: mintArgs.iss, expectedAud: 'rp-1', now: () => NOW });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.session.sub).toBe(SUB);
        expect((r.session as { owner?: unknown }).owner).toBeUndefined();
      }
    });
  }

  it('verifies through a JWKS publish → import roundtrip', async () => {
    const signer = await generateBrokerKeypair('EdDSA');
    const token = await mintAgentSession({ sub: SUB, principal: PRINCIPAL, assurance: 'onchain-confirmed', ...mintArgs }, signer);
    const keys = await importJwks(await publishJwks([signer]));
    const r = await verifyAgentSession(token, { keys, expectedAud: 'rp-1', now: () => NOW });
    expect(r.ok).toBe(true);
  });

  it('H7-B.4: rejects when expectedAud is missing (PKG-CONNECT-001-sec)', async () => {
    const signer = await generateBrokerKeypair('EdDSA');
    const token = await mintAgentSession({ sub: SUB, principal: PRINCIPAL, assurance: 'onchain-confirmed', ...mintArgs }, signer);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await verifyAgentSession(token, { keys: [signer], now: () => NOW } as any);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('expectedAud');
  });

  it('H7-B.4: rejects future-dated iat beyond clock skew (PKG-CONNECT-002)', async () => {
    const signer = await generateBrokerKeypair('EdDSA');
    const header = b64url(JSON.stringify({ alg: 'EdDSA', kid: signer.kid, typ: 'JWT' }));
    const future = Math.floor(NOW / 1000) + 600; // 10 min in future
    const payload = b64url(JSON.stringify({ sub: SUB, principal: PRINCIPAL, assurance: 'onchain-confirmed', aud: 'rp-1', iss: mintArgs.iss, iat: future, exp: future + 300, jti: 'x' }));
    const sigBytes = await globalThis.crypto.subtle.sign({ name: 'Ed25519' }, signer.privateKey, new TextEncoder().encode(`${header}.${payload}`));
    const token = `${header}.${payload}.${Buffer.from(new Uint8Array(sigBytes)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
    const r = await verifyAgentSession(token, { keys: [signer], expectedAud: 'rp-1', now: () => NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('iat');
  });
});

describe('token — rejections (CN-4 + ADR-0016)', () => {
  it('rejects when no key matches the kid', async () => {
    const signer = await generateBrokerKeypair('EdDSA');
    const token = await mintAgentSession({ sub: SUB, principal: PRINCIPAL, assurance: 'onchain-confirmed', ...mintArgs }, signer);
    const other = await generateBrokerKeypair('EdDSA');
    const r = await verifyAgentSession(token, { keys: [other], expectedAud: 'rp-1', now: () => NOW });
    expect(r.ok).toBe(false);
  });

  it('rejects an alg that does not match the key (alg-confusion)', async () => {
    const signer = await generateBrokerKeypair('ES256');
    const token = await mintAgentSession({ sub: SUB, principal: PRINCIPAL, assurance: 'onchain-confirmed', ...mintArgs }, signer);
    // present the same key but claim its alg is EdDSA
    const r = await verifyAgentSession(token, { keys: [{ ...signer, alg: 'EdDSA' }], expectedAud: 'rp-1', now: () => NOW });
    expect(r.ok).toBe(false);
  });

  it('rejects a tampered signature', async () => {
    const signer = await generateBrokerKeypair('EdDSA');
    const token = await mintAgentSession({ sub: SUB, principal: PRINCIPAL, assurance: 'onchain-confirmed', ...mintArgs }, signer);
    const r = await verifyAgentSession(token.slice(0, -4) + 'AAAA', { keys: [signer], expectedAud: 'rp-1', now: () => NOW });
    expect(r.ok).toBe(false);
  });

  it('rejects an expired token', async () => {
    const signer = await generateBrokerKeypair('EdDSA');
    const token = await mintAgentSession({ sub: SUB, principal: PRINCIPAL, assurance: 'onchain-confirmed', ...mintArgs }, signer);
    const r = await verifyAgentSession(token, { keys: [signer], expectedAud: 'rp-1', now: () => NOW + 10_000_000 });
    expect(r).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('rejects a token carrying an owner field (ADR-0016)', async () => {
    const signer = await generateBrokerKeypair('EdDSA');
    const header = b64url(JSON.stringify({ alg: 'EdDSA', kid: signer.kid, typ: 'JWT' }));
    const payload = b64url(JSON.stringify({ sub: SUB, owner: SUB, aud: 'rp-1', iss: mintArgs.iss, iat: NOW / 1000, exp: NOW / 1000 + 300, jti: 'x' }));
    const sigBytes = await globalThis.crypto.subtle.sign({ name: 'Ed25519' }, signer.privateKey, new TextEncoder().encode(`${header}.${payload}`));
    const token = `${header}.${payload}.${Buffer.from(new Uint8Array(sigBytes)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
    const r = await verifyAgentSession(token, { keys: [signer], expectedAud: 'rp-1', now: () => NOW });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toContain('owner');
  });

  it('rejects an aud mismatch', async () => {
    const signer = await generateBrokerKeypair('EdDSA');
    const token = await mintAgentSession({ sub: SUB, principal: PRINCIPAL, assurance: 'onchain-confirmed', ...mintArgs }, signer);
    const r = await verifyAgentSession(token, { keys: [signer], expectedAud: 'other-rp', now: () => NOW });
    expect(r.ok).toBe(false);
  });
});

describe('broker — convergence + gates', () => {
  it('convergence cardinality', () => {
    expect(convergence(res()).kind).toBe('none');
    expect(convergence(res(agent(SUB, 'onchain-confirmed'))).kind).toBe('one');
    expect(convergence(res(agent(SUB, 'onchain-confirmed'), agent(HEDERA, 'asserted'))).kind).toBe('many');
  });

  it('canIssueSession: eip155 + floor ok; non-EVM gated (CN-8); below floor gated (CN-6)', () => {
    expect(canIssueSession(SUB, 'onchain-confirmed').ok).toBe(true);
    expect(canIssueSession(HEDERA, 'onchain-confirmed').ok).toBe(false);
    expect(isCustodiedNamespace(HEDERA)).toBe(false);
    expect(canIssueSession(SUB, 'asserted').ok).toBe(false);
  });

  it('selectFromResolution server-binds the chosen sub (CN-5)', () => {
    const r = res(agent(SUB, 'onchain-confirmed'));
    expect(selectFromResolution(r, SUB)).toBe(SUB);
    expect(selectFromResolution(r, HEDERA)).toBeNull();
  });

  it('requiresStepUp classifies custody-class actions (CN-2)', () => {
    expect(requiresStepUp('credential-change')).toBe(true);
    expect(requiresStepUp('high-value-spend')).toBe(true);
    expect(requiresStepUp('read-profile')).toBe(false);
  });
});

describe('broker — issueForResolution', () => {
  let signer: BrokerSigner;
  beforeAll(async () => { signer = await generateBrokerKeypair('EdDSA'); });

  it('0 agents → bootstrap', async () => {
    expect((await issueForResolution({ resolution: res(), principal: PRINCIPAL, signer, ...mintArgs })).status).toBe('bootstrap');
  });
  it('many agents → disambiguate', async () => {
    const out = await issueForResolution({ resolution: res(agent(SUB, 'onchain-confirmed'), agent('eip155:1:0x2222222222222222222222222222222222222222' as CanonicalAgentId, 'onchain-confirmed')), principal: PRINCIPAL, signer, ...mintArgs });
    expect(out.status).toBe('disambiguate');
  });
  it('1 confirmed agent → issued (verifiable token)', async () => {
    const out = await issueForResolution({ resolution: res(agent(SUB, 'onchain-confirmed')), principal: PRINCIPAL, signer, ...mintArgs });
    expect(out.status).toBe('issued');
    if (out.status === 'issued') {
      const v = await verifyAgentSession(out.token, { keys: [signer], expectedAud: 'rp-1', now: () => NOW });
      expect(v.ok).toBe(true);
    }
  });
  it('1 agent below the floor → rejected (CN-6)', async () => {
    const out = await issueForResolution({ resolution: res(agent(SUB, 'asserted')), principal: PRINCIPAL, signer, ...mintArgs });
    expect(out.status).toBe('rejected');
  });
  it('1 non-EVM agent → rejected (CN-8)', async () => {
    const out = await issueForResolution({ resolution: res(agent(HEDERA, 'onchain-confirmed')), principal: PRINCIPAL, signer, ...mintArgs });
    expect(out.status).toBe('rejected');
  });
});

describe('redirect — allowlist + single-use code store', () => {
  it('validateRedirectUri is exact-match (CN-1)', () => {
    const reg = ['https://shop.example/cb'];
    expect(validateRedirectUri(reg, 'https://shop.example/cb')).toBe(true);
    expect(validateRedirectUri(reg, 'https://shop.example/cb/../evil')).toBe(false);
    expect(validateRedirectUri(reg, 'https://evil.example/cb')).toBe(false);
  });

  it('auth code is single-use + TTL-bounded (CN-9)', () => {
    let t = 0;
    const store = createInMemoryAuthCodeStore(() => t);
    const code = newAuthCode();
    store.put(code, { token: 'tok', aud: 'rp-1' }, 1000);
    expect(store.take(code)).toEqual({ token: 'tok', aud: 'rp-1' });
    expect(store.take(code)).toBeNull(); // single use
    const code2 = newAuthCode();
    store.put(code2, { token: 'tok2', aud: 'rp-1' }, 1000);
    t = 2000;
    expect(store.take(code2)).toBeNull(); // expired
  });
});

describe('OIDC id_token (spec 230) — mint / verify', () => {
  const idArgs = { iss: 'https://r-pedersen.impact-agent.io', aud: 'demo-org', ttlSeconds: 600, now: () => NOW };

  it('roundtrips with standard + agent-extension claims (ES256)', async () => {
    const signer = await generateBrokerKeypair('ES256');
    const token = await mintIdToken({ sub: SUB, nonce: 'n-123', agentName: 'rpedersen.agent', ...idArgs }, signer);
    const r = await verifyIdToken(token, {
      keys: [signer],
      expectedIss: idArgs.iss,
      expectedAud: 'demo-org',
      expectedNonce: 'n-123',
      now: () => NOW,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.claims.sub).toBe(SUB);
      expect(r.claims.canonical_agent_id).toBe(SUB); // mirrors sub (ADR-0010/0016)
      expect(r.claims.agent_name).toBe('rpedersen.agent');
      expect(r.claims.nonce).toBe('n-123');
    }
  });

  it('rejects nonce mismatch (replay binding)', async () => {
    const signer = await generateBrokerKeypair('ES256');
    const token = await mintIdToken({ sub: SUB, nonce: 'n-123', ...idArgs }, signer);
    const r = await verifyIdToken(token, { keys: [signer], expectedIss: idArgs.iss, expectedAud: 'demo-org', expectedNonce: 'WRONG', now: () => NOW });
    expect(r.ok).toBe(false);
  });

  it('rejects iss / aud mismatch + wrong key', async () => {
    const signer = await generateBrokerKeypair('ES256');
    const other = await generateBrokerKeypair('ES256');
    const token = await mintIdToken({ sub: SUB, ...idArgs }, signer);
    expect((await verifyIdToken(token, { keys: [signer], expectedIss: 'https://evil.example', expectedAud: 'demo-org', now: () => NOW })).ok).toBe(false);
    expect((await verifyIdToken(token, { keys: [signer], expectedIss: idArgs.iss, expectedAud: 'other-rp', now: () => NOW })).ok).toBe(false);
    expect((await verifyIdToken(token, { keys: [other], expectedIss: idArgs.iss, expectedAud: 'demo-org', now: () => NOW })).ok).toBe(false);
  });

  it('rejects expired', async () => {
    const signer = await generateBrokerKeypair('ES256');
    const token = await mintIdToken({ sub: SUB, ...idArgs }, signer);
    const r = await verifyIdToken(token, { keys: [signer], expectedIss: idArgs.iss, expectedAud: 'demo-org', now: () => NOW + 601_000 });
    expect(r.ok).toBe(false);
  });
});

describe('H7-B.5 — BoundMintIdTokenInput + verifyEnrollmentGrantBinding', () => {
  const idArgs2 = { iss: 'https://r-pedersen.impact-agent.io', aud: 'demo-org', ttlSeconds: 600, now: () => NOW };
  const GRANT_ID = 'gr_01HQXXEXAMPLEGRANT';
  const DELEG_HASH = '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789' as `0x${string}`;

  it('mintBoundIdToken + verifyEnrollmentGrantBinding round-trips on the happy path', async () => {
    const signer = await generateBrokerKeypair('ES256');
    const token = await mintBoundIdToken(
      { sub: SUB, enrollmentGrantId: GRANT_ID, delegationHash: DELEG_HASH, ...idArgs2 },
      signer,
    );
    const v = await verifyIdToken(token, { keys: [signer], expectedIss: idArgs2.iss, expectedAud: 'demo-org', now: () => NOW });
    expect(v.ok).toBe(true);
    const b = verifyEnrollmentGrantBinding(token, { enrollmentGrantId: GRANT_ID, delegationHash: DELEG_HASH });
    expect(b.ok).toBe(true);
  });

  it('rejects when expected grant-id differs from token (SEC-001 replay vector)', async () => {
    const signer = await generateBrokerKeypair('ES256');
    const token = await mintBoundIdToken(
      { sub: SUB, enrollmentGrantId: GRANT_ID, delegationHash: DELEG_HASH, ...idArgs2 },
      signer,
    );
    const b = verifyEnrollmentGrantBinding(token, { enrollmentGrantId: 'gr_OTHER', delegationHash: DELEG_HASH });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toBe('grant-id-mismatch');
  });

  it('rejects when delegation-hash differs (SEC-002 lateral-movement vector)', async () => {
    const signer = await generateBrokerKeypair('ES256');
    const token = await mintBoundIdToken(
      { sub: SUB, enrollmentGrantId: GRANT_ID, delegationHash: DELEG_HASH, ...idArgs2 },
      signer,
    );
    const b = verifyEnrollmentGrantBinding(token, {
      enrollmentGrantId: GRANT_ID,
      delegationHash: '0x1111111111111111111111111111111111111111111111111111111111111111' as `0x${string}`,
    });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toBe('delegation-hash-mismatch');
  });

  it('rejects an unbound id_token (mintIdToken — broker-internal) at verifyEnrollmentGrantBinding', async () => {
    const signer = await generateBrokerKeypair('ES256');
    const token = await mintIdToken({ sub: SUB, ...idArgs2 }, signer);
    const b = verifyEnrollmentGrantBinding(token, { enrollmentGrantId: GRANT_ID, delegationHash: DELEG_HASH });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toBe('missing-grant-id');
  });
});

describe('PKCE S256 (spec 230 §8.4)', () => {
  it('accepts a matching verifier, rejects a wrong one', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    // challenge = base64url(SHA-256(verifier))
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = Buffer.from(new Uint8Array(digest)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(await verifyPkceS256(verifier, challenge)).toBe(true);
    expect(await verifyPkceS256('not-the-verifier', challenge)).toBe(false);
  });
});
