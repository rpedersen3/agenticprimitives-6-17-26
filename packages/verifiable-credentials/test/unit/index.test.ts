import { describe, expect, it } from 'vitest';
import {
  PACKAGE_NAME,
  PACKAGE_STATUS,
  SPEC_REF,
  jcsCanonicalize,
  canonicalHash,
  buildSituation,
  assertSituationRolesPresent,
  credentialHash,
  eip712Digest,
  buildShapeUri,
  parseShapeUri,
  shapeHash,
  VC_CONTEXT_V2,
  VC_DOMAIN_NAME,
  VC_DOMAIN_VERSION,
  VC_EIP712_TYPES,
  verifyCredentialStructural,
  type UnsignedCredential,
  type VerifiableCredential,
} from '../../src/index.js';

describe('package identity', () => {
  it('exposes the spec ref + W1 status', () => {
    expect(PACKAGE_NAME).toBe('@agenticprimitives/verifiable-credentials');
    expect(PACKAGE_STATUS).toBe('w1-foundational');
    expect(SPEC_REF).toContain('242-');
  });
});

describe('JCS canonicalisation (RFC 8785)', () => {
  it('sorts object keys by UTF-16 code unit', () => {
    expect(jcsCanonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(jcsCanonicalize({ Z: 1, A: 2, a: 3 })).toBe('{"A":2,"Z":1,"a":3}');
  });

  it('emits booleans + nulls lowercase', () => {
    expect(jcsCanonicalize(true)).toBe('true');
    expect(jcsCanonicalize(false)).toBe('false');
    expect(jcsCanonicalize(null)).toBe('null');
  });

  it('serialises arrays deterministically (order preserved)', () => {
    expect(jcsCanonicalize([3, 2, 1])).toBe('[3,2,1]');
  });

  it('escapes control characters per RFC 8785', () => {
    expect(jcsCanonicalize('\b\t\n\f\r')).toBe('"\\b\\t\\n\\f\\r"');
    expect(jcsCanonicalize('')).toBe('"\\u0001"');
    expect(jcsCanonicalize('quote " backslash \\')).toBe('"quote \\" backslash \\\\"');
  });

  it('rejects undefined', () => {
    expect(() => jcsCanonicalize(undefined)).toThrow(/JCS/);
  });

  it('produces stable hash for shuffled-key objects', () => {
    const a = { z: { b: 2, a: 1 }, a: [1, 2, 3] };
    const b = { a: [1, 2, 3], z: { a: 1, b: 2 } };
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });
});

describe('Situation pattern', () => {
  it('builds + asserts required roles', () => {
    const s = buildSituation({
      description: 'apatt:AssociationCredential',
      roles: {
        issuer: '0x1111111111111111111111111111111111111111',
        holder: '0x2222222222222222222222222222222222222222',
      },
      body: { membershipClass: 'member' },
    });
    expect(s.description).toBe('apatt:AssociationCredential');
    expect(s.roles.issuer).toBe('0x1111111111111111111111111111111111111111');
    expect(() => assertSituationRolesPresent(s, ['issuer', 'holder'])).not.toThrow();
  });

  it('rejects situations missing required roles', () => {
    const s = buildSituation({
      description: 'apatt:OutcomeCredential',
      roles: { holder: '0x2222222222222222222222222222222222222222' },
      body: {},
    });
    expect(() => assertSituationRolesPresent(s, ['issuer', 'holder'])).toThrow(/issuer/);
  });
});

describe('credentialHash', () => {
  it('is order-insensitive over JSON keys', () => {
    const vc1: UnsignedCredential = {
      '@context': [VC_CONTEXT_V2],
      type: ['VerifiableCredential', 'AssociationCredential'],
      issuer: 'eip155:8453:0x1111111111111111111111111111111111111111',
      validFrom: '2026-06-02T00:00:00Z',
      credentialSubject: { id: '0xholder', membershipClass: 'member' } as Record<string, unknown>,
    };
    const vc2: UnsignedCredential = {
      ...vc1,
      credentialSubject: { membershipClass: 'member', id: '0xholder' } as Record<string, unknown>,
    };
    expect(credentialHash(vc1)).toBe(credentialHash(vc2));
  });

  it('changes when subject changes', () => {
    const base: UnsignedCredential = {
      '@context': [VC_CONTEXT_V2],
      type: ['VerifiableCredential', 'AssociationCredential'],
      issuer: 'eip155:8453:0xabc',
      validFrom: '2026-06-02T00:00:00Z',
      credentialSubject: { id: '0xa', class: 'x' },
    };
    const tweaked: UnsignedCredential = {
      ...base,
      credentialSubject: { id: '0xa', class: 'y' },
    };
    expect(credentialHash(base)).not.toBe(credentialHash(tweaked));
  });
});

describe('eip712Digest', () => {
  it('is deterministic for fixed inputs', () => {
    const args = {
      credentialBodyHash: ('0x' + 'aa'.repeat(32)) as `0x${string}`,
      issuer: 'eip155:8453:0x1111111111111111111111111111111111111111',
      validFrom: 1700000000,
      validUntil: 0,
      proofPurpose: 'assertionMethod' as const,
      chainId: 8453,
      verifyingContract: '0x2222222222222222222222222222222222222222' as `0x${string}`,
    };
    const d1 = eip712Digest(args);
    const d2 = eip712Digest(args);
    expect(d1).toBe(d2);
    expect(d1).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('changes when proofPurpose changes (cross-stack typehash regression)', () => {
    const base = {
      credentialBodyHash: ('0x' + 'bb'.repeat(32)) as `0x${string}`,
      issuer: 'eip155:8453:0x1111111111111111111111111111111111111111',
      validFrom: 1700000000,
      validUntil: 0,
      chainId: 8453,
      verifyingContract: '0x2222222222222222222222222222222222222222' as `0x${string}`,
    };
    const a = eip712Digest({ ...base, proofPurpose: 'assertionMethod' });
    const b = eip712Digest({ ...base, proofPurpose: 'authentication' });
    expect(a).not.toBe(b);
  });

  it('uses the substrate domain', () => {
    expect(VC_DOMAIN_NAME).toBe('AgenticPrimitivesVC');
    expect(VC_DOMAIN_VERSION).toBe('1');
    expect(VC_EIP712_TYPES.VerifiableCredentialAttestation).toHaveLength(5);
  });
});

describe('schema registration (PD-12 round-trip)', () => {
  it('builds + parses did:shape URIs', () => {
    const uri = buildShapeUri('AgreementCredential', 'v1');
    expect(uri).toBe('did:shape:AgreementCredential:v1');
    expect(parseShapeUri(uri)).toEqual({ name: 'AgreementCredential', version: 'v1' });
  });

  it('rejects invalid characters', () => {
    expect(() => buildShapeUri('bad name', 'v1')).toThrow();
    expect(() => buildShapeUri('Good', 'v 1')).toThrow();
  });

  it('shapeHash is keccak256 of the SHACL bytes', () => {
    const a = shapeHash('@prefix ex: <http://example.org/> .');
    const b = shapeHash('@prefix ex: <http://example.org/> .');
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    const different = shapeHash('@prefix ex: <http://example.org/other> .');
    expect(a).not.toBe(different);
  });
});

describe('verifyCredentialStructural', () => {
  it('rejects a VC missing a proof', () => {
    const vc = {
      '@context': [VC_CONTEXT_V2],
      type: ['VerifiableCredential', 'AssociationCredential'] as const,
      issuer: 'eip155:8453:0xabc',
      validFrom: '2026-06-02T00:00:00Z',
      credentialSubject: { id: '0xholder' },
    } satisfies UnsignedCredential;
    const result = verifyCredentialStructural(vc as unknown as VerifiableCredential);
    expect(result.structural).toBe(false);
    expect(result.issues).toContain('missing proof');
  });

  it('returns the expected digest for a well-formed proof', () => {
    const verifyingContract = '0x2222222222222222222222222222222222222222' as const;
    const vc: VerifiableCredential = {
      '@context': [VC_CONTEXT_V2],
      type: ['VerifiableCredential', 'AssociationCredential'],
      issuer: 'eip155:8453:0x1111111111111111111111111111111111111111',
      validFrom: '2026-06-02T00:00:00Z',
      credentialSubject: { id: '0xholder', membershipClass: 'member' },
      proof: {
        type: 'Eip712Signature2026',
        created: '2026-06-02T00:00:00Z',
        verificationMethod: `eip155:8453:${verifyingContract}#assertion-key-1`,
        proofPurpose: 'assertionMethod',
        proofValue: '0xdeadbeef',
        eip712Domain: {
          name: VC_DOMAIN_NAME,
          version: VC_DOMAIN_VERSION,
          chainId: 8453,
          verifyingContract,
        },
      },
    };
    const r = verifyCredentialStructural(vc);
    expect(r.structural).toBe(true);
    expect(r.expectedDigest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(r.proofValue).toBe('0xdeadbeef');
    expect(r.issuerCaip10).toBe(`eip155:8453:${verifyingContract}`);
    expect(r.issues).toEqual([]);
  });

  it('flags a credentialHash mismatch (tampered body)', () => {
    const verifyingContract = '0x2222222222222222222222222222222222222222' as const;
    const vc: VerifiableCredential = {
      '@context': [VC_CONTEXT_V2],
      type: ['VerifiableCredential', 'AssociationCredential'],
      issuer: 'eip155:8453:0xabc',
      validFrom: '2026-06-02T00:00:00Z',
      credentialSubject: { id: '0xholder', wasTampered: true },
      proof: {
        type: 'Eip712Signature2026',
        created: '2026-06-02T00:00:00Z',
        verificationMethod: `eip155:8453:${verifyingContract}#assertion-key-1`,
        proofPurpose: 'assertionMethod',
        proofValue: '0xdeadbeef',
        eip712Domain: {
          name: VC_DOMAIN_NAME,
          version: VC_DOMAIN_VERSION,
          chainId: 8453,
          verifyingContract,
        },
        // Wrong stored hash — verifier should detect drift
        credentialHash: '0x' + '0'.repeat(64) as `0x${string}`,
      },
    };
    const r = verifyCredentialStructural(vc);
    expect(r.structural).toBe(false);
    expect(r.issues.join(' ')).toMatch(/credentialHash/);
  });
});
