// RW1-3 (ADR-0027) — cross-stack EIP-712 transition-typehash invariant.
//
// `AgreementRegistry.updateStatus` RECOMPUTES the digest the parties sign from
// (agreementCommitment, toStatus, nullifier) using its `TRANSITION_TYPEHASH`
// constant — it no longer trusts a caller-supplied `transitionStructHash`. The
// off-chain `transitionDigest()` MUST derive the byte-identical digest or a
// party signature minted off-chain would never verify on-chain (DoS) — or,
// worse, two sides could silently diverge. This test reads the LIVE Solidity
// source so a Solidity-side edit to the type string is caught here.
//
// Surfaced as a top-level gate via `check:eip712-typehash-equality`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { keccak256, stringToBytes, encodeAbiParameters } from 'viem';
import {
  TRANSITION_TYPEHASH,
  transitionDigest,
  STATUS,
  AGREEMENT_ISSUER_TYPEHASH,
  issuerAttestationDigest,
} from '../../src/index.js';

const AR_SOL = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../contracts/src/agreement/AgreementRegistry.sol',
);

/** Extract the keccak256("…") string literal for a named Solidity constant. */
function solTypeString(constant: string): string {
  const src = readFileSync(AR_SOL, 'utf8');
  const m = new RegExp(`${constant}\\s*=\\s*\\n?\\s*keccak256\\(\\s*"([^"]*)"`).exec(src);
  if (!m) throw new Error(`${constant} keccak256("...") not found in AgreementRegistry.sol`);
  return m[1];
}

const CANONICAL_TRANSITION_TYPE_STRING =
  'AgreementTransition(bytes32 agreementCommitment,uint8 toStatus,bytes32 nullifier,uint256 chainId,address verifyingContract)';

describe('RW1-3 — AgreementRegistry transition typehash convergence', () => {
  it('the LIVE Solidity TRANSITION_TYPEHASH type string is the canonical form', () => {
    expect(solTypeString('TRANSITION_TYPEHASH')).toBe(CANONICAL_TRANSITION_TYPE_STRING);
  });

  it('TS TRANSITION_TYPEHASH byte-matches keccak256 of the live Solidity type string', () => {
    const onChain = keccak256(stringToBytes(solTypeString('TRANSITION_TYPEHASH')));
    expect(TRANSITION_TYPEHASH).toBe(onChain);
  });

  it('locks the converged typehash byte value (regression-guard, both sides)', () => {
    expect(TRANSITION_TYPEHASH).toBe(keccak256(stringToBytes(CANONICAL_TRANSITION_TYPE_STRING)));
  });
});

const CANONICAL_ISSUER_TYPE_STRING =
  'AgreementIssuerAttestation(bytes32 agreementCommitment,bytes32 schemaHash,address issuer,uint256 chainId,address verifyingContract)';

describe('SC-1 — AgreementRegistry issuer-attestation typehash convergence', () => {
  it('the LIVE Solidity AGREEMENT_ISSUER_TYPEHASH type string is the canonical form', () => {
    expect(solTypeString('AGREEMENT_ISSUER_TYPEHASH')).toBe(CANONICAL_ISSUER_TYPE_STRING);
  });

  it('TS AGREEMENT_ISSUER_TYPEHASH byte-matches keccak256 of the live Solidity type string', () => {
    expect(AGREEMENT_ISSUER_TYPEHASH).toBe(keccak256(stringToBytes(solTypeString('AGREEMENT_ISSUER_TYPEHASH'))));
  });

  it('issuerAttestationDigest byte-matches keccak256(abi.encode(TYPEHASH, commitment, schemaHash, issuer, chainId, verifyingContract))', () => {
    const agreementCommitment = `0x${'ab'.repeat(32)}` as const;
    const schemaHash = `0x${'ef'.repeat(32)}` as const;
    const issuer = '0x1111111111111111111111111111111111111111' as const;
    const verifyingContract = '0x2222222222222222222222222222222222222222' as const;
    const chainId = 84532n;
    const expected = keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }],
        [AGREEMENT_ISSUER_TYPEHASH, agreementCommitment, schemaHash, issuer, chainId, verifyingContract],
      ),
    );
    expect(issuerAttestationDigest({ agreementCommitment, schemaHash, issuer, chainId, verifyingContract })).toBe(expected);
  });
});

describe('RW1-3 / AGR-1 — transitionDigest byte-matches the contract recompute', () => {
  const verifyingContract = '0x3333333333333333333333333333333333333333' as const;
  const chainId = 84532n;

  it('equals keccak256(abi.encode(TYPEHASH, commitment, uint8 toStatus, nullifier, chainId, verifyingContract))', () => {
    const agreementCommitment = `0x${'ab'.repeat(32)}` as const;
    const nullifier = `0x${'cd'.repeat(32)}` as const;
    const toStatus = STATUS.COMPLETED; // 2

    const expected = keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint8' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
        [TRANSITION_TYPEHASH, agreementCommitment, toStatus, nullifier, chainId, verifyingContract],
      ),
    );
    expect(transitionDigest({ agreementCommitment, toStatus, nullifier, chainId, verifyingContract })).toBe(expected);
  });

  it('AGR-1: is sensitive to chainId + verifyingContract (anti cross-chain/contract replay)', () => {
    const agreementCommitment = `0x${'ab'.repeat(32)}` as const;
    const nullifier = `0x${'cd'.repeat(32)}` as const;
    const toStatus = STATUS.COMPLETED;
    const base = transitionDigest({ agreementCommitment, toStatus, nullifier, chainId, verifyingContract });
    const otherChain = transitionDigest({ agreementCommitment, toStatus, nullifier, chainId: 1n, verifyingContract });
    const otherContract = transitionDigest({ agreementCommitment, toStatus, nullifier, chainId, verifyingContract: '0x4444444444444444444444444444444444444444' });
    expect(base).not.toBe(otherChain);
    expect(base).not.toBe(otherContract);
  });

  it('is sensitive to toStatus (no padding bleed)', () => {
    const agreementCommitment = `0x${'11'.repeat(32)}` as const;
    const nullifier = `0x${'22'.repeat(32)}` as const;
    const a = transitionDigest({ agreementCommitment, toStatus: STATUS.COMPLETED, nullifier, chainId, verifyingContract });
    const b = transitionDigest({ agreementCommitment, toStatus: STATUS.REVOKED, nullifier, chainId, verifyingContract });
    expect(a).not.toBe(b);
  });
});
