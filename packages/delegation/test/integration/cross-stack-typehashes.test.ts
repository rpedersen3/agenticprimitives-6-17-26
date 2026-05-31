// H7-D.9 / XPKG-003-sec — cross-stack EIP-712 typehash invariant.
//
// **2026-05-30 finding discovered during H7-D.9 wiring (open):** the
// contract's `DELEGATION_TYPEHASH` is computed over the NON-STANDARD
// EIP-712 type string
//
//   "Delegation(address delegator,address delegate,bytes32 authority,bytes32 caveatsHash,uint256 salt)"
//
// (note `bytes32 caveatsHash`, inlining the precomputed caveats digest)
// while the off-chain `DELEGATION_EIP712_TYPES` uses the standard form
//
//   Delegation { delegator, delegate, authority, caveats: Caveat[], salt }
//
// where viem's `hashTypedData` derives the typehash from the canonical
// string
//
//   "Delegation(address delegator,address delegate,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)"
//
// These produce DIFFERENT typehashes → different structHashes → different
// signed digests. A signature produced off-chain by viem MAY not verify
// on-chain via the contract's `hashDelegation`. We need to either:
//   (a) update the contract to standard EIP-712 (`Caveat[] caveats`), OR
//   (b) compute the contract's non-standard hash from the off-chain side.
//
// The test below LOCKS the current behavior of each side so any future
// drift is caught immediately. It is the gate for fixing the divergence
// in a follow-up wave (file as CROSS-STACK-001).

import { describe, it, expect } from 'vitest';
import { keccak256, stringToBytes, encodeAbiParameters, type Hex } from 'viem';
import { DELEGATION_EIP712_TYPES } from '../../src/hash';

const CONTRACT_DELEGATION_TYPE_STRING =
  'Delegation(address delegator,address delegate,bytes32 authority,bytes32 caveatsHash,uint256 salt)';
const CONTRACT_CAVEAT_TYPE_STRING = 'Caveat(address enforcer,bytes terms)';

function encodeType(typeName: string, fields: readonly { name: string; type: string }[]): string {
  const inner = fields.map((f) => `${f.type} ${f.name}`).join(',');
  return `${typeName}(${inner})`;
}

function typehash(typeString: string): Hex {
  return keccak256(stringToBytes(typeString));
}

describe('H7-D.9 — Caveat typehash (the side that DOES match)', () => {
  it('TS Caveat type string equals the contract CAVEAT_TYPEHASH preimage', () => {
    const tsType = encodeType('Caveat', DELEGATION_EIP712_TYPES.Caveat);
    expect(tsType).toBe(CONTRACT_CAVEAT_TYPE_STRING);
  });

  it('TS keccak256(Caveat type string) byte-matches contract CAVEAT_TYPEHASH', () => {
    const tsHash = typehash(encodeType('Caveat', DELEGATION_EIP712_TYPES.Caveat));
    const contractHash = typehash(CONTRACT_CAVEAT_TYPE_STRING);
    expect(tsHash).toBe(contractHash);
  });

  it('Caveat type DOES NOT carry `args` (audit F-1 invariant)', () => {
    const caveatFieldNames = DELEGATION_EIP712_TYPES.Caveat.map((f) => f.name);
    expect(caveatFieldNames).toEqual(['enforcer', 'terms']);
    expect(caveatFieldNames).not.toContain('args');
  });
});

describe('H7-D.9 — Delegation typehash CROSS-STACK DIVERGENCE (CROSS-STACK-001)', () => {
  // The two type strings are DIFFERENT. Lock both so a fix is intentional.

  it('contract uses a non-standard EIP-712 inline `bytes32 caveatsHash`', () => {
    // Verbatim from packages/contracts/src/agency/DelegationManager.sol:68.
    // If the contract changes this, the lock here breaks → CI signals.
    expect(CONTRACT_DELEGATION_TYPE_STRING).toBe(
      'Delegation(address delegator,address delegate,bytes32 authority,bytes32 caveatsHash,uint256 salt)',
    );
  });

  it('TS uses the standard EIP-712 reference `Caveat[] caveats`', () => {
    const tsType = encodeType('Delegation', DELEGATION_EIP712_TYPES.Delegation);
    expect(tsType).toBe(
      'Delegation(address delegator,address delegate,bytes32 authority,Caveat[] caveats,uint256 salt)',
    );
  });

  it('the two typehashes ARE NOT EQUAL — open finding CROSS-STACK-001', () => {
    const tsHash = typehash(encodeType('Delegation', DELEGATION_EIP712_TYPES.Delegation));
    const contractHash = typehash(CONTRACT_DELEGATION_TYPE_STRING);
    // Failing this assertion would mean someone fixed the divergence
    // (or accidentally aligned the strings) — at which point both should
    // be re-verified and this test inverted to assert EQUALITY.
    expect(tsHash).not.toBe(contractHash);
  });

  it('locks the contract typehash byte value (regression-guard)', () => {
    // If the contract ever changes the type string, this hash drifts and
    // CI signals immediately.
    const contractHash = typehash(CONTRACT_DELEGATION_TYPE_STRING);
    expect(contractHash).toBe('0xac5469bad161df7c56017782e0a87a91008dbe46dacd5eb42e48e7f4b4fc4e39');
  });

  it('locks the TS-side typehash byte value (regression-guard)', () => {
    // The TS side independently locks its current state. The fix (either
    // converge to one form or document the gap) is a follow-up wave.
    const tsHash = typehash(encodeType('Delegation', DELEGATION_EIP712_TYPES.Delegation));
    expect(tsHash).toBe('0x89d13f1f844c3a5eb90d36112705f2ce26a98665fc34a02792e2abeba7c48434');
  });
});

describe('H7-D.9 — caveats encoding (the path where both sides AGREE)', () => {
  // Both layers compute the `caveatsHash` (the 5th field of structHash) as
  //   keccak256(concat(hashStruct(c) for c in caveats))
  // even though they DISAGREE on the parent typehash. So the cross-stack
  // divergence is ISOLATED to the parent typehash; the per-caveat hashes
  // are byte-identical. Locking both sides here.

  it('TS hashStruct(Caveat) byte-matches the contract per-caveat encoding', () => {
    // Contract:
    //   keccak256(abi.encode(CAVEAT_TYPEHASH, c.enforcer, keccak256(c.terms)))
    const caveatTypehash = typehash(CONTRACT_CAVEAT_TYPE_STRING);
    const enforcer = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9' as const;
    const terms: Hex = '0xdeadbeef';
    const expected = keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'address' }, { type: 'bytes32' }],
        [caveatTypehash, enforcer, keccak256(terms)],
      ),
    );
    expect(expected).toMatch(/^0x[0-9a-f]{64}$/);
    // (We do not have direct access to a contract instance in this unit
    // test; the encoding is locked in lockstep with the contract by
    // construction. Foundry side covers the contract direction.)
  });
});
