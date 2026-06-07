import { describe, it, expect } from 'vitest';
import type { Hex } from 'viem';
import {
  contentCommitment,
  verifyCommitment,
  canonicalizeRendering,
  descriptorHash,
  buildContentDescriptor,
  verifyContentDescriptor,
  NORMALIZATION_V1,
} from '../src/descriptor.js';
import { leafHash, buildCorpusTree, merkleProof } from '../src/merkle.js';
import type { BuildDescriptorInput, SignatureVerifier } from '../src/types.js';

const ISSUER = '0x2222222222222222222222222222222222222222' as const;
const fakeSign = (hash: Hex): Hex => hash;
const fakeVerify: SignatureVerifier = ({ hash, signature }) => hash === signature;

const baseInput = (overrides: Partial<BuildDescriptorInput> = {}): BuildDescriptorInput => ({
  id: 'desc_test',
  canonicalId: ('0x' + 'aa'.repeat(32)) as Hex,
  contentType: 'scripture.verse',
  issuer: { address: ISSUER, did: 'did:ap:issuer:test' },
  issuedAt: '2026-06-07T00:00:00Z',
  status: 'active',
  commitment: contentCommitment('In the beginning was the Word'),
  proofPolicy: 'issuer-signature-and-hash-v1',
  accessPolicy: 'public',
  retrievalPointer: 'content://scripture.verse/bsb/John.1.1',
  ...overrides,
});

describe('content commitment (canonical-text-v1, SHA-256)', () => {
  it('canonicalizes whitespace before hashing', () => {
    expect(canonicalizeRendering('  the   Word\n')).toBe('the Word');
    expect(contentCommitment('the Word').value).toBe(contentCommitment('  the   Word\n').value);
  });

  it('produces a structured, versioned commitment object', () => {
    const c = contentCommitment('For God so loved the world');
    expect(c.type).toBe('canonicalTextCommitment');
    expect(c.normalization).toBe(NORMALIZATION_V1);
    expect(c.algorithm).toBe('sha-256');
  });

  it('verifyCommitment round-trips and rejects tampering', () => {
    const c = contentCommitment('For God so loved the world');
    expect(verifyCommitment('For God so loved the world', c)).toBe(true);
    expect(verifyCommitment('different text', c)).toBe(false);
  });
});

describe('descriptorHash', () => {
  it('is stable regardless of key insertion order', () => {
    const a = baseInput();
    const reordered = JSON.parse(JSON.stringify({ ...a })) as BuildDescriptorInput;
    expect(descriptorHash(a)).toBe(descriptorHash(reordered));
  });
  it('changes when a field changes', () => {
    expect(descriptorHash(baseInput())).not.toBe(descriptorHash(baseInput({ retrievalPointer: 'x' })));
  });
});

describe('verifyContentDescriptor (fail-closed)', () => {
  const now = 1_900_000_000;

  it('accepts a valid active signed descriptor', async () => {
    const d = await buildContentDescriptor(baseInput(), fakeSign);
    const r = await verifyContentDescriptor(d, { verifySignature: fakeVerify, nowSeconds: now });
    expect(r.ok).toBe(true);
    expect(r.signatureVerified && r.statusOk && r.withinValidity).toBe(true);
  });

  it('rejects a revoked descriptor before checking anything else', async () => {
    const d = await buildContentDescriptor(baseInput({ status: 'revoked' }), fakeSign);
    const r = await verifyContentDescriptor(d, { verifySignature: fakeVerify, nowSeconds: now });
    expect(r.ok).toBe(false);
    expect(r.statusOk).toBe(false);
  });

  it('rejects a descriptor outside its validity window', async () => {
    const d = await buildContentDescriptor(baseInput({ validUntil: '2020-01-01T00:00:00Z' }), fakeSign);
    const r = await verifyContentDescriptor(d, { verifySignature: fakeVerify, nowSeconds: now });
    expect(r.ok).toBe(false);
    expect(r.withinValidity).toBe(false);
  });

  it('fails closed on a bad signature', async () => {
    const d = await buildContentDescriptor(baseInput(), () => ('0x' + 'de'.repeat(32)) as Hex);
    const r = await verifyContentDescriptor(d, { verifySignature: fakeVerify, nowSeconds: now });
    expect(r.ok).toBe(false);
    expect(r.signatureVerified).toBe(false);
  });

  it('verifies merkle-membership against a corpus root', async () => {
    const d = await buildContentDescriptor(baseInput({ proofPolicy: 'merkle-membership-v1' }), fakeSign);
    const other = contentCommitment('another verse');
    const tree = buildCorpusTree([leafHash(d.commitment!.value), leafHash(other.value)]);
    const r = await verifyContentDescriptor(d, {
      verifySignature: fakeVerify,
      corpusRoot: tree.root,
      inclusionProof: merkleProof(tree, 0),
      nowSeconds: now,
    });
    expect(r.ok).toBe(true);
    expect(r.inclusionVerified).toBe(true);
  });

  it('rejects merkle-membership without a proof', async () => {
    const d = await buildContentDescriptor(baseInput({ proofPolicy: 'merkle-membership-v1' }), fakeSign);
    const r = await verifyContentDescriptor(d, { verifySignature: fakeVerify, nowSeconds: now });
    expect(r.ok).toBe(false);
  });

  it('rejects reserved proof policies in Phase 1', async () => {
    const d = await buildContentDescriptor(baseInput({ proofPolicy: 'zk-membership-v1' }), fakeSign);
    const r = await verifyContentDescriptor(d, { verifySignature: fakeVerify, nowSeconds: now });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/reserved/);
  });
});
