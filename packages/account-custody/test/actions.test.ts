// Custody action builders — golden fixtures + adversarial inputs (audit P2-2).
//
// Each builder produces the `args` bytes the on-chain CustodyPolicy
// scheduler expects. Drift here means a scheduled change applies to
// the wrong target / value / tier on chain → CRITICAL.

import { describe, it, expect } from 'vitest';
import { decodeAbiParameters } from 'viem';
import type { Address } from 'viem';
import {
  CustodyAction,
  buildAddCustodianArgs,
  buildAddPasskeyCredentialArgs,
  buildAddTrusteeArgs,
  buildApplySystemUpdateArgs,
  buildChangeApprovalsRequiredArgs,
  buildChangeCustodyModeArgs,
  buildChangeValueCeilingArgs,
  buildRemoveCustodianArgs,
  buildRemovePasskeyCredentialArgs,
  buildRemoveTrusteeArgs,
  buildSetRecoveryApprovalsArgs,
} from '../src';

const ALICE: Address = '0x31ed17fb99e82e02085ab4b3cbdab05489098b44';
const BOB: Address = '0x9cfc7e44757529769a28747f86425c682fe64653';
const IMPL: Address = '0x69385c6384c9a8666689e156b0cdcda4d747e176';
const ZERO: Address = '0x0000000000000000000000000000000000000000';

describe('CustodyAction wire-format stability', () => {
  it('enum values are stable (wire-format)', () => {
    // Adding values is safe; reordering breaks the scheduler dispatch
    // arm match. Lock the numerics explicitly.
    expect(CustodyAction.AddCustodian).toBe(0);
    expect(CustodyAction.RemoveCustodian).toBe(1);
    expect(CustodyAction.AddPasskeyCredential).toBe(2);
    expect(CustodyAction.RemovePasskeyCredential).toBe(3);
    expect(CustodyAction.AddTrustee).toBe(4);
    expect(CustodyAction.RemoveTrustee).toBe(5);
    expect(CustodyAction.ChangeCustodyMode).toBe(6);
    expect(CustodyAction.ApplySystemUpdate).toBe(7);
    expect(CustodyAction.RotateDelegationManager).toBe(8);
    expect(CustodyAction.RotatePaymaster).toBe(9);
    expect(CustodyAction.RotateSessionIssuer).toBe(10);
    expect(CustodyAction.RotateAllCustodians).toBe(11);
    expect(CustodyAction.ChangeValueCeiling).toBe(12);
    expect(CustodyAction.SetRecoveryApprovals).toBe(13);
    expect(CustodyAction.RecoverAccount).toBe(14);
    expect(CustodyAction.ChangeApprovalsRequired).toBe(15);
  });
});

describe('buildAddCustodianArgs / buildRemoveCustodianArgs', () => {
  it('encodes a single address as abi.encode(address)', () => {
    const add = buildAddCustodianArgs(ALICE);
    const remove = buildRemoveCustodianArgs(BOB);
    expect(add).toBe('0x00000000000000000000000031ed17fb99e82e02085ab4b3cbdab05489098b44');
    expect(remove).toBe('0x0000000000000000000000009cfc7e44757529769a28747f86425c682fe64653');
  });

  it('decodes back to the original address', () => {
    const encoded = buildAddCustodianArgs(ALICE);
    const [back] = decodeAbiParameters([{ type: 'address' }], encoded);
    expect((back as string).toLowerCase()).toBe(ALICE.toLowerCase());
  });

  it('zero address encodes deterministically (security: contract should reject)', () => {
    // The builder doesn't refuse ZERO — that's the on-chain check's
    // job. But the encoding MUST be the standard padded zero so the
    // contract's revert is deterministic.
    const encoded = buildAddCustodianArgs(ZERO);
    expect(encoded).toBe('0x' + '00'.repeat(32));
  });
});

describe('buildAddTrusteeArgs / buildRemoveTrusteeArgs', () => {
  it('encodes a single address (same shape as custodian builders)', () => {
    expect(buildAddTrusteeArgs(ALICE)).toBe(buildAddCustodianArgs(ALICE));
    expect(buildRemoveTrusteeArgs(BOB)).toBe(buildRemoveCustodianArgs(BOB));
  });
});

describe('buildChangeCustodyModeArgs', () => {
  it('encodes valid modes 0..3', () => {
    for (const mode of [0, 1, 2, 3] as const) {
      const encoded = buildChangeCustodyModeArgs(mode);
      expect(encoded.length).toBe(2 + 64); // 0x + 32 bytes
      const [back] = decodeAbiParameters([{ type: 'uint8' }], encoded);
      expect(back).toBe(mode);
    }
  });
});

describe('buildChangeValueCeilingArgs', () => {
  it('encodes a uint256 wei value', () => {
    const cap = 1_000_000_000_000_000_000n; // 1 ETH
    const encoded = buildChangeValueCeilingArgs(cap);
    const [back] = decodeAbiParameters([{ type: 'uint256' }], encoded);
    expect(back).toBe(cap);
  });

  it('encodes the max uint256', () => {
    const max = (1n << 256n) - 1n;
    const encoded = buildChangeValueCeilingArgs(max);
    const [back] = decodeAbiParameters([{ type: 'uint256' }], encoded);
    expect(back).toBe(max);
  });
});

describe('buildSetRecoveryApprovalsArgs', () => {
  it('encodes uint8 in [0, 255]', () => {
    for (const n of [0, 1, 2, 5, 10, 255]) {
      const [back] = decodeAbiParameters([{ type: 'uint8' }], buildSetRecoveryApprovalsArgs(n));
      expect(back).toBe(n);
    }
  });
});

describe('buildApplySystemUpdateArgs', () => {
  it('encodes implementation address', () => {
    const encoded = buildApplySystemUpdateArgs(IMPL);
    const [back] = decodeAbiParameters([{ type: 'address' }], encoded);
    expect((back as string).toLowerCase()).toBe(IMPL.toLowerCase());
  });
});

describe('buildChangeApprovalsRequiredArgs', () => {
  it('encodes (tier, newCount) as abi.encode(uint8, uint8)', () => {
    const encoded = buildChangeApprovalsRequiredArgs(4, 2);
    const [tier, count] = decodeAbiParameters(
      [{ type: 'uint8' }, { type: 'uint8' }],
      encoded,
    );
    expect(tier).toBe(4);
    expect(count).toBe(2);
  });

  it('preserves field order — tier first, count second (regression lock)', () => {
    // Spec 213: tier and count are non-commutative. A naive
    // refactor that swaps the order would silently rewrite
    // T4-approvals-2 to T2-approvals-4 — a critical regression.
    const a = buildChangeApprovalsRequiredArgs(4, 2);
    const b = buildChangeApprovalsRequiredArgs(2, 4);
    expect(a).not.toBe(b);
  });
});

describe('buildAddPasskeyCredentialArgs', () => {
  const RPID = ('0x' + 'cd'.repeat(32)) as `0x${string}`;

  it('encodes (credId, x, y, rpIdHash) as abi.encode(bytes32, uint256, uint256, bytes32)', () => {
    const credId = '0x' + 'ab'.repeat(32);
    const x = 0x64a72a4f45f6c724e379a54efa3dbfe14c04fa12eddc44f7830aca98ee0f5cf7n;
    const y = 0x0c7dfbe96e6d041812e831c4f2e8597209c103508a3f3b53466713fd1f64197fn;
    const encoded = buildAddPasskeyCredentialArgs(credId as `0x${string}`, x, y, RPID);
    const [c, xb, yb, rb] = decodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }],
      encoded,
    );
    expect((c as string).toLowerCase()).toBe(credId.toLowerCase());
    expect(xb).toBe(x);
    expect(yb).toBe(y);
    expect((rb as string).toLowerCase()).toBe(RPID.toLowerCase());
  });

  it('preserves (credId, x, y) order — regression lock', () => {
    const credId = '0x' + 'aa'.repeat(32);
    const a = buildAddPasskeyCredentialArgs(credId as `0x${string}`, 1n, 2n, RPID);
    const b = buildAddPasskeyCredentialArgs(credId as `0x${string}`, 2n, 1n, RPID);
    expect(a).not.toBe(b);
  });

  it('rejects zero rpIdHash — addPasskey reverts on it (H7-C.1)', () => {
    const credId = '0x' + 'aa'.repeat(32);
    expect(() =>
      buildAddPasskeyCredentialArgs(credId as `0x${string}`, 1n, 2n, ('0x' + '00'.repeat(32)) as `0x${string}`),
    ).toThrow(/rpIdHash.*non-zero/);
  });
});

describe('buildRemovePasskeyCredentialArgs', () => {
  it('encodes bytes32 credId', () => {
    const credId = '0x' + 'de'.repeat(32);
    const encoded = buildRemovePasskeyCredentialArgs(credId as `0x${string}`);
    const [back] = decodeAbiParameters([{ type: 'bytes32' }], encoded);
    expect((back as string).toLowerCase()).toBe(credId.toLowerCase());
  });
});

// ─── Wave H2 — range/shape guards ──────────────────────────────────────

import {
  buildChangeCustodyModeArgs,
  buildSetRecoveryApprovalsArgs,
  buildChangeApprovalsRequiredArgs,
  buildAddPasskeyCredentialArgs,
  buildRemovePasskeyCredentialArgs,
  buildAddCustodianArgs,
  buildRotateAllCustodiansArgs,
  buildRecoverAccountArgs,
  buildChangeValueCeilingArgs,
} from '../src/actions';

const A = '0x1111111111111111111111111111111111111111' as const;
const A2 = '0x2222222222222222222222222222222222222222' as const;
const ZERO_BYTES32 = ('0x' + '00'.repeat(32)) as `0x${string}`;
const REAL_DIGEST = ('0x' + 'ab'.repeat(32)) as `0x${string}`;

describe('action builder range guards (audit H2)', () => {
  describe('buildChangeCustodyModeArgs', () => {
    it('accepts modes 0-3', () => {
      for (const m of [0, 1, 2, 3] as const) {
        expect(() => buildChangeCustodyModeArgs(m)).not.toThrow();
      }
    });
    it('rejects mode 4 (above max)', () => {
      // @ts-expect-error — runtime guard catches out-of-range
      expect(() => buildChangeCustodyModeArgs(4)).toThrow(/uint8 in \[0, 3\]/);
    });
    it('rejects non-integer mode', () => {
      // @ts-expect-error — runtime guard catches non-integer
      expect(() => buildChangeCustodyModeArgs(1.5)).toThrow(/uint8/);
    });
  });

  describe('buildSetRecoveryApprovalsArgs', () => {
    it('accepts 1-255', () => {
      expect(() => buildSetRecoveryApprovalsArgs(1)).not.toThrow();
      expect(() => buildSetRecoveryApprovalsArgs(255)).not.toThrow();
    });
    it('accepts 0 (on-chain rejects but builder is wire-format-only)', () => {
      expect(() => buildSetRecoveryApprovalsArgs(0)).not.toThrow();
    });
    it('rejects 256 + negatives', () => {
      expect(() => buildSetRecoveryApprovalsArgs(256)).toThrow(/uint8/);
      expect(() => buildSetRecoveryApprovalsArgs(-1)).toThrow(/uint8/);
    });
  });

  describe('buildChangeApprovalsRequiredArgs', () => {
    it('accepts tier [1, 5] and newCount ≥ 1', () => {
      expect(() => buildChangeApprovalsRequiredArgs(1, 1)).not.toThrow();
      expect(() => buildChangeApprovalsRequiredArgs(5, 99)).not.toThrow();
    });
    it('rejects tier 0 (out of low bound)', () => {
      expect(() => buildChangeApprovalsRequiredArgs(0, 1)).toThrow(/tier.*uint8 in \[1, 5\]/);
    });
    it('rejects tier 6 (T6 is recovery, separate slot)', () => {
      expect(() => buildChangeApprovalsRequiredArgs(6, 1)).toThrow(/tier.*uint8 in \[1, 5\]/);
    });
    it('rejects newCount 0', () => {
      expect(() => buildChangeApprovalsRequiredArgs(4, 0)).toThrow(/newCount.*uint8/);
    });
  });

  describe('buildAddPasskeyCredentialArgs', () => {
    const REAL_RPID = ('0x' + 'cd'.repeat(32)) as `0x${string}`;
    it('accepts non-zero credential + non-zero x/y + non-zero rpIdHash', () => {
      expect(() => buildAddPasskeyCredentialArgs(REAL_DIGEST, 1n, 2n, REAL_RPID)).not.toThrow();
    });
    it('rejects zero credentialIdDigest (C-6)', () => {
      expect(() => buildAddPasskeyCredentialArgs(ZERO_BYTES32, 1n, 2n, REAL_RPID)).toThrow(/C-6/);
    });
    it('rejects malformed bytes32', () => {
      expect(() =>
        // @ts-expect-error — runtime guard catches malformed
        buildAddPasskeyCredentialArgs('0xabc', 1n, 2n, REAL_RPID),
      ).toThrow(/not a 32-byte hex/);
    });
    it('rejects x = 0 or y = 0', () => {
      expect(() => buildAddPasskeyCredentialArgs(REAL_DIGEST, 0n, 2n, REAL_RPID)).toThrow(/uint256 in \[1/);
      expect(() => buildAddPasskeyCredentialArgs(REAL_DIGEST, 1n, 0n, REAL_RPID)).toThrow(/uint256 in \[1/);
    });
    it('rejects zero rpIdHash (H7-C.1)', () => {
      expect(() => buildAddPasskeyCredentialArgs(REAL_DIGEST, 1n, 2n, ZERO_BYTES32 as `0x${string}`)).toThrow(/rpIdHash.*non-zero/);
    });
  });

  describe('buildRemovePasskeyCredentialArgs', () => {
    it('accepts any non-malformed bytes32 (including zero — on-chain rejects)', () => {
      expect(() => buildRemovePasskeyCredentialArgs(REAL_DIGEST)).not.toThrow();
      expect(() => buildRemovePasskeyCredentialArgs(ZERO_BYTES32)).not.toThrow();
    });
    it('rejects malformed bytes32', () => {
      // @ts-expect-error — runtime catches malformed
      expect(() => buildRemovePasskeyCredentialArgs('0xabc')).toThrow(/32-byte hex/);
    });
  });

  describe('buildAddCustodianArgs', () => {
    it('accepts checksummed and lowercase 20-byte hex', () => {
      expect(() => buildAddCustodianArgs(A)).not.toThrow();
    });
    it('rejects malformed address', () => {
      // @ts-expect-error — runtime catches malformed
      expect(() => buildAddCustodianArgs('0x123')).toThrow(/20-byte hex/);
    });
  });

  describe('buildChangeValueCeilingArgs', () => {
    it('accepts any uint256', () => {
      expect(() => buildChangeValueCeilingArgs(0n)).not.toThrow();
      expect(() => buildChangeValueCeilingArgs((1n << 256n) - 1n)).not.toThrow();
    });
    it('rejects 2^256 (overflow)', () => {
      expect(() => buildChangeValueCeilingArgs(1n << 256n)).toThrow(/uint256/);
    });
    it('rejects negative', () => {
      expect(() => buildChangeValueCeilingArgs(-1n)).toThrow(/uint256/);
    });
  });

  describe('buildRotateAllCustodiansArgs', () => {
    it('accepts empty arrays', () => {
      expect(() => buildRotateAllCustodiansArgs([], [])).not.toThrow();
    });
    it('encodes add+remove together', () => {
      const out = buildRotateAllCustodiansArgs([A], [A2]);
      expect(out).toMatch(/^0x[0-9a-f]+$/);
    });
    it('rejects malformed addresses', () => {
      expect(() =>
        // @ts-expect-error — runtime catches malformed
        buildRotateAllCustodiansArgs([A, '0xbad'], []),
      ).toThrow(/20-byte hex/);
    });
  });

  describe('buildRecoverAccountArgs', () => {
    const REAL_RPID = ('0x' + 'cd'.repeat(32)) as `0x${string}`;
    it('accepts a single-passkey atomic swap', () => {
      const out = buildRecoverAccountArgs({
        addPasskeys: [{ credentialIdDigest: REAL_DIGEST, x: 1n, y: 2n, rpIdHash: REAL_RPID }],
        removePasskeyCredentialIdDigests: [('0x' + 'cd'.repeat(32)) as `0x${string}`],
      });
      expect(out).toMatch(/^0x[0-9a-f]+$/);
    });
    it('accepts owner-only recovery', () => {
      expect(() => buildRecoverAccountArgs({ addOwners: [A], removeOwners: [A2] })).not.toThrow();
    });
    it('rejects all-empty args (would be a no-op tx)', () => {
      expect(() => buildRecoverAccountArgs({})).toThrow(/at least one add\/remove field/);
    });
    it('rejects zero credentialIdDigest in addPasskeys', () => {
      expect(() =>
        buildRecoverAccountArgs({
          addPasskeys: [{ credentialIdDigest: ZERO_BYTES32, x: 1n, y: 2n, rpIdHash: REAL_RPID }],
        }),
      ).toThrow(/C-6/);
    });
    it('rejects x = 0 in addPasskeys', () => {
      expect(() =>
        buildRecoverAccountArgs({
          addPasskeys: [{ credentialIdDigest: REAL_DIGEST, x: 0n, y: 2n, rpIdHash: REAL_RPID }],
        }),
      ).toThrow(/uint256 in \[1/);
    });
    it('rejects zero rpIdHash in addPasskeys (H7-C.1)', () => {
      expect(() =>
        buildRecoverAccountArgs({
          addPasskeys: [{ credentialIdDigest: REAL_DIGEST, x: 1n, y: 2n, rpIdHash: ZERO_BYTES32 as `0x${string}` }],
        }),
      ).toThrow(/rpIdHash.*non-zero/);
    });
  });
});
