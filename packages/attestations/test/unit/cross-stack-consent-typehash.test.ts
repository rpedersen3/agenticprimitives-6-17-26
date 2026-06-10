// RW1-1 (ADR-0027) — cross-stack EIP-712 joint-consent typehash invariant.
//
// `AttestationRegistry.assertJointAgreement` RECOMPUTES the consent digest each
// party signs from (party1, party2, agreementCommitment, credentialHash) using
// its `JOINT_CONSENT_TYPEHASH` constant, and verifies BOTH party signatures
// against it. The off-chain `jointConsentDigest()` MUST derive the byte-identical
// digest or a party's off-chain consent signature would never verify on-chain
// (DoS), or the two sides could silently diverge. This test reads the LIVE
// Solidity source so a Solidity-side edit to the type string is caught here.
//
// Surfaced as a top-level gate via `check:eip712-typehash-equality`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { keccak256, stringToBytes, encodeAbiParameters } from 'viem';
import {
  JOINT_CONSENT_TYPEHASH,
  jointConsentDigest,
  JOINT_ISSUER_TYPEHASH,
  jointIssuerDigest,
  ASSOCIATION_ATTESTATION_TYPEHASH,
  associationAttestationDigest,
} from '../../src/index.js';

const AR_SOL = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../contracts/src/attestation/AttestationRegistry.sol',
);

/** Extract the keccak256("…") string literal for a named Solidity constant. */
function solTypeString(constant: string): string {
  const src = readFileSync(AR_SOL, 'utf8');
  const m = new RegExp(`${constant}\\s*=\\s*keccak256\\(\\s*\\n?\\s*"([^"]*)"`).exec(src);
  if (!m) throw new Error(`${constant} keccak256("...") not found in AttestationRegistry.sol`);
  return m[1];
}

const CANONICAL_CONSENT_TYPE_STRING =
  'JointAgreementConsent(address party1,address party2,bytes32 agreementCommitment,bytes32 credentialHash)';

describe('RW1-1 — AttestationRegistry joint-consent typehash convergence', () => {
  it('the LIVE Solidity JOINT_CONSENT_TYPEHASH type string is the canonical form', () => {
    expect(solTypeString('JOINT_CONSENT_TYPEHASH')).toBe(CANONICAL_CONSENT_TYPE_STRING);
  });

  it('TS JOINT_CONSENT_TYPEHASH byte-matches keccak256 of the live Solidity type string', () => {
    const onChain = keccak256(stringToBytes(solTypeString('JOINT_CONSENT_TYPEHASH')));
    expect(JOINT_CONSENT_TYPEHASH).toBe(onChain);
  });

  it('locks the converged typehash byte value (regression-guard, both sides)', () => {
    expect(JOINT_CONSENT_TYPEHASH).toBe(keccak256(stringToBytes(CANONICAL_CONSENT_TYPE_STRING)));
  });
});

describe('RW1-1 — jointConsentDigest byte-matches the contract recompute', () => {
  it('equals keccak256(abi.encode(TYPEHASH, party1, party2, agreementCommitment, credentialHash))', () => {
    const party1 = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9' as const;
    const party2 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;
    const agreementCommitment = `0x${'ab'.repeat(32)}` as const;
    const credentialHash = `0x${'cd'.repeat(32)}` as const;

    const expected = keccak256(
      encodeAbiParameters(
        [
          { type: 'bytes32' },
          { type: 'address' },
          { type: 'address' },
          { type: 'bytes32' },
          { type: 'bytes32' },
        ],
        [JOINT_CONSENT_TYPEHASH, party1, party2, agreementCommitment, credentialHash],
      ),
    );
    expect(jointConsentDigest({ party1, party2, agreementCommitment, credentialHash })).toBe(expected);
  });

  it('is party-order sensitive (party1/party2 are not interchangeable)', () => {
    const a = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9' as const;
    const b = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;
    const agreementCommitment = `0x${'11'.repeat(32)}` as const;
    const credentialHash = `0x${'22'.repeat(32)}` as const;
    const ab = jointConsentDigest({ party1: a, party2: b, agreementCommitment, credentialHash });
    const ba = jointConsentDigest({ party1: b, party2: a, agreementCommitment, credentialHash });
    expect(ab).not.toBe(ba);
  });
});

const CANONICAL_JOINT_ISSUER_TYPE_STRING =
  'JointAgreementIssuerAttestation(address party1,address party2,address issuer,bytes32 schemaId,bytes32 credentialType,bytes32 credentialHash,bytes32 agreementCommitment,uint256 chainId,address verifyingContract)';

describe('ATT-1 — AttestationRegistry joint issuer-attestation typehash convergence', () => {
  it('the LIVE Solidity JOINT_ISSUER_TYPEHASH type string is the canonical form', () => {
    expect(solTypeString('JOINT_ISSUER_TYPEHASH')).toBe(CANONICAL_JOINT_ISSUER_TYPE_STRING);
  });

  it('TS JOINT_ISSUER_TYPEHASH byte-matches keccak256 of the live Solidity type string', () => {
    expect(JOINT_ISSUER_TYPEHASH).toBe(keccak256(stringToBytes(solTypeString('JOINT_ISSUER_TYPEHASH'))));
  });

  it('jointIssuerDigest byte-matches keccak256(abi.encode(TYPEHASH, party1, party2, issuer, schemaId, credentialType, credentialHash, agreementCommitment, chainId, verifyingContract))', () => {
    const party1 = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9' as const;
    const party2 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;
    const issuer = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as const;
    const verifyingContract = '0x2222222222222222222222222222222222222222' as const;
    const schemaId = `0x${'ab'.repeat(32)}` as const;
    const credentialType = `0x${'cd'.repeat(32)}` as const;
    const credentialHash = `0x${'ef'.repeat(32)}` as const;
    const agreementCommitment = `0x${'12'.repeat(32)}` as const;
    const chainId = 84532n;
    const expected = keccak256(
      encodeAbiParameters(
        [
          { type: 'bytes32' }, { type: 'address' }, { type: 'address' }, { type: 'address' },
          { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' },
          { type: 'uint256' }, { type: 'address' },
        ],
        [JOINT_ISSUER_TYPEHASH, party1, party2, issuer, schemaId, credentialType, credentialHash, agreementCommitment, chainId, verifyingContract],
      ),
    );
    expect(
      jointIssuerDigest({ party1, party2, issuer, schemaId, credentialType, credentialHash, agreementCommitment, chainId, verifyingContract }),
    ).toBe(expected);
  });

  it('ATT-1: is sensitive to chainId + verifyingContract (anti cross-chain/contract replay)', () => {
    const base = {
      party1: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9' as const,
      party2: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const,
      issuer: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as const,
      schemaId: `0x${'ab'.repeat(32)}` as const,
      credentialType: `0x${'cd'.repeat(32)}` as const,
      credentialHash: `0x${'ef'.repeat(32)}` as const,
      agreementCommitment: `0x${'12'.repeat(32)}` as const,
      chainId: 84532n,
      verifyingContract: '0x2222222222222222222222222222222222222222' as const,
    };
    const d = jointIssuerDigest(base);
    expect(jointIssuerDigest({ ...base, chainId: 1n })).not.toBe(d);
    expect(jointIssuerDigest({ ...base, verifyingContract: '0x4444444444444444444444444444444444444444' })).not.toBe(d);
  });
});

const CANONICAL_ASSOCIATION_TYPE_STRING =
  'AssociationAttestation(address subject,address issuer,bytes32 schemaId,bytes32 credentialType,bytes32 credentialHash,uint256 chainId,address verifyingContract)';

describe('SC-2 — AttestationRegistry association issuer-attestation typehash convergence', () => {
  it('the LIVE Solidity ASSOCIATION_ATTESTATION_TYPEHASH type string is the canonical form', () => {
    expect(solTypeString('ASSOCIATION_ATTESTATION_TYPEHASH')).toBe(CANONICAL_ASSOCIATION_TYPE_STRING);
  });

  it('TS ASSOCIATION_ATTESTATION_TYPEHASH byte-matches keccak256 of the live Solidity type string', () => {
    expect(ASSOCIATION_ATTESTATION_TYPEHASH).toBe(keccak256(stringToBytes(solTypeString('ASSOCIATION_ATTESTATION_TYPEHASH'))));
  });

  it('associationAttestationDigest byte-matches keccak256(abi.encode(TYPEHASH, subject, issuer, schemaId, credentialType, credentialHash, chainId, verifyingContract))', () => {
    const subject = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9' as const;
    const issuer = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;
    const verifyingContract = '0x2222222222222222222222222222222222222222' as const;
    const schemaId = `0x${'ab'.repeat(32)}` as const;
    const credentialType = `0x${'cd'.repeat(32)}` as const;
    const credentialHash = `0x${'ef'.repeat(32)}` as const;
    const chainId = 84532n;
    const expected = keccak256(
      encodeAbiParameters(
        [
          { type: 'bytes32' }, { type: 'address' }, { type: 'address' }, { type: 'bytes32' },
          { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' },
        ],
        [ASSOCIATION_ATTESTATION_TYPEHASH, subject, issuer, schemaId, credentialType, credentialHash, chainId, verifyingContract],
      ),
    );
    expect(associationAttestationDigest({ subject, issuer, schemaId, credentialType, credentialHash, chainId, verifyingContract })).toBe(expected);
  });
});
