import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { recoverAddress, type Address, type Hex } from 'viem';
import {
  type PaymentMandate,
  buildPaymentMandateTypedData,
  paymentMandateDigest,
  hashContextBinding,
  mandateAmount,
  signPaymentMandate,
  verifyPaymentMandateSignature,
  ERC1271_MAGIC,
  buildPaymentReceiptCredential,
  settlementEpochBucket,
  type Hex32,
} from '../../src/index.js';

const USDC = '0x00000000000000000000000000000000000005dc' as const;
const TREASURY = '0x0000000000000000000000000000000000007ee1' as const;
const Z = ('0x' + '00'.repeat(32)) as Hex32;

const eoa = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

function mandate(over: Partial<PaymentMandate> = {}): PaymentMandate {
  return {
    mandateId: ('0x' + '11'.repeat(32)) as Hex32,
    payer: eoa.address,
    payee: TREASURY,
    granter: eoa.address,
    rail: 'x402',
    amountPolicy: { kind: 'exact', amount: 10_000n, asset: { id: USDC, symbol: 'USDC', decimals: 6 }, chain: 84532 },
    nonce: 42n,
    maxRedemptions: 1,
    validFrom: 0,
    expiresAt: 2_000_000_000,
    contextBinding: {
      resource: { method: 'GET', url: 'https://svc.example/r/1', requestBodyHash: Z },
      orderHash: ('0x' + 'ab'.repeat(32)) as Hex32,
      chain: 84532,
      asset: { id: USDC },
      nonce: 42n,
      validFrom: 0,
      expiresAt: 2_000_000_000,
    },
    mode: 'closed',
    reasonHash: Z,
    signature: '0x',
    ...over,
  };
}

const opts = { chainId: 84532 };

describe('mandate EIP-712 sign/verify (PMT-INV-02/12)', () => {
  it('builds typed data with the mandate domain + primaryType', () => {
    const td = buildPaymentMandateTypedData(mandate(), opts);
    expect(td.domain.name).toBe('AgenticPaymentMandate');
    expect(td.domain.chainId).toBe(84532);
    expect(td.primaryType).toBe('PaymentMandate');
    expect(td.message.amount).toBe(10_000n);
    expect(td.message.payer).toBe(eoa.address);
  });

  it('digest is deterministic', () => {
    expect(paymentMandateDigest(mandate(), opts)).toBe(paymentMandateDigest(mandate(), opts));
  });

  it('context-binding hash covers every field (no field-strip / substitution)', () => {
    const base = hashContextBinding(mandate().contextBinding);
    const changedOrder = hashContextBinding(mandate({}).contextBinding);
    expect(changedOrder).toBe(base); // same input → same hash
    // mutate each load-bearing field → hash must change
    const m = mandate();
    expect(hashContextBinding({ ...m.contextBinding, orderHash: ('0x' + 'cd'.repeat(32)) as Hex32 })).not.toBe(base);
    expect(hashContextBinding({ ...m.contextBinding, nonce: 999n })).not.toBe(base);
    expect(hashContextBinding({ ...m.contextBinding, legId: ('0x' + '01'.repeat(32)) as Hex32 })).not.toBe(base);
    expect(hashContextBinding({ ...m.contextBinding, resource: { method: 'POST', url: 'https://svc.example/r/1', requestBodyHash: Z } })).not.toBe(base);
  });

  it('changing the signed amount/payee changes the digest', () => {
    const base = paymentMandateDigest(mandate(), opts);
    expect(paymentMandateDigest(mandate({ payee: USDC }), opts)).not.toBe(base);
    expect(paymentMandateDigest(mandate({ amountPolicy: { kind: 'exact', amount: 1n, asset: { id: USDC }, chain: 84532 } }), opts)).not.toBe(base);
  });

  it('verifyingContract scopes the domain', () => {
    const a = paymentMandateDigest(mandate(), { chainId: 84532 });
    const b = paymentMandateDigest(mandate(), { chainId: 84532, verifyingContract: TREASURY as Address });
    expect(a).not.toBe(b);
  });

  it('sign → ERC-1271 verify roundtrip (recovering reader returns the magic value)', async () => {
    const signed = await signPaymentMandate(mandate(), { signTypedData: (a) => eoa.signTypedData(a as never) }, opts);
    expect(signed.signature).not.toBe('0x');
    // stub ERC-1271: the SA accepts the controlling EOA's ECDSA over the digest
    const read1271 = async (account: Address, digest: Hex32, signature: Hex) =>
      (await recoverAddress({ hash: digest, signature })).toLowerCase() === account.toLowerCase() ? ERC1271_MAGIC : '0x';
    expect(await verifyPaymentMandateSignature(signed, opts, read1271)).toBe(true);
  });

  it('fail-closed: empty sig, wrong-magic, and throwing reader all reject', async () => {
    const signed = await signPaymentMandate(mandate(), { signTypedData: (a) => eoa.signTypedData(a as never) }, opts);
    expect(await verifyPaymentMandateSignature(mandate(), opts, async () => ERC1271_MAGIC)).toBe(false); // sig '0x'
    expect(await verifyPaymentMandateSignature(signed, opts, async () => '0xffffffff')).toBe(false); // not magic
    expect(await verifyPaymentMandateSignature(signed, opts, async () => { throw new Error('rpc down'); })).toBe(false);
  });

  it('mandateAmount reads exact + range', () => {
    expect(mandateAmount(mandate())).toBe(10_000n);
    expect(mandateAmount(mandate({ amountPolicy: { kind: 'range', minAmount: 1n, maxAmount: 5n, asset: { id: USDC }, chain: 84532 } }))).toBe(5n);
  });
});

describe('PaymentReceipt VC (spec 243 §7)', () => {
  it('builds the receipt subject from the mandate', () => {
    const vc = buildPaymentReceiptCredential({
      mandate: mandate(),
      issuer: TREASURY as Address,
      settlementHash: ('0x' + 'fe'.repeat(32)) as Hex32,
      settledAt: '2026-06-12T00:00:00.000Z',
    });
    expect(vc.type).toEqual(['VerifiableCredential', 'PaymentReceipt']);
    const s = vc.credentialSubject as Record<string, unknown>;
    expect(s.id).toBe(eoa.address);
    expect(s.amount).toBe('10000'); // stringified for JSON safety
    expect(s.payee).toBe(TREASURY);
    expect(s.contextBindingHash).toBe(hashContextBinding(mandate().contextBinding));
    expect(s.provenance).toBeUndefined();
  });

  it('a refund leg carries provenance to the original mandate', () => {
    const orig = ('0x' + '11'.repeat(32)) as Hex32;
    const vc = buildPaymentReceiptCredential({
      mandate: mandate(),
      issuer: TREASURY as Address,
      settlementHash: ('0x' + 'fe'.repeat(32)) as Hex32,
      settledAt: '2026-06-12T00:00:00.000Z',
      refundsMandateId: orig,
    });
    expect((vc.credentialSubject as Record<string, unknown>).provenance).toEqual({ refunds: orig });
  });

  it('epoch bucket coarsens to UTC day', () => {
    expect(settlementEpochBucket(86_400)).toBe(1);
    expect(settlementEpochBucket(86_400 + 3600)).toBe(1);
    expect(settlementEpochBucket(86_399)).toBe(0);
  });
});
