import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { keccak256, stringToBytes, encodeAbiParameters } from 'viem';
import {
  GEO_KIND, GEO_KIND_URI, GEO_RELATION,
  buildSelfGeoClaim, buildEndorsedGeoClaim, geoClaimId, geoEndorsementDigest,
  GEO_ENDORSEMENT_TYPEHASH, type Hex32,
} from '../../src/index.js';

const SOL = join(dirname(fileURLToPath(import.meta.url)), '../../../contracts/src/geo/GeoFeatureRegistry.sol');
const subject = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9' as const;
const issuer = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;
const featureId = `0x${'ab'.repeat(32)}` as Hex32;
const nonce = `0x${'cd'.repeat(32)}` as Hex32;

describe('geo-features — lockstep with GeoFeatureRegistry', () => {
  it('GEO_KIND values equal keccak of the live contract KIND_* URIs', () => {
    const src = readFileSync(SOL, 'utf8');
    const solUri = (name: string) => new RegExp(`${name}\\s*=\\s*keccak256\\(bytes\\("([^"]+)"\\)\\)`).exec(src)![1]!;
    expect(GEO_KIND_URI.Region).toBe(solUri('KIND_REGION'));
    expect(GEO_KIND_URI.Country).toBe(solUri('KIND_COUNTRY'));
    expect(GEO_KIND_URI.AdminArea).toBe(solUri('KIND_ADMIN'));
    expect(GEO_KIND.Region).toBe(keccak256(stringToBytes(solUri('KIND_REGION'))));
    expect(GEO_KIND.Planet).toBe(keccak256(stringToBytes(solUri('KIND_PLANET'))));
  });
});

describe('geo-features — claim builders + digest math', () => {
  it('buildSelfGeoClaim builds a self VC; buildEndorsedGeoClaim requires cross-issue', () => {
    const c = buildSelfGeoClaim({ chainId: 84532, subject, feature: { featureId, version: 1 }, relation: GEO_RELATION.servesWithin, nonce });
    expect(c.issuer).toBe(`eip155:84532:${subject}`);
    expect(c.credentialSubject.claimId).toBe(geoClaimId({ subject, featureId, relation: GEO_RELATION.servesWithin, nonce }));
    expect(() => buildEndorsedGeoClaim({ chainId: 84532, subject, issuer: subject, feature: { featureId, version: 1 }, relation: GEO_RELATION.operatesIn, nonce })).toThrow();
  });

  it('buildEndorsedGeoClaim returns a cross-issued VC + endorsement digest', () => {
    const { credential, endorsementDigest } = buildEndorsedGeoClaim({ chainId: 84532, subject, issuer, feature: { featureId, version: 2 }, relation: GEO_RELATION.licensedIn, nonce });
    expect(credential.issuer).toBe(`eip155:84532:${issuer}`);
    expect(endorsementDigest).toBe(geoEndorsementDigest({ subject, featureId, featureVersion: 2, relation: GEO_RELATION.licensedIn, validAfter: 0, validUntil: 0, nonce }));
  });

  it('geoEndorsementDigest + geoClaimId match abi.encode', () => {
    const d = keccak256(encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'address' }, { type: 'bytes32' }, { type: 'uint64' }, { type: 'bytes32' }, { type: 'uint64' }, { type: 'uint64' }, { type: 'bytes32' }],
      [GEO_ENDORSEMENT_TYPEHASH, subject, featureId, 3n, GEO_RELATION.servesWithin, 0n, 0n, nonce],
    ));
    expect(geoEndorsementDigest({ subject, featureId, featureVersion: 3, relation: GEO_RELATION.servesWithin, validAfter: 0, validUntil: 0, nonce })).toBe(d);

    const id = keccak256(encodeAbiParameters(
      [{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }],
      [subject, featureId, GEO_RELATION.servesWithin, nonce],
    ));
    expect(geoClaimId({ subject, featureId, relation: GEO_RELATION.servesWithin, nonce })).toBe(id);
  });
});
