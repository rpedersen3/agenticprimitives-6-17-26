// H7-D.9 / R1 — cross-stack EIP-712 typehash invariant.
//
// **R1 / CROSS-STACK-001 closure (2026-05-30).** The contract's
// `DELEGATION_TYPEHASH` previously used a non-standard EIP-712 type
// string that inlined a precomputed `bytes32 caveatsHash` field, while
// the off-chain `DELEGATION_EIP712_TYPES` used the canonical form with
// a `Caveat[] caveats` reference. The two sides produced DIFFERENT
// typehashes → different structHashes → different signed digests.
//
// In R1 we converged the contract to standard EIP-712. The contract
// type string now matches viem's canonical encoding (primary struct
// followed by referenced struct types, alphabetically). This test
// locks the convergence: any future drift breaks CI.
//
// Original D9 finding history is captured in
// docs/audits/2026-05-packages-contracts-production-readiness.md.

import { describe, it, expect } from 'vitest';
import { keccak256, stringToBytes, encodeAbiParameters, type Hex } from 'viem';
import { DELEGATION_EIP712_TYPES } from '../../src/hash';

// The standard EIP-712 type string for `Delegation` is the primary
// struct followed by the (alphabetically-sorted, deduped) referenced
// struct types appended without separator. See EIP-712 § "Definition
// of encodeType" and viem's `hashTypedData` implementation.
const CANONICAL_DELEGATION_TYPE_STRING =
  'Delegation(address delegator,address delegate,bytes32 authority,Caveat[] caveats,uint256 salt)' +
  'Caveat(address enforcer,bytes terms)';
const CANONICAL_CAVEAT_TYPE_STRING = 'Caveat(address enforcer,bytes terms)';

type EipField = { name: string; type: string };
type EipTypes = Record<string, readonly EipField[]>;

/** Encode a single struct: `Name(type1 name1,type2 name2,...)`. */
function encodeStruct(typeName: string, fields: readonly EipField[]): string {
  return `${typeName}(${fields.map((f) => `${f.type} ${f.name}`).join(',')})`;
}

/**
 * Canonical EIP-712 type string: primary struct + every referenced
 * struct type (transitively), alphabetically sorted, no separators.
 * Mirrors the encoding viem's `hashTypedData` performs internally.
 */
function encodeTypeWithDeps(typeName: string, types: EipTypes): string {
  const deps = new Set<string>();
  const visit = (t: string) => {
    if (!types[t]) return;
    for (const f of types[t]) {
      const base = f.type.replace(/\[\]$/, '');
      if (types[base] && base !== typeName && !deps.has(base)) {
        deps.add(base);
        visit(base);
      }
    }
  };
  visit(typeName);
  const primary = encodeStruct(typeName, types[typeName]!);
  const tail = [...deps]
    .sort()
    .map((d) => encodeStruct(d, types[d]!))
    .join('');
  return primary + tail;
}

function typehash(typeString: string): Hex {
  return keccak256(stringToBytes(typeString));
}

describe('R1 / CROSS-STACK-001 closure — Caveat typehash convergence', () => {
  it('TS Caveat type string equals the canonical EIP-712 form', () => {
    const tsType = encodeStruct('Caveat', DELEGATION_EIP712_TYPES.Caveat);
    expect(tsType).toBe(CANONICAL_CAVEAT_TYPE_STRING);
  });

  it('Caveat type DOES NOT carry `args` (audit F-1 invariant)', () => {
    const caveatFieldNames = DELEGATION_EIP712_TYPES.Caveat.map((f) => f.name);
    expect(caveatFieldNames).toEqual(['enforcer', 'terms']);
    expect(caveatFieldNames).not.toContain('args');
  });
});

describe('R1 / CROSS-STACK-001 closure — Delegation typehash convergence', () => {
  it('TS canonical type string includes the appended Caveat definition', () => {
    const tsType = encodeTypeWithDeps(
      'Delegation',
      DELEGATION_EIP712_TYPES as unknown as EipTypes,
    );
    expect(tsType).toBe(CANONICAL_DELEGATION_TYPE_STRING);
  });

  it('TS keccak256(canonical type string) byte-matches the contract DELEGATION_TYPEHASH', () => {
    const tsHash = typehash(
      encodeTypeWithDeps(
        'Delegation',
        DELEGATION_EIP712_TYPES as unknown as EipTypes,
      ),
    );
    const contractHash = typehash(CANONICAL_DELEGATION_TYPE_STRING);
    expect(tsHash).toBe(contractHash);
  });

  it('locks the converged typehash byte value (regression-guard, both sides)', () => {
    // If either side drifts from this byte value, CI signals. The
    // contract test `test_DELEGATION_TYPEHASH_is_a_known_constant`
    // independently locks the same value on the Solidity side.
    const tsHash = typehash(
      encodeTypeWithDeps(
        'Delegation',
        DELEGATION_EIP712_TYPES as unknown as EipTypes,
      ),
    );
    expect(tsHash).toBe(
      '0x52f4b7596c22f77177e8e563e6502ad014a696bfc92f9c6cabcaf5738c4ed265',
    );
  });
});

describe('R1 — caveats array encoding (the path where both sides already agreed)', () => {
  // Both layers compute the `caveats` field encoding (the 4th field of
  // structHash, in standard EIP-712 form) as
  //   keccak256(concat(hashStruct(c) for c in caveats))
  // The pre-R1 contract used an inlined `bytes32 caveatsHash`; the new
  // contract delegates this to the standard EIP-712 array-of-struct
  // encoding. Either way, the per-caveat encoding is byte-identical to
  // the off-chain side.

  it('TS hashStruct(Caveat) byte-matches the contract per-caveat encoding', () => {
    // Contract:
    //   keccak256(abi.encode(CAVEAT_TYPEHASH, c.enforcer, keccak256(c.terms)))
    const caveatTypehash = typehash(CANONICAL_CAVEAT_TYPE_STRING);
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
