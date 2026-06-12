import { describe, it, expect } from 'vitest';
import { decodeAbiParameters, toFunctionSelector } from 'viem';
import {
  buildPaymentMandateCaveats,
  encodePaymentTerms,
  describePaymentMandate,
  PAYMENT_TRANSFER_SELECTOR,
  type PaymentMandateCaveatOpts,
} from '../../src/caveats';
import { buildRevokeDelegationCall } from '../../src/onchain';
import { ROOT_AUTHORITY } from '../../src/types';

const ENFORCERS = {
  payment: '0x00000000000000000000000000000000000000a1' as `0x${string}`,
  timestamp: '0x00000000000000000000000000000000000000a2' as `0x${string}`,
  allowedTargets: '0x00000000000000000000000000000000000000a3' as `0x${string}`,
  allowedMethods: '0x00000000000000000000000000000000000000a4' as `0x${string}`,
};
const TREASURY = '0x0000000000000000000000000000000000007ee1' as `0x${string}`;
const USDC = '0x00000000000000000000000000000000000005dc' as `0x${string}`;

const OPTS: PaymentMandateCaveatOpts = {
  enforcers: ENFORCERS,
  payee: TREASURY,
  asset: USDC,
  maxAmountPerCharge: 1_000_000n,
  maxAggregate: 5_000_000n,
  maxRedemptionsPerWindow: 20,
  windowSeconds: 3600,
  validUntil: 1_900_000_000,
};

describe('encodePaymentTerms (golden — must match PaymentEnforcer.sol abi.decode)', () => {
  it('is exactly 192 bytes and round-trips to the right tuple', () => {
    const terms = encodePaymentTerms(OPTS);
    // 0x + 6 * 64 hex chars = 2 + 384
    expect(terms.length).toBe(2 + 384);
    const decoded = decodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint32' },
        { type: 'uint32' },
      ],
      terms,
    );
    expect(decoded[0].toLowerCase()).toBe(TREASURY.toLowerCase());
    expect(decoded[1].toLowerCase()).toBe(USDC.toLowerCase());
    expect(decoded[2]).toBe(1_000_000n);
    expect(decoded[3]).toBe(5_000_000n);
    expect(decoded[4]).toBe(20);
    expect(decoded[5]).toBe(3600);
  });

  it('rejects invalid caps (fail-closed, mirrors the enforcer)', () => {
    expect(() => encodePaymentTerms({ ...OPTS, maxAmountPerCharge: 0n })).toThrow(/maxAmountPerCharge/);
    expect(() => encodePaymentTerms({ ...OPTS, maxAggregate: 999n })).toThrow(/maxAggregate/);
    expect(() => encodePaymentTerms({ ...OPTS, maxRedemptionsPerWindow: 0 })).toThrow(/maxRedemptionsPerWindow/);
    expect(() => encodePaymentTerms({ ...OPTS, windowSeconds: 0 })).toThrow(/windowSeconds/);
  });
});

describe('buildPaymentMandateCaveats (PAY-DEL-1)', () => {
  it('composes 4 caveats: payment + timestamp + allowedTargets(USDC) + allowedMethods(transfer)', () => {
    const caveats = buildPaymentMandateCaveats(OPTS);
    expect(caveats).toHaveLength(4);
    expect(caveats[0]!.enforcer).toBe(ENFORCERS.payment);
    expect(caveats[1]!.enforcer).toBe(ENFORCERS.timestamp);
    expect(caveats[2]!.enforcer).toBe(ENFORCERS.allowedTargets);
    expect(caveats[3]!.enforcer).toBe(ENFORCERS.allowedMethods);
    // every caveat's args is '0x' at mint (executor fills payment args at redemption)
    for (const c of caveats) expect(c.args).toBe('0x');
    // allowedTargets pins USDC
    const [targets] = decodeAbiParameters([{ type: 'address[]' }], caveats[2]!.terms);
    expect((targets as readonly string[]).map((t) => t.toLowerCase())).toEqual([USDC.toLowerCase()]);
    // allowedMethods pins IERC20.transfer
    const [methods] = decodeAbiParameters([{ type: 'bytes4[]' }], caveats[3]!.terms);
    expect(methods).toEqual([PAYMENT_TRANSFER_SELECTOR]);
  });

  it('PAYMENT_TRANSFER_SELECTOR equals IERC20.transfer(address,uint256)', () => {
    expect(PAYMENT_TRANSFER_SELECTOR).toBe(toFunctionSelector('transfer(address,uint256)'));
  });
});

describe('describePaymentMandate (PAY-DEL-4 consent)', () => {
  it('returns a human-readable consent object, revocable', () => {
    const c = describePaymentMandate(OPTS);
    expect(c).toEqual({
      recipient: TREASURY,
      asset: USDC,
      maxAmountPerCharge: 1_000_000n,
      sessionBudget: 5_000_000n,
      maxRedemptionsPerWindow: 20,
      windowSeconds: 3600,
      expiresAt: 1_900_000_000,
      revocable: true,
    });
  });
});

describe('buildRevokeDelegationCall (PAY-DEL-3)', () => {
  it('targets the DelegationManager with the revokeDelegationByOwner selector', () => {
    const dm = '0x3a8E2cE74564f699b135db6f266ccDb563979C05' as `0x${string}`;
    const call = buildRevokeDelegationCall(
      {
        delegator: TREASURY,
        delegate: ENFORCERS.payment,
        authority: ROOT_AUTHORITY,
        caveats: buildPaymentMandateCaveats(OPTS),
        salt: 1n,
        signature: '0x',
      },
      dm,
    );
    expect(call.to).toBe(dm);
    expect(call.value).toBe(0n);
    expect(call.data.slice(0, 10)).toBe(
      toFunctionSelector(
        'revokeDelegationByOwner((address,address,bytes32,(address,bytes,bytes)[],uint256,bytes))',
      ),
    );
  });
});
