import { describe, it, expect } from 'vitest';
import { entitlement, type Hex32 } from '../../src/index.js';

const SA = '0x000000000000000000000000000000000000dead' as const;
const OTHER = '0x000000000000000000000000000000000000beef' as const;
const MANDATE = ('0x' + '11'.repeat(32)) as Hex32;
const SETTLE = ('0x' + 'fe'.repeat(32)) as Hex32;
const scope = entitlement.scopeHashOf('get-gated-resource');

function saEnt(over: Partial<Parameters<typeof entitlement.mintEntitlementOnPayment>[0]> = {}) {
  return entitlement.mintEntitlementOnPayment({
    binding: 'sa', scopeHash: scope, subject: SA, ttl: 2_000_000_000, maxUses: 3, mandateId: MANDATE, settlementHash: SETTLE, ...over,
  });
}

describe('entitlements (spec 272 §10)', () => {
  it('mints with usesLeft = maxUses + provenance', () => {
    const e = saEnt();
    expect(e.usesLeft).toBe(3);
    expect(e.binding).toBe('sa');
    expect(e.provenance).toEqual({ mandateId: MANDATE, settlementHash: SETTLE });
  });

  it('consume decrements; exhausts after maxUses (one access lane)', () => {
    let e = saEnt({ maxUses: 2 });
    const ctx = { scopeHash: scope, now: 1000, presenter: SA };
    let r = entitlement.consumeEntitlement(e, ctx); expect(r.ok).toBe(true); e = (r as { record: typeof e }).record;
    r = entitlement.consumeEntitlement(e, ctx); expect(r.ok).toBe(true); e = (r as { record: typeof e }).record;
    r = entitlement.consumeEntitlement(e, ctx);
    expect(r).toEqual({ ok: false, reason: 'entitlement exhausted' });
  });

  it("'sa' binding: only the subject SA may present (fail-closed)", () => {
    const e = saEnt();
    expect(entitlement.checkEntitlement(e, { scopeHash: scope, now: 1000, presenter: OTHER })).toEqual({ ok: false, reason: 'presenter is not the entitlement subject' });
    expect(entitlement.checkEntitlement(e, { scopeHash: scope, now: 1000 })).toEqual({ ok: false, reason: 'presenter is not the entitlement subject' });
    expect(entitlement.checkEntitlement(e, { scopeHash: scope, now: 1000, presenter: SA }).ok).toBe(true);
  });

  it('scope mismatch + expiry deny', () => {
    const e = saEnt();
    expect(entitlement.checkEntitlement(e, { scopeHash: entitlement.scopeHashOf('other'), now: 1000, presenter: SA })).toEqual({ ok: false, reason: 'scope mismatch' });
    expect(entitlement.checkEntitlement(e, { scopeHash: scope, now: 2_000_000_001, presenter: SA })).toEqual({ ok: false, reason: 'entitlement expired' });
  });

  it("'bearer' binding gates on voucherId, not the presenter", () => {
    const voucherId = ('0x' + 'ab'.repeat(32)) as Hex32;
    const e = entitlement.mintEntitlementOnPayment({ binding: 'bearer', scopeHash: scope, voucherId, ttl: 2_000_000_000, maxUses: 1, mandateId: MANDATE, settlementHash: SETTLE });
    expect(entitlement.checkEntitlement(e, { scopeHash: scope, now: 1000, voucherId }).ok).toBe(true);
    expect(entitlement.checkEntitlement(e, { scopeHash: scope, now: 1000, voucherId: ('0x' + 'cd'.repeat(32)) as Hex32 })).toEqual({ ok: false, reason: 'voucher mismatch' });
    expect(entitlement.checkEntitlement(e, { scopeHash: scope, now: 1000, presenter: SA })).toEqual({ ok: false, reason: 'voucher mismatch' });
  });

  it('credits = an SA entitlement with maxUses = count', () => {
    const c = entitlement.mintCredits({ scopeHash: scope, subject: SA, count: 10, ttl: 2_000_000_000, mandateId: MANDATE, settlementHash: SETTLE });
    expect(c.binding).toBe('sa');
    expect(c.maxUses).toBe(10);
    expect(c.usesLeft).toBe(10);
  });

  it('missing required handle throws at mint', () => {
    expect(() => entitlement.mintEntitlementOnPayment({ binding: 'sa', scopeHash: scope, ttl: 1, maxUses: 1, mandateId: MANDATE, settlementHash: SETTLE })).toThrow(/subject/);
    expect(() => entitlement.mintEntitlementOnPayment({ binding: 'bearer', scopeHash: scope, ttl: 1, maxUses: 1, mandateId: MANDATE, settlementHash: SETTLE })).toThrow(/voucherId/);
  });
});
