import { describe, it, expect } from 'vitest';
import { entitlement, type Hex32 } from '../../src/index.js';

const { voucher } = entitlement;

// one issued voucher, end-to-end
function issueOne(key = voucher.generateVoucherIssuerKey()) {
  const { request, secret } = voucher.blindVoucherRequest();
  const issued = voucher.issueVoucher(key, request);
  const v = voucher.unblindVoucher(secret, issued, key.publicKey);
  return { key, request, secret, issued, v };
}

describe('blind bearer vouchers (spec 272 §10 A3 — VOPRF)', () => {
  it('issue → unblind → verify a valid voucher', () => {
    const { key, v } = issueOne();
    expect(v.voucherId).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(voucher.verifyVoucher(key, v)).toEqual({ ok: true });
  });

  it('unlinkability: the blinded request is independent of the redeemed token', () => {
    const { request, v } = issueOne();
    // the issuer sees `request.blinded` at issuance and `v.tokenId`/`v.output` at redemption;
    // neither the token nor the voucherId appears in the blinded request.
    expect(request.blinded).not.toBe(v.tokenId);
    expect(request.blinded).not.toBe(v.output);
    expect(request.blinded).not.toContain(v.voucherId.slice(2));
  });

  it('a pack issues N independent unlinkable vouchers', () => {
    const key = voucher.generateVoucherIssuerKey();
    const reqs = Array.from({ length: 5 }, () => voucher.blindVoucherRequest());
    const issued = voucher.issueVouchers(key, reqs.map((r) => r.request));
    const vouchers = issued.map((iss, i) => voucher.unblindVoucher(reqs[i].secret, iss, key.publicKey));
    const ids = new Set(vouchers.map((v) => v.voucherId));
    expect(ids.size).toBe(5); // all distinct
    for (const v of vouchers) expect(voucher.verifyVoucher(key, v).ok).toBe(true);
  });

  it('double-spend rejected: first redeem ok, replay rejected', async () => {
    const { key, v } = issueOne();
    const spent = voucher.createMemorySpentSet();
    expect(await voucher.redeemVoucher(key, v, spent)).toEqual({ ok: true });
    expect(await voucher.redeemVoucher(key, v, spent)).toEqual({ ok: false, reason: 'voucher already spent' });
    expect(spent.size()).toBe(1);
  });

  it('forged output rejected (fail-closed)', () => {
    const { key, v } = issueOne();
    const forged = { ...v, output: ('0x' + 'aa'.repeat(64)) as typeof v.output };
    expect(voucher.verifyVoucher(key, forged).ok).toBe(false);
  });

  it('voucherId/tokenId mismatch rejected', () => {
    const { key, v } = issueOne();
    const tampered = { ...v, voucherId: ('0x' + 'cd'.repeat(32)) as Hex32 };
    expect(voucher.verifyVoucher(key, tampered)).toEqual({ ok: false, reason: 'voucherId does not match tokenId' });
  });

  it("another issuer's key cannot redeem a voucher", () => {
    const { v } = issueOne();
    const other = voucher.generateVoucherIssuerKey();
    expect(voucher.verifyVoucher(other, v).ok).toBe(false);
  });

  it('a malicious issuer using the wrong key is caught at unblind (VOPRF proof)', () => {
    const honest = voucher.generateVoucherIssuerKey();
    const evil = voucher.generateVoucherIssuerKey();
    const { request, secret } = voucher.blindVoucherRequest();
    // issuer signs with evil.secretKey but advertises honest.publicKey
    const issued = voucher.issueVoucher({ secretKey: evil.secretKey, publicKey: honest.publicKey }, request);
    expect(() => voucher.unblindVoucher(secret, issued, honest.publicKey)).toThrow();
  });

  it('deterministic issuer key from a seed', () => {
    const seed = ('0x' + '07'.repeat(32)) as Hex32;
    const a = voucher.deriveVoucherIssuerKey(seed);
    const b = voucher.deriveVoucherIssuerKey(seed);
    expect(a).toEqual(b);
  });
});
