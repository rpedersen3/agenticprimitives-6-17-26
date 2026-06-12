import { describe, it, expect } from 'vitest';
import {
  gateSkillPayment,
  x402AgentCardExtension,
  X402_EXTENSION_URI,
  buildPaymentRequiredMetadata,
  buildPaymentSettledMetadata,
  createA2aAgent,
  type SkillPayment,
  type PaymentGate,
  type A2aMessage,
  type SkillHandler,
} from '../../src/index.js';

const PRICE: SkillPayment = { rail: 'x402', price: { amount: '10000', asset: '0x05dc' }, payee: '0x7ee1' };
const MSG = { messageId: '0x01', sender: '0xabc', skill: 's', bodyRef: { id: 'r' }, bodyHash: '0x', signature: '0x', createdAt: 0 } as unknown as A2aMessage;

const okGate: PaymentGate = { async check() { return { satisfied: true, receiptRef: { settlementHash: '0xsettle' } }; } };
const needGate: PaymentGate = { async check() { return { satisfied: false, required: { quoteId: '0xq' } }; } };

describe('gateSkillPayment (PAY-A2A-3 middleware)', () => {
  it('free skill (no payment) proceeds', async () => {
    expect(await gateSkillPayment({ skill: 's', message: MSG })).toEqual({ proceed: true });
  });
  it('priced skill with no gate wired proceeds (opt-in)', async () => {
    expect(await gateSkillPayment({ payment: PRICE, skill: 's', message: MSG })).toEqual({ proceed: true });
  });
  it('priced + gate satisfied proceeds with receipt', async () => {
    const r = await gateSkillPayment({ payment: PRICE, gate: okGate, skill: 's', message: MSG });
    expect(r).toMatchObject({ proceed: true, receiptRef: { settlementHash: '0xsettle' } });
  });
  it('priced + gate unsatisfied parks input-required with x402.payment.required (handler never runs)', async () => {
    const r = await gateSkillPayment({ payment: PRICE, gate: needGate, skill: 's', message: MSG });
    expect(r.proceed).toBe(false);
    expect((r as { parkMetadata: Record<string, unknown> }).parkMetadata['x402.payment.status']).toBe('payment-required');
    expect((r as { parkMetadata: Record<string, unknown> }).parkMetadata['x402.payment.required']).toEqual({ quoteId: '0xq' });
  });
});

describe('metadata builders (PAY-A2A-2)', () => {
  it('required + settled shapes', () => {
    expect(buildPaymentRequiredMetadata({ q: 1 })['x402.payment.status']).toBe('payment-required');
    const s = buildPaymentSettledMetadata([{ h: '0x' }]);
    expect(s['x402.payment.status']).toBe('payment-completed');
    expect(s['x402.payment.receipts']).toHaveLength(1);
  });
});

describe('agent-card advertises priced skills (PAY-A2A-4)', () => {
  const base = {
    agentSA: '0x000000000000000000000000000000000000a5a5',
    chainId: 84532,
    delegationManager: '0x000000000000000000000000000000000000d111',
    enforcers: {} as never,
    taskStore: { async get() { return undefined; }, async put() {}, async listDue() { return []; } } as never,
    checks: {} as never,
    vault: {} as never,
    mcp: {} as never,
    hashBody: () => '0x00' as const,
  };
  const priced: SkillHandler = { skill: 'get-resource', payment: PRICE, async handle() { return { state: 'completed' }; } };
  const free: SkillHandler = { skill: 'ping', async handle() { return { state: 'completed' }; } };

  it('declares the x402 extension + per-skill price when a handler is priced', () => {
    const card = createA2aAgent({ ...base, handlers: [priced, free] } as never).agentCard();
    expect(card.capabilities.extensions).toEqual([x402AgentCardExtension()]);
    expect(card.capabilities.extensions![0]!.uri).toBe(X402_EXTENSION_URI);
    const pricedSkill = card.skills.find((s) => s.id === 'get-resource')!;
    expect(pricedSkill.payment).toEqual(PRICE);
    expect(card.skills.find((s) => s.id === 'ping')!.payment).toBeUndefined();
  });

  it('omits the extension when no skill is priced', () => {
    const card = createA2aAgent({ ...base, handlers: [free] } as never).agentCard();
    expect(card.capabilities.extensions).toBeUndefined();
  });
});
