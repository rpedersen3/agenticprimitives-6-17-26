// spec 277 §14 — DecryptGrant + KAS verification.
import { describe, it, expect } from 'vitest';
import {
  createDecryptGrant,
  verifyDecryptGrant,
  createInMemoryReplayStore,
  createLocalDevKeyAuthorizationService,
  type DecryptGrantV1,
  type DecryptGrantExpectation,
} from '../../src/index.js';

const ISSUER = 'eip155:8453:0xOWNER';
const PRINCIPAL = 'eip155:8453:0xOWNER';
const AUD = 'urn:mcp:server:person';
const NOW = new Date('2026-06-17T00:00:00Z');

async function grant(over: Partial<DecryptGrantV1['vault']> = {}, ttlExpired = false): Promise<DecryptGrantV1> {
  return createDecryptGrant({
    id: 'urn:ap:decrypt-grant:t1',
    issuer: ISSUER,
    audience: AUD,
    principal: PRINCIPAL,
    mcp: { resourceUri: 'urn:mcp:server:person', serverId: 'person', toolName: 'get_pii', argsHash: 'sha256:args' },
    authorization: { delegationHash: 'sha256:del', policyHash: 'sha256:pol', entitlementHashes: ['sha256:ent'] },
    vault: { vaultId: 'v', objectIds: ['o1'], resource: 'person-pii', fields: ['email', 'phone'], purpose: 'support', classificationCeiling: 'pii.sensitive', ...over },
    constraints: {
      ttlSeconds: 120,
      notBefore: '2026-06-17T00:00:00Z',
      expiresAt: ttlExpired ? '2026-06-16T00:00:00Z' : '2026-06-17T01:00:00Z',
      oneTimeUse: true,
    },
    replay: { jti: 'jti-1' },
  });
}

const expect0 = (over: Partial<DecryptGrantExpectation> = {}): DecryptGrantExpectation => ({
  audience: AUD,
  principal: PRINCIPAL,
  toolName: 'get_pii',
  argsHash: 'sha256:args',
  resource: 'person-pii',
  requestedFields: ['email'],
  purpose: 'support',
  classification: 'pii.sensitive',
  ...over,
});

describe('verifyDecryptGrant', () => {
  it('allows a well-formed grant and scopes releasedFields to requested', async () => {
    const g = await grant();
    const d = await verifyDecryptGrant(g, expect0(), { now: NOW, replayStore: createInMemoryReplayStore() });
    expect(d.decision).toBe('allow');
    expect(d.releasedFields).toEqual(['email']);
  });

  it('one-time JTI: second authorize is jti_replay; denied grant does NOT burn the JTI', async () => {
    const store = createInMemoryReplayStore();
    const g = await grant();
    // First a DENY (wrong tool) — must not consume the JTI.
    expect((await verifyDecryptGrant(g, expect0({ toolName: 'other' }), { now: NOW, replayStore: store })).reason).toBe('tool_mismatch');
    // Now a valid use succeeds (JTI still available).
    expect((await verifyDecryptGrant(g, expect0(), { now: NOW, replayStore: store })).decision).toBe('allow');
    // Replay denied.
    expect((await verifyDecryptGrant(g, expect0(), { now: NOW, replayStore: store })).reason).toBe('jti_replay');
  });

  it('grantHash integrity: a mutated body is rejected', async () => {
    const g = await grant();
    const tampered = { ...g, vault: { ...g.vault, fields: ['email', 'phone', 'ssn_last4'] } };
    expect((await verifyDecryptGrant(tampered, expect0(), { now: NOW, replayStore: createInMemoryReplayStore() })).reason).toBe('grant_hash_mismatch');
  });

  it('field subset / purpose / classification / scope denials', async () => {
    const store = () => createInMemoryReplayStore();
    expect((await verifyDecryptGrant(await grant(), expect0({ requestedFields: ['ssn_last4'] }), { now: NOW, replayStore: store() })).reason).toBe('field_not_allowed');
    expect((await verifyDecryptGrant(await grant(), expect0({ purpose: 'marketing' }), { now: NOW, replayStore: store() })).reason).toBe('purpose_not_allowed');
    expect((await verifyDecryptGrant(await grant(), expect0({ classification: 'secret.high' }), { now: NOW, replayStore: store() })).reason).toBe('classification_exceeded');
    expect((await verifyDecryptGrant(await grant(), expect0({ audience: 'urn:other' }), { now: NOW, replayStore: store() })).reason).toBe('audience_mismatch');
    expect((await verifyDecryptGrant(await grant(), expect0({ argsHash: 'sha256:different' }), { now: NOW, replayStore: store() })).reason).toBe('args_hash_mismatch');
  });

  it('validity window + auth-hash binding', async () => {
    expect((await verifyDecryptGrant(await grant({}, true), expect0(), { now: NOW, replayStore: createInMemoryReplayStore() })).reason).toBe('expired');
    expect((await verifyDecryptGrant(await grant(), expect0({ delegationHash: 'sha256:WRONG' }), { now: NOW, replayStore: createInMemoryReplayStore() })).reason).toBe('delegation_hash_mismatch');
  });

  it('signature verifier is honored when provided', async () => {
    const g = await grant();
    const d = await verifyDecryptGrant(g, expect0(), { now: NOW, replayStore: createInMemoryReplayStore(), verifySignature: async () => false });
    expect(d.reason).toBe('signature_invalid');
  });

  it('LocalDevKeyAuthorizationService composes verification', async () => {
    const kas = createLocalDevKeyAuthorizationService();
    const d = await kas.authorize(await grant(), expect0(), NOW);
    expect(d.decision).toBe('allow');
  });
});
