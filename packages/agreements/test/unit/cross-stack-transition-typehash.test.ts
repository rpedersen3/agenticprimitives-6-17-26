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
import { TRANSITION_TYPEHASH, transitionDigest, STATUS } from '../../src/index.js';

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
  'AgreementTransition(bytes32 agreementCommitment,uint8 toStatus,bytes32 nullifier)';

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

describe('RW1-3 — transitionDigest byte-matches the contract recompute', () => {
  it('equals keccak256(abi.encode(TYPEHASH, commitment, uint8 toStatus, nullifier))', () => {
    const agreementCommitment = `0x${'ab'.repeat(32)}` as const;
    const nullifier = `0x${'cd'.repeat(32)}` as const;
    const toStatus = STATUS.COMPLETED; // 2

    const expected = keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint8' }, { type: 'bytes32' }],
        [TRANSITION_TYPEHASH, agreementCommitment, toStatus, nullifier],
      ),
    );
    expect(transitionDigest({ agreementCommitment, toStatus, nullifier })).toBe(expected);
  });

  it('is sensitive to toStatus (no padding bleed)', () => {
    const agreementCommitment = `0x${'11'.repeat(32)}` as const;
    const nullifier = `0x${'22'.repeat(32)}` as const;
    const a = transitionDigest({ agreementCommitment, toStatus: STATUS.COMPLETED, nullifier });
    const b = transitionDigest({ agreementCommitment, toStatus: STATUS.REVOKED, nullifier });
    expect(a).not.toBe(b);
  });
});
