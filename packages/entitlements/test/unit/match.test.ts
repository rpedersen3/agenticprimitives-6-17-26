// spec 277 §10 — entitlement matching engine.
import { describe, it, expect } from 'vitest';
import {
  matchesEntitlement,
  resolveEntitlements,
  InMemoryEntitlementResolver,
  type AgenticEntitlementCredentialV1,
  type EntitlementQuery,
} from '../../src/index.js';

const ACTOR = 'eip155:8453:0xSESSION';
const OWNER = 'eip155:8453:0xOWNER';
const AUD = 'urn:mcp:server:person';

function cred(over: Partial<AgenticEntitlementCredentialV1['credentialSubject']> & { validFrom?: string; validUntil?: string; id?: string } = {}): AgenticEntitlementCredentialV1 {
  const { validFrom, validUntil, id, ...subject } = over;
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential', 'AgenticEntitlementCredentialV1'],
    id: (id ?? 'urn:ap:entitlement:test-1') as `urn:ap:entitlement:${string}`,
    issuer: OWNER,
    validFrom: validFrom ?? '2020-01-01T00:00:00Z',
    validUntil,
    credentialSubject: {
      id: ACTOR,
      principal: OWNER,
      audience: AUD,
      resource: 'person-pii',
      actions: ['read'],
      ...subject,
    },
  };
}

const baseQuery = (over: Partial<EntitlementQuery> = {}): EntitlementQuery => ({
  actor: ACTOR,
  principal: OWNER,
  audience: AUD,
  resource: 'person-pii',
  action: 'read',
  at: new Date('2026-06-17T00:00:00Z'),
  ...over,
});

describe('matchesEntitlement', () => {
  it('matches an unscoped (all-fields) read grant', () => {
    const m = matchesEntitlement(cred(), baseQuery({ fields: ['email'] }));
    expect(m.ok).toBe(true);
    expect(m.allowedFields).toEqual(['email']); // requested passthrough
  });

  it('field-scoped grant: allows subset, denies out-of-scope field', () => {
    const c = cred({ fields: ['email', 'phone'] });
    expect(matchesEntitlement(c, baseQuery({ fields: ['email'] })).ok).toBe(true);
    const denied = matchesEntitlement(c, baseQuery({ fields: ['email', 'ssn_last4'] }));
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('field_not_allowed');
  });

  it('field-scoped grant with no requested fields exposes only granted fields', () => {
    const m = matchesEntitlement(cred({ fields: ['email', 'phone'] }), baseQuery());
    expect(m.allowedFields).toEqual(['email', 'phone']);
  });

  it('purpose pinning', () => {
    const c = cred({ purpose: 'support-ticket' });
    expect(matchesEntitlement(c, baseQuery({ purpose: 'support-ticket' })).ok).toBe(true);
    expect(matchesEntitlement(c, baseQuery({ purpose: 'marketing' })).reason).toBe('purpose_not_allowed');
    expect(matchesEntitlement(c, baseQuery()).reason).toBe('purpose_not_allowed'); // absent purpose
  });

  it('classification ceiling', () => {
    const c = cred({ classificationCeiling: 'pii.low' });
    expect(matchesEntitlement(c, baseQuery({ classification: 'pii.low' })).ok).toBe(true);
    expect(matchesEntitlement(c, baseQuery({ classification: 'pii.sensitive' })).reason).toBe('classification_exceeded');
  });

  it('validity window', () => {
    expect(matchesEntitlement(cred({ validFrom: '2027-01-01T00:00:00Z' }), baseQuery()).reason).toBe('expired');
    expect(matchesEntitlement(cred({ validUntil: '2021-01-01T00:00:00Z' }), baseQuery()).reason).toBe('expired');
  });

  it('scope mismatches', () => {
    expect(matchesEntitlement(cred(), baseQuery({ actor: 'eip155:8453:0xOTHER' })).reason).toBe('not_found');
    expect(matchesEntitlement(cred(), baseQuery({ audience: 'urn:other' })).reason).toBe('audience_mismatch');
    expect(matchesEntitlement(cred(), baseQuery({ resource: 'org-sensitive' })).reason).toBe('resource_mismatch');
    expect(matchesEntitlement(cred(), baseQuery({ action: 'write' })).reason).toBe('action_not_allowed');
    expect(matchesEntitlement(cred(), baseQuery({ principal: 'eip155:8453:0xOTHER' })).reason).toBe('principal_mismatch');
  });
});

describe('resolveEntitlements / InMemoryEntitlementResolver', () => {
  it('allows when any credential matches; unions allowedFields', async () => {
    const r = new InMemoryEntitlementResolver([
      cred({ id: 'urn:ap:entitlement:a', fields: ['email'] }),
      cred({ id: 'urn:ap:entitlement:b', fields: ['phone'] }),
    ]);
    const d = await r.resolve(baseQuery());
    expect(d.decision).toBe('allow');
    expect(new Set(d.allowedFields)).toEqual(new Set(['email', 'phone']));
    expect(d.matchedCredentials.sort()).toEqual(['urn:ap:entitlement:a', 'urn:ap:entitlement:b']);
  });

  it('denies with the most specific reason (precedence over not_found)', async () => {
    const d = await resolveEntitlements([cred({ fields: ['email'] })], baseQuery({ fields: ['ssn_last4'] }));
    expect(d.decision).toBe('deny');
    expect(d.reason).toBe('field_not_allowed');
  });

  it('empty credential set → deny not_found', async () => {
    const d = await resolveEntitlements([], baseQuery());
    expect(d).toEqual({ decision: 'deny', reason: 'not_found', matchedCredentials: [] });
  });

  it('merges constraints from matching credentials', async () => {
    const d = await resolveEntitlements(
      [cred({ constraints: { noPersist: true } }), cred({ id: 'urn:ap:entitlement:c', constraints: { redactByDefault: true } })],
      baseQuery(),
    );
    expect(d.constraints).toEqual({ noPersist: true, redactByDefault: true });
  });
});
