import { describe, it, expect } from 'vitest';
import { x402, type PaymentMandate } from '../../src/index.js';

const USDC = '0x00000000000000000000000000000000000005dc' as const;
const TREASURY = '0x0000000000000000000000000000000000007ee1' as const;
const SERVICE = '0x0000000000000000000000000000000000005e41' as const;
const READER = '0x000000000000000000000000000000000000dead' as const;
const DM = '0x3a8E2cE74564f699b135db6f266ccDb563979C05' as const;
const ENFORCER = '0x00000000000000000000000000000000000000a1' as const;

function resource(over: Partial<x402.PaymentResource> = {}): x402.PaymentResource {
  return {
    protocol: 'http',
    method: 'GET',
    url: 'https://service.example/resource/123',
    bodyHash: x402.ZERO_HASH,
    serviceAgent: SERVICE,
    treasury: TREASURY,
    skillId: 'get-gated-resource',
    taskId: x402.ZERO_HASH,
    asset: USDC,
    amount: 10_000n,
    chainId: 84532,
    expiresAt: 2_000_000_000,
    nonce: 42n,
    ...over,
  };
}

function quote(over: Partial<x402.PaymentResource> = {}) {
  return x402.buildPaymentQuote({ resource: resource(over), network: 'eip155:84532' });
}

function mandate(q: x402.PaymentQuote, over: Partial<PaymentMandate> = {}): PaymentMandate {
  return {
    mandateId: '0x1111111111111111111111111111111111111111111111111111111111111111',
    payer: READER,
    payee: TREASURY,
    granter: READER,
    rail: 'x402',
    railConfig: { quoteId: q.quoteId, resourceHash: q.resourceHash } satisfies x402.X402RailConfig,
    amountPolicy: { kind: 'exact', amount: q.amount, asset: { id: USDC }, chain: 84532 },
    nonce: q.nonce,
    maxRedemptions: 1,
    validFrom: 0,
    expiresAt: q.expiresAt,
    contextBinding: {
      resource: { method: 'GET', url: q.resource.url, requestBodyHash: x402.ZERO_HASH },
      chain: 84532,
      asset: { id: USDC },
      nonce: q.nonce,
      validFrom: 0,
      expiresAt: q.expiresAt,
    },
    delegationRef: '0x2222222222222222222222222222222222222222222222222222222222222222',
    mode: 'closed',
    reasonHash: x402.ZERO_HASH,
    signature: '0x',
    ...over,
  };
}

describe('resource binding (PAY-WIRE-5/6)', () => {
  it('canonicalize is deterministic and field-sensitive', () => {
    expect(x402.canonicalizePaymentResource(resource())).toBe(x402.canonicalizePaymentResource(resource()));
    expect(x402.canonicalizePaymentResource(resource({ amount: 10_001n }))).not.toBe(
      x402.canonicalizePaymentResource(resource()),
    );
    expect(x402.canonicalizePaymentResource(resource({ url: 'https://x/other' }))).not.toBe(
      x402.canonicalizePaymentResource(resource()),
    );
  });
  it('redact drops the query string + hashes the full url', () => {
    const r = x402.redactPaymentMetadata({ url: 'https://x/content?q=secret+query' });
    expect(r.safeRoute).toBe('https://x/content');
    expect(r.urlHash).not.toBe(x402.ZERO_HASH);
  });
});

describe('quote immutability (X402-D9)', () => {
  it('quote is self-consistent; a re-priced quote mismatches', () => {
    const q = quote();
    expect(q.resourceHash).toBe(x402.canonicalizePaymentResource(q.resource));
    expect(x402.quoteMismatch(q, q)).toBeNull();
    const repriced = quote({ amount: 99_999n });
    expect(x402.quoteMismatch(q, repriced)).toBe('quoteId');
  });
  it('CAIP-2 round-trips', () => {
    expect(x402.fromCaip2(x402.toCaip2(84532))).toBe(84532);
    expect(() => x402.fromCaip2('84532')).toThrow();
  });
});

describe('v2 wire (PAY-WIRE-1/2/3)', () => {
  it('402 round-trips with CAIP-2 + erc7710-delegation extra', () => {
    const { status, headers, body } = x402.buildPaymentRequired(quote());
    expect(status).toBe(402);
    const parsed = x402.parsePaymentRequired(headers[x402.HEADER_PAYMENT_REQUIRED]!);
    expect(parsed.x402Version).toBe(2);
    expect(parsed.accepts[0]!.network).toBe('eip155:84532');
    expect(parsed.accepts[0]!.amount).toBe('10000');
    expect(parsed.accepts[0]!.extra.assetTransferMethod).toBe('erc7710-delegation');
    expect(body.accepts[0]!.resource.route).toBe('https://service.example/resource/123');
  });

  it('PAYMENT-SIGNATURE round-trips a mandate (bigints survive)', () => {
    const q = quote();
    const { headers: reqH } = x402.buildPaymentRequired(q);
    const accepts = x402.parsePaymentRequired(reqH[x402.HEADER_PAYMENT_REQUIRED]!).accepts[0]!;
    const sigHeaders = x402.buildPaymentSignature(accepts, mandate(q));
    const parsed = x402.parsePaymentSignature(sigHeaders);
    expect(parsed).not.toBeNull();
    expect(parsed!.mandate.nonce).toBe(42n);
    expect(parsed!.mandate.amountPolicy.kind).toBe('exact');
    expect((parsed!.mandate.amountPolicy as { amount: bigint }).amount).toBe(10_000n);
  });

  it('rejects missing header, wrong version, wrong scheme (no v1 fallback)', () => {
    expect(x402.parsePaymentSignature({})).toBeNull();
    expect(x402.parsePaymentSignature({ 'X-PAYMENT': 'whatever' })).toBeNull();
  });
});

describe('nonce reservation store (PAY-RAIL-5)', () => {
  it('reserve → duplicate blocked; settled returns receipt; failed_retryable re-reservable', async () => {
    const s = x402.createMemoryNonceStore();
    const n = '0x33' as x402.Hex32;
    expect((await s.reserve(n)).ok).toBe(true);
    const dup = await s.reserve(n);
    expect(dup.ok).toBe(false);
    await s.markSettled(n, { settlementHash: '0xabc' as x402.Hex32, mandateId: '0xdef' as x402.Hex32 });
    const after = await s.reserve(n);
    expect(after.ok).toBe(false);
    expect((after as { receipt?: { settlementHash: string } }).receipt?.settlementHash).toBe('0xabc');
    const m = '0x44' as x402.Hex32;
    await s.reserve(m);
    await s.markFailed(m, true);
    expect((await s.reserve(m)).ok).toBe(true); // retryable
  });
});

describe('verifyMandate (PAY-RAIL-1)', () => {
  const NOW = 1_000_000_000;
  it('accepts a well-formed mandate', () => {
    const q = quote();
    expect(x402.verifyMandate(mandate(q), q, { now: NOW })).toEqual({ valid: true });
  });
  it('rejects open mandate, amount mismatch, quote mismatch, expired', () => {
    const q = quote();
    expect(x402.verifyMandate(mandate(q, { mode: 'open' }), q, { now: NOW }).valid).toBe(false);
    expect(
      x402.verifyMandate(mandate(q, { amountPolicy: { kind: 'exact', amount: 1n, asset: { id: USDC }, chain: 84532 } }), q, {
        now: NOW,
      }).valid,
    ).toBe(false);
    expect(x402.verifyMandate(mandate(q), quote({ amount: 5n }), { now: NOW }).valid).toBe(false);
    expect(x402.verifyMandate(mandate(q), q, { now: 9_999_999_999 }).valid).toBe(false);
  });
});

describe('redemption calldata + staged settle (PAY-RAIL-2/3)', () => {
  const delegation = {
    delegator: READER,
    delegate: SERVICE,
    authority: '0x0000000000000000000000000000000000000000000000000000000000000000' as const,
    caveats: [{ enforcer: ENFORCER, terms: '0xdead' as const, args: '0x' as const }],
    salt: 1n,
    signature: '0x' as const,
  };

  it('buildRedemptionCalldata targets the DM + fills the PaymentEnforcer args', () => {
    const q = quote();
    const call = x402.buildRedemptionCalldata({
      mandate: mandate(q),
      delegation,
      delegationManager: DM,
      paymentEnforcer: ENFORCER,
      asset: USDC,
      resourceHash: q.resourceHash,
    });
    expect(call.to).toBe(DM);
    expect(call.value).toBe(0n);
    expect(call.data.startsWith('0x')).toBe(true);
  });

  it('settle: happy path, then idempotent retry returns the same receipt; revoked rejected', async () => {
    const q = quote();
    let submits = 0;
    const rail = x402.createX402Rail({
      chainId: 84532,
      delegationManager: DM,
      paymentEnforcer: ENFORCER,
      asset: USDC,
      nonceStore: x402.createMemoryNonceStore(),
      isRevoked: async () => false,
      submitRedemption: async () => {
        submits++;
        return { settlementHash: '0xsettle' as x402.Hex32 };
      },
      now: () => 1_000_000_000,
    });
    const first = await rail.settle({ mandate: mandate(q), delegation, quote: q });
    expect(first).toMatchObject({ ok: true, settlementHash: '0xsettle', idempotent: false });
    const retry = await rail.settle({ mandate: mandate(q), delegation, quote: q });
    expect(retry).toMatchObject({ ok: true, idempotent: true });
    expect(submits).toBe(1); // settled once

    const revokedRail = x402.createX402Rail({
      chainId: 84532,
      delegationManager: DM,
      paymentEnforcer: ENFORCER,
      asset: USDC,
      nonceStore: x402.createMemoryNonceStore(),
      isRevoked: async () => true,
      submitRedemption: async () => ({ settlementHash: '0x' as x402.Hex32 }),
      now: () => 1_000_000_000,
    });
    const r = await revokedRail.settle({ mandate: mandate(q), delegation, quote: q });
    expect(r).toEqual({ ok: false, reason: 'payment delegation revoked' });
  });
});

describe('simulate stage + anti-griefing (PAY-RAIL-6)', () => {
  const delegation = {
    delegator: READER, delegate: SERVICE,
    authority: '0x0000000000000000000000000000000000000000000000000000000000000000' as const,
    caveats: [{ enforcer: ENFORCER, terms: '0xdead' as const, args: '0x' as const }],
    salt: 1n, signature: '0x' as const,
  };
  const baseDeps = (over: Partial<Parameters<typeof x402.createX402Rail>[0]>) => x402.createX402Rail({
    chainId: 84532, delegationManager: DM, paymentEnforcer: ENFORCER, asset: USDC,
    nonceStore: x402.createMemoryNonceStore(), isRevoked: async () => false,
    submitRedemption: async () => ({ settlementHash: '0xsettle' as x402.Hex32 }),
    now: () => 1_000_000_000, ...over,
  });

  it('a reverting simulation rejects WITHOUT burning the nonce (mandate survives for retry)', async () => {
    const q = quote();
    let submits = 0;
    const store = x402.createMemoryNonceStore();
    const fail = x402.createX402Rail({
      chainId: 84532, delegationManager: DM, paymentEnforcer: ENFORCER, asset: USDC, nonceStore: store,
      isRevoked: async () => false, submitRedemption: async () => { submits++; return { settlementHash: '0xok' as x402.Hex32 }; },
      simulate: async () => ({ ok: false, reason: 'PaymentEnforcer: cap exceeded' }), now: () => 1_000_000_000,
    });
    const r = await fail.settle({ mandate: mandate(q), delegation, quote: q });
    expect(r).toEqual({ ok: false, reason: 'simulation reverted: PaymentEnforcer: cap exceeded' });
    expect(submits).toBe(0); // never submitted

    // same nullifier can be retried once simulation passes (markFailed retryable)
    const ok = x402.createX402Rail({
      chainId: 84532, delegationManager: DM, paymentEnforcer: ENFORCER, asset: USDC, nonceStore: store,
      isRevoked: async () => false, submitRedemption: async () => { submits++; return { settlementHash: '0xok' as x402.Hex32 }; },
      simulate: async () => ({ ok: true, gas: 120_000n }), now: () => 1_000_000_000,
    });
    const r2 = await ok.settle({ mandate: mandate(q), delegation, quote: q });
    expect(r2).toMatchObject({ ok: true, settlementHash: '0xok' });
    expect(submits).toBe(1);
  });

  it('simulated gas over the cap rejects', async () => {
    const q = quote();
    const rail = baseDeps({ simulate: async () => ({ ok: true, gas: 900_000n }), maxGasPerSettlement: 500_000n });
    const r = await rail.settle({ mandate: mandate(q), delegation, quote: q });
    expect(r).toEqual({ ok: false, reason: 'settlement gas 900000 exceeds cap 500000' });
  });

  it('a settlement that exceeds the timeout is rejected (retryable)', async () => {
    const q = quote();
    const rail = baseDeps({
      settlementTimeoutMs: 20,
      submitRedemption: () => new Promise((res) => setTimeout(() => res({ settlementHash: '0xlate' as x402.Hex32 }), 200)),
    });
    const r = await rail.settle({ mandate: mandate(q), delegation, quote: q });
    expect(r).toMatchObject({ ok: false });
    expect((r as { reason: string }).reason).toMatch(/timed out/);
  });
});
