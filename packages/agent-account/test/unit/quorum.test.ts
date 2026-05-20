import { describe, it, expect } from 'vitest';
import { keccak256, encodeAbiParameters, type Address, type Hex } from 'viem';
import {
  packSafeSignatures,
  computeAdminPayloadHash,
} from '../../src/quorum';

// Deterministic test sigs — three 65-byte hex strings synthesised by
// hand so the packer's behavior is testable without a real ECDSA round.
// All three are the literal byte layout `{r=fill}{s=fill}{v=1c}` so the
// concatenation test is unambiguous.
function fakeSig(fill: string): Hex {
  // 64 hex chars r + 64 hex chars s + 2 hex chars v = 130 chars
  return `0x${fill.repeat(32)}${fill.repeat(32)}1c` as Hex;
}

const ALICE: Address = '0xa11ce00000000000000000000000000000000000';
const BOB:   Address = '0xb0b0000000000000000000000000000000000000';
const CAROL: Address = '0xca401e0000000000000000000000000000000000';

describe('packSafeSignatures', () => {
  it('packs a single slot into a 65-byte blob', () => {
    const blob = packSafeSignatures([{ signer: ALICE, signature: fakeSig('aa') }]);
    // 130 hex chars + 0x prefix = 132 chars total.
    expect(blob).toHaveLength(2 + 130);
    expect(blob.startsWith('0x')).toBe(true);
  });

  it('sorts slots ascending by signer address', () => {
    // Pass in unsorted order; expect output to start with alice (lowest).
    const blob = packSafeSignatures([
      { signer: CAROL, signature: fakeSig('cc') },
      { signer: ALICE, signature: fakeSig('aa') },
      { signer: BOB,   signature: fakeSig('bb') },
    ]);
    // Each slot is 65 bytes / 130 hex chars. Confirm first slot is alice's.
    const slot0 = blob.slice(2, 2 + 130);
    expect(slot0.startsWith('aa'.repeat(32))).toBe(true);
    const slot1 = blob.slice(2 + 130, 2 + 260);
    expect(slot1.startsWith('bb'.repeat(32))).toBe(true);
    const slot2 = blob.slice(2 + 260, 2 + 390);
    expect(slot2.startsWith('cc'.repeat(32))).toBe(true);
  });

  it('rejects empty input', () => {
    expect(() => packSafeSignatures([])).toThrow(/at least one slot/);
  });

  it('rejects malformed signature (wrong length)', () => {
    expect(() =>
      packSafeSignatures([
        { signer: ALICE, signature: '0xdeadbeef' as Hex },
      ]),
    ).toThrow(/must be 65 bytes/);
  });

  it('rejects duplicate signers', () => {
    expect(() =>
      packSafeSignatures([
        { signer: ALICE, signature: fakeSig('aa') },
        { signer: ALICE, signature: fakeSig('bb') },
      ]),
    ).toThrow(/duplicate signer/);
  });

  it('threshold=1 trivial case (single signer) is doctrinally valid', () => {
    const blob = packSafeSignatures([{ signer: ALICE, signature: fakeSig('aa') }]);
    expect(blob).toHaveLength(2 + 130);
  });
});

describe('computeAdminPayloadHash', () => {
  // Mirror the on-chain `AgentAccount._adminPayloadHash` exactly so SDK
  // callers can derive the digest off-chain without an RPC round-trip.
  const account: Address = '0x1234567890123456789012345678901234567890';
  const chainId = 84532n;

  function expected(
    verbStr: 'ADMIN_PROPOSE' | 'ADMIN_EXECUTE' | 'ADMIN_CANCEL',
    proposalId: bigint,
    action: number,
    callArgs: Hex,
    eta: bigint,
  ): Hex {
    const verbBytes = new TextEncoder().encode(verbStr);
    const padded = new Uint8Array(32);
    padded.set(verbBytes, 0);
    const verbHex = ('0x' + Array.from(padded, (b) => b.toString(16).padStart(2, '0')).join('')) as Hex;
    return keccak256(
      encodeAbiParameters(
        [
          { type: 'bytes32' },
          { type: 'uint256' },
          { type: 'uint8' },
          { type: 'bytes32' },
          { type: 'uint64' },
          { type: 'address' },
          { type: 'uint256' },
        ],
        [verbHex, proposalId, action, keccak256(callArgs), eta, account, chainId],
      ),
    );
  }

  it('PROPOSE verb produces the expected hash', () => {
    const args: Hex = '0xdeadbeef';
    const eta = 1_000_000n;
    const actual = computeAdminPayloadHash({
      verb: 'PROPOSE',
      proposalId: 1n,
      action: 0, // AddOwner
      callArgs: args,
      eta,
      account,
      chainId,
    });
    expect(actual).toBe(expected('ADMIN_PROPOSE', 1n, 0, args, eta));
  });

  it('EXECUTE / CANCEL verbs differ from PROPOSE for the same payload', () => {
    const args: Hex = '0x';
    const eta = 5n;
    const propose = computeAdminPayloadHash({
      verb: 'PROPOSE', proposalId: 1n, action: 0, callArgs: args, eta, account, chainId,
    });
    const execute = computeAdminPayloadHash({
      verb: 'EXECUTE', proposalId: 1n, action: 0, callArgs: args, eta, account, chainId,
    });
    const cancel = computeAdminPayloadHash({
      verb: 'CANCEL',  proposalId: 1n, action: 0, callArgs: args, eta, account, chainId,
    });
    expect(propose).not.toBe(execute);
    expect(propose).not.toBe(cancel);
    expect(execute).not.toBe(cancel);
  });

  it('hash binds to account address (cross-account replay impossible)', () => {
    const args: Hex = '0x';
    const a = computeAdminPayloadHash({
      verb: 'PROPOSE', proposalId: 1n, action: 0, callArgs: args, eta: 1n,
      account: '0x1111111111111111111111111111111111111111', chainId,
    });
    const b = computeAdminPayloadHash({
      verb: 'PROPOSE', proposalId: 1n, action: 0, callArgs: args, eta: 1n,
      account: '0x2222222222222222222222222222222222222222', chainId,
    });
    expect(a).not.toBe(b);
  });

  it('hash binds to chain id (cross-chain replay impossible)', () => {
    const args: Hex = '0x';
    const a = computeAdminPayloadHash({
      verb: 'PROPOSE', proposalId: 1n, action: 0, callArgs: args, eta: 1n,
      account, chainId: 1n,
    });
    const b = computeAdminPayloadHash({
      verb: 'PROPOSE', proposalId: 1n, action: 0, callArgs: args, eta: 1n,
      account, chainId: 84532n,
    });
    expect(a).not.toBe(b);
  });
});
