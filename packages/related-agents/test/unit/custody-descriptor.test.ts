import { describe, expect, it } from 'vitest';
import {
  buildCustodyDescriptor,
  buildRelatedAgentCredential,
  type CustodyDescriptor,
} from '../../src/index.js';

const ORG = '0x2222222222222222222222222222222222222222' as const;
const PERSON = '0x1111111111111111111111111111111111111111' as const;
const SALT = `0x${'ab'.repeat(32)}` as const; // bytes32
const EOA = '0x9999999999999999999999999999999999999999' as const;

describe('buildCustodyDescriptor (spec 271 / ADR-0035)', () => {
  it('canonicalizes a kms-subject descriptor', () => {
    const d = buildCustodyDescriptor({ targetSA: ORG, salt: SALT, custody: { kind: 'kms-subject', rotation: 0 } });
    expect(d).toEqual({ targetSA: ORG, salt: SALT, custody: { kind: 'kms-subject', rotation: 0 } });
  });

  it('RC-INV-3: drops any smuggled owner identifier from kms-subject (no iss/sub survives)', () => {
    const dirty = { targetSA: ORG, salt: SALT, custody: { kind: 'kms-subject', rotation: 2, iss: 'https://accounts.google.com', sub: '12345' } } as unknown as CustodyDescriptor;
    const d = buildCustodyDescriptor(dirty);
    expect(d.custody).toEqual({ kind: 'kms-subject', rotation: 2 });
    expect(JSON.stringify(d)).not.toContain('google');
    expect(JSON.stringify(d)).not.toContain('12345');
  });

  it('accepts passkey + eoa custody kinds', () => {
    expect(buildCustodyDescriptor({ targetSA: ORG, salt: SALT, custody: { kind: 'passkey', credentialId: 'cred-1' } }).custody).toEqual({ kind: 'passkey', credentialId: 'cred-1' });
    expect(buildCustodyDescriptor({ targetSA: ORG, salt: SALT, custody: { kind: 'eoa', address: EOA } }).custody).toEqual({ kind: 'eoa', address: EOA });
  });

  it('fail-closed: rejects bad targetSA, non-bytes32 salt, negative rotation, missing credentialId, bad eoa, unknown kind', () => {
    expect(() => buildCustodyDescriptor({ targetSA: '0xnope' as never, salt: SALT, custody: { kind: 'kms-subject', rotation: 0 } })).toThrow(/targetSA/);
    expect(() => buildCustodyDescriptor({ targetSA: ORG, salt: '0x1234' as never, custody: { kind: 'kms-subject', rotation: 0 } })).toThrow(/bytes32/);
    expect(() => buildCustodyDescriptor({ targetSA: ORG, salt: SALT, custody: { kind: 'kms-subject', rotation: -1 } })).toThrow(/rotation/);
    expect(() => buildCustodyDescriptor({ targetSA: ORG, salt: SALT, custody: { kind: 'passkey', credentialId: '' } })).toThrow(/credentialId/);
    expect(() => buildCustodyDescriptor({ targetSA: ORG, salt: SALT, custody: { kind: 'eoa', address: '0xbad' as never } })).toThrow(/eoa/);
    expect(() => buildCustodyDescriptor({ targetSA: ORG, salt: SALT, custody: { kind: 'sms' } as never })).toThrow(/unknown custody kind/);
  });

  it('rides in a RelatedAgentBody as a private facet of the related-agent credential', () => {
    const custody = buildCustodyDescriptor({ targetSA: ORG, salt: SALT, custody: { kind: 'kms-subject', rotation: 0 } });
    const cred = buildRelatedAgentCredential({
      holder: PERSON, relatedAgent: ORG, purpose: 'jp-adopter-org', requestedBy: 'demo-jp',
      issuerCaip10: `eip155:84532:${PERSON}`, body: { agentName: 'grace-community.impact', custody },
      validFrom: '2026-06-10T00:00:00Z',
    });
    expect(cred.credentialSubject.participants?.visibility).toBe('private'); // descriptor inherits privacy
    expect((cred.credentialSubject.body.payload as { custody?: CustodyDescriptor }).custody).toEqual(custody);
  });
});
