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
import { JOINT_CONSENT_TYPEHASH, jointConsentDigest } from '../../src/index.js';

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
