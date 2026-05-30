import { describe, it, expect } from 'vitest';
import {
  ERC1271_MAGIC,
  ERC6492_MAGIC,
  universalSignatureValidatorAbi,
  verifyUserSignature,
  verifyUserSignatureView,
  isErc6492Wrapped,
} from '../../src/verify-signature';
import type { Address, Hex } from '../../src/types';

const VALIDATOR: Address = '0x1111111111111111111111111111111111111111';
const SIGNER: Address = '0x2222222222222222222222222222222222222222';
const HASH: Hex = ('0x' + 'ab'.repeat(32)) as Hex;
const SIG_EOA: Hex = ('0x' + 'cc'.repeat(65)) as Hex;
const SIG_6492: Hex = (`0x${'00'.repeat(96)}${ERC6492_MAGIC.slice(2)}`) as Hex;

describe('isErc6492Wrapped', () => {
  it('returns true when the signature ends with the magic suffix', () => {
    expect(isErc6492Wrapped(SIG_6492)).toBe(true);
  });

  it('returns false for plain EOA signatures', () => {
    expect(isErc6492Wrapped(SIG_EOA)).toBe(false);
  });

  it('returns false for short signatures', () => {
    expect(isErc6492Wrapped('0xdead' as Hex)).toBe(false);
  });

  it('returns false when only some of the magic suffix is present', () => {
    const partial = `0x${'00'.repeat(64)}${ERC6492_MAGIC.slice(2, 32)}aabb` as Hex;
    expect(isErc6492Wrapped(partial)).toBe(false);
  });
});

describe('verifyUserSignatureView', () => {
  it('passes signer/hash/sig through to readContract', async () => {
    let captured: unknown = null;
    const client = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async readContract(args: any) {
        captured = args;
        return true;
      },
    };
    const result = await verifyUserSignatureView({
      universalValidator: VALIDATOR,
      signer: SIGNER,
      hash: HASH,
      signature: SIG_EOA,
      client,
    });
    expect(result).toEqual({ ok: true });
    expect(captured).toMatchObject({
      address: VALIDATOR,
      functionName: 'isValidSigView',
      args: [SIGNER, HASH, SIG_EOA],
    });
  });

  it('H7-B.3: returns reason:rpc when readContract throws (not invalid)', async () => {
    const client = {
      async readContract(): Promise<boolean> {
        throw new Error('rpc-failed');
      },
    };
    const result = await verifyUserSignatureView({
      universalValidator: VALIDATOR,
      signer: SIGNER,
      hash: HASH,
      signature: SIG_EOA,
      client,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('rpc');
      expect((result.details as Error)?.message).toBe('rpc-failed');
    }
  });

  it('H7-B.3: returns reason:invalid when the validator reports invalid', async () => {
    const client = {
      async readContract(): Promise<boolean> {
        return false;
      },
    };
    const result = await verifyUserSignatureView({
      universalValidator: VALIDATOR,
      signer: SIGNER,
      hash: HASH,
      signature: SIG_EOA,
      client,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
  });
});

describe('verifyUserSignature (state-changing simulate path)', () => {
  it('uses simulateContract.isValidSig when available', async () => {
    let captured: unknown = null;
    const client = {
      async readContract(): Promise<boolean> {
        throw new Error('view path should not be hit');
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async simulateContract(args: any) {
        captured = args;
        return { result: true };
      },
    };
    const result = await verifyUserSignature({
      universalValidator: VALIDATOR,
      signer: SIGNER,
      hash: HASH,
      signature: SIG_6492,
      client,
    });
    expect(result).toEqual({ ok: true });
    expect(captured).toMatchObject({
      address: VALIDATOR,
      functionName: 'isValidSig',
      args: [SIGNER, HASH, SIG_6492],
    });
  });

  it('falls back to the view path when simulateContract is missing', async () => {
    let hitView = false;
    const client = {
      async readContract(): Promise<boolean> {
        hitView = true;
        return true;
      },
    };
    const result = await verifyUserSignature({
      universalValidator: VALIDATOR,
      signer: SIGNER,
      hash: HASH,
      signature: SIG_EOA,
      client,
    });
    expect(hitView).toBe(true);
    expect(result).toEqual({ ok: true });
  });

  it('H7-B.3: returns reason:rpc when simulateContract throws (not invalid)', async () => {
    const client = {
      async readContract(): Promise<boolean> {
        return false;
      },
      async simulateContract(): Promise<{ result: boolean }> {
        throw new Error('simulate-rejected');
      },
    };
    const result = await verifyUserSignature({
      universalValidator: VALIDATOR,
      signer: SIGNER,
      hash: HASH,
      signature: SIG_6492,
      client,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('rpc');
      expect((result.details as Error)?.message).toBe('simulate-rejected');
    }
  });
});

describe('universalSignatureValidatorAbi', () => {
  it('exposes both isValidSig and isValidSigView entries', () => {
    const names = universalSignatureValidatorAbi.map((e) => e.name).sort();
    expect(names).toEqual(['isValidSig', 'isValidSigView']);
  });

  it('isValidSig is non-payable (state-changing)', () => {
    const e = universalSignatureValidatorAbi.find((x) => x.name === 'isValidSig')!;
    expect(e.stateMutability).toBe('nonpayable');
  });

  it('isValidSigView is view', () => {
    const e = universalSignatureValidatorAbi.find((x) => x.name === 'isValidSigView')!;
    expect(e.stateMutability).toBe('view');
  });
});

describe('ERC magic constants', () => {
  it('ERC1271_MAGIC matches the spec value', () => {
    expect(ERC1271_MAGIC).toBe('0x1626ba7e');
  });

  it('ERC6492_MAGIC is the 32-byte 0x6492…6492 sequence', () => {
    expect(ERC6492_MAGIC.length).toBe(2 + 64);
    expect(ERC6492_MAGIC.toLowerCase()).toMatch(/^0x(6492){16}$/);
  });
});
