import { describe, expect, it } from 'vitest';
import {
  PACKAGE_NAME,
  PACKAGE_STATUS,
  SPEC_REF,
  assertContextBindingValid,
  assertClosedMandateInvariants,
  computeMandateId,
  registerRail,
  getRail,
  type ContextBinding,
  type PaymentMandate,
} from '../../src/index.js';

describe('payments package identity', () => {
  it('exposes the spec ref + W1 status', () => {
    expect(PACKAGE_NAME).toBe('@agenticprimitives/payments');
    expect(PACKAGE_STATUS).toBe('w1-foundational');
    expect(SPEC_REF).toContain('243-');
  });
});

describe('PMT-3.1 — context binding invariant', () => {
  it('accepts a binding with intentId populated', () => {
    const cb: ContextBinding = {
      intentId: 'intent-123',
      chain: 8453,
      asset: { id: 'usdc' },
      nonce: 1n,
      validFrom: 0,
      expiresAt: 0,
    };
    expect(() => assertContextBindingValid(cb)).not.toThrow();
  });

  it('rejects a binding with no handles populated', () => {
    const cb: ContextBinding = {
      chain: 8453,
      asset: { id: 'usdc' },
      nonce: 1n,
      validFrom: 0,
      expiresAt: 0,
    };
    expect(() => assertContextBindingValid(cb)).toThrow(/PMT-3.1/);
  });
});

describe('PMT-INV-14 — closed mandate invariants', () => {
  it('rejects a closed mandate with maxRedemptions > 1', () => {
    const mandate = { mode: 'closed', maxRedemptions: 2 } as unknown as PaymentMandate;
    expect(() => assertClosedMandateInvariants(mandate)).toThrow(/PMT-INV-14/);
  });

  it('accepts a closed mandate with maxRedemptions = 1', () => {
    const mandate = { mode: 'closed', maxRedemptions: 1 } as unknown as PaymentMandate;
    expect(() => assertClosedMandateInvariants(mandate)).not.toThrow();
  });

  it('accepts an open mandate with any maxRedemptions', () => {
    const mandate = { mode: 'open', maxRedemptions: 100 } as unknown as PaymentMandate;
    expect(() => assertClosedMandateInvariants(mandate)).not.toThrow();
  });
});

describe('computeMandateId', () => {
  it('is deterministic', () => {
    const args = {
      payer: '0x1111111111111111111111111111111111111111' as const,
      nonce: 7n,
      rail: 'wallet' as const,
      chain: 8453,
    };
    expect(computeMandateId(args)).toBe(computeMandateId(args));
  });
});

describe('rail registry', () => {
  it('registers + retrieves rails by name', () => {
    const stub = {
      rail: 'wallet' as const,
      async verifyMandate() {
        return { valid: true };
      },
      async prepareRedemption() {
        return { planId: ('0x' + '11'.repeat(32)) as `0x${string}`, details: {} };
      },
      async executeRedemption() {
        return {
          receiptHash: ('0x' + '22'.repeat(32)) as `0x${string}`,
          settlementHash: ('0x' + '33'.repeat(32)) as `0x${string}`,
        };
      },
    };
    registerRail(stub);
    expect(getRail('wallet')).toBe(stub);
  });
});
