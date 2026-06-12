// Spec 272 PAY-RAIL-1..6 — the staged x402 rail executor (verify → revoke-check → reserve → prepare →
// submit → receipt). Delegation-native settlement (X402-D2): the redemption is
// DelegationManager.redeemDelegation(paymentDelegation, USDC.transfer(treasury, amount)) gated by the
// on-chain PaymentEnforcer. This package owns the LOGIC; on-chain submission (a sponsored UserOp,
// X402-D4) + the revocation read are INJECTED (payments is type-only on delegation, forbids agent-account).

import { encodeAbiParameters, encodeFunctionData, keccak256, toHex, type Address, type Hex } from 'viem';
import type { Delegation } from '@agenticprimitives/delegation';
import { assertContextBindingValid, assertClosedMandateInvariants, type PaymentMandate } from '../../index.js';
import type { Hex32 } from './resource.js';
import type { PaymentQuote } from './quote.js';
import { fromCaip2 } from './quote.js';
import type { NonceReservationStore, SettledReceipt } from './nonce-store.js';

/** x402-specific bits the mandate carries (PaymentMandate.railConfig). Binds the mandate to its quote. */
export interface X402RailConfig {
  quoteId: Hex32;
  resourceHash: Hex32;
}

const TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

const DELEGATION_TUPLE = {
  name: 'delegations',
  type: 'tuple[]',
  components: [
    { name: 'delegator', type: 'address' },
    { name: 'delegate', type: 'address' },
    { name: 'authority', type: 'bytes32' },
    {
      name: 'caveats',
      type: 'tuple[]',
      components: [
        { name: 'enforcer', type: 'address' },
        { name: 'terms', type: 'bytes' },
        { name: 'args', type: 'bytes' },
      ],
    },
    { name: 'salt', type: 'uint256' },
    { name: 'signature', type: 'bytes' },
  ],
} as const;

const REDEEM_ABI = [
  {
    type: 'function',
    name: 'redeemDelegation',
    stateMutability: 'nonpayable',
    inputs: [
      DELEGATION_TUPLE,
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

/** PAY-RAIL-4 — the rail-scoped replay nullifier. */
export function computeNullifier(args: {
  rail: string;
  chainId: number;
  payer: Address;
  payee: Address;
  asset: Address;
  mandateId: Hex32;
  nonce: bigint;
  resourceHash: Hex32;
}): Hex32 {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'string' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'bytes32' },
      ],
      [args.rail, BigInt(args.chainId), args.payer, args.payee, args.asset, args.mandateId, args.nonce, args.resourceHash],
    ),
  );
}

/**
 * PAY-RAIL-1 — synchronous mandate verification against its persisted quote. Returns the first failure
 * reason (or null). The async checks (revocation, nonce-unused) run in the rail's settle() flow.
 */
export function verifyMandate(
  mandate: PaymentMandate,
  quote: PaymentQuote,
  opts: { now: number },
): { valid: true } | { valid: false; reason: string } {
  try {
    assertContextBindingValid(mandate.contextBinding);
    assertClosedMandateInvariants(mandate);
  } catch (e) {
    return { valid: false, reason: e instanceof Error ? e.message : 'invariant' };
  }
  if (mandate.mode !== 'closed') return { valid: false, reason: 'final charge requires a closed mandate' };
  if (mandate.maxRedemptions !== 1) return { valid: false, reason: 'closed mandate must be one-shot' };
  if (mandate.rail !== 'x402') return { valid: false, reason: `wrong rail ${mandate.rail}` };

  const rc = mandate.railConfig as X402RailConfig | undefined;
  if (!rc?.quoteId || rc.quoteId !== quote.quoteId) return { valid: false, reason: 'quote mismatch (quoteId)' };
  if (rc.resourceHash !== quote.resourceHash) return { valid: false, reason: 'quote mismatch (resourceHash)' };

  if (mandate.payee.toLowerCase() !== quote.payTo.toLowerCase()) return { valid: false, reason: 'payee != treasury' };
  if (mandate.amountPolicy.kind !== 'exact') return { valid: false, reason: 'flat per-call requires exact amountPolicy' };
  if (mandate.amountPolicy.amount !== quote.amount) return { valid: false, reason: 'amount mismatch' };
  if (mandate.amountPolicy.asset.id.toLowerCase() !== quote.asset.toLowerCase()) return { valid: false, reason: 'asset mismatch' };
  if (mandate.amountPolicy.chain !== fromCaip2(quote.network)) return { valid: false, reason: 'chain mismatch' };
  if (mandate.nonce !== quote.nonce) return { valid: false, reason: 'nonce mismatch' };
  if (mandate.expiresAt <= opts.now) return { valid: false, reason: 'mandate expired' };
  if (mandate.validFrom > opts.now) return { valid: false, reason: 'mandate not yet valid' };
  return { valid: true };
}

/**
 * PAY-RAIL-2 — build the redemption plan: DelegationManager.redeemDelegation(paymentDelegation,
 * USDC.transfer(treasury, amount)) with the PaymentEnforcer caveat's `args` filled with the mandate's
 * (mandateId, nonce, resourceHash) at REDEMPTION time. The caller submits `{to, value, data}` from the
 * service relayer as a sponsored UserOp.
 */
export function buildRedemptionCalldata(args: {
  mandate: PaymentMandate;
  delegation: Delegation;
  delegationManager: Address;
  paymentEnforcer: Address;
  asset: Address;
  resourceHash: Hex32;
}): { to: Address; value: bigint; data: Hex } {
  const amount = (args.mandate.amountPolicy as { amount: bigint }).amount;
  const transferData = encodeFunctionData({
    abi: TRANSFER_ABI,
    functionName: 'transfer',
    args: [args.mandate.payee, amount],
  });

  // Fill the PaymentEnforcer caveat's redeem-time args = abi.encode(mandateId, nonce, resourceHash).
  const enforcerArgs = encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }],
    [args.mandate.mandateId, toHex(args.mandate.nonce, { size: 32 }), args.resourceHash],
  );
  const pe = args.paymentEnforcer.toLowerCase();
  const caveats = args.delegation.caveats.map((c) =>
    c.enforcer.toLowerCase() === pe
      ? { enforcer: c.enforcer, terms: c.terms, args: enforcerArgs }
      : { enforcer: c.enforcer, terms: c.terms, args: c.args ?? '0x' },
  );

  const data = encodeFunctionData({
    abi: REDEEM_ABI,
    functionName: 'redeemDelegation',
    args: [
      [
        {
          delegator: args.delegation.delegator,
          delegate: args.delegation.delegate,
          authority: args.delegation.authority,
          caveats,
          salt: args.delegation.salt,
          signature: args.delegation.signature,
        },
      ],
      args.asset,
      0n,
      transferData,
    ],
  });
  return { to: args.delegationManager, value: 0n, data };
}

export interface X402RailDeps {
  chainId: number;
  delegationManager: Address;
  paymentEnforcer: Address;
  asset: Address; // USDC
  nonceStore: NonceReservationStore;
  /** Off-chain revocation read (the app wires `delegation.isRevoked`). Checked BEFORE settling; the DM
   *  also enforces revocation on-chain (PAY-DEL-3). */
  isRevoked: (delegationHash: Hex32) => Promise<boolean>;
  /** Submit the redemption (a sponsored UserOp from the service relayer, X402-D4). Injected by the app /
   *  agent-account layer; returns the settlement tx hash. */
  submitRedemption: (plan: { to: Address; value: bigint; data: Hex }) => Promise<{ settlementHash: Hex32 }>;
  /** PAY-RAIL-6 — dry-run the redemption (eth_call / estimateGas) BEFORE the nonce is burned, so a
   *  reverting or griefing settlement is rejected without consuming the one-shot mandate. Injected by
   *  the app; omit to skip simulation. Returns ok + optional gas estimate. */
  simulate?: (plan: { to: Address; value: bigint; data: Hex }) => Promise<{ ok: boolean; reason?: string; gas?: bigint }>;
  /** Anti-griefing: reject a settlement whose simulated gas exceeds this cap. */
  maxGasPerSettlement?: bigint;
  /** Anti-griefing: abort `submitRedemption` if it doesn't resolve within this many ms (settlement timeout). */
  settlementTimeoutMs?: number;
  now?: () => number;
}

export type SettleResult =
  | { ok: true; settlementHash: Hex32; mandateId: Hex32; idempotent: boolean }
  | { ok: false; reason: string };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`settlement timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** The staged x402 rail. `settle` runs verify → revoke → reserve(nullifier) → simulate → submit →
 *  receipt; a safe retry of an already-settled request returns the original receipt (idempotent). */
export function createX402Rail(deps: X402RailDeps) {
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));

  async function settle(input: { mandate: PaymentMandate; delegation: Delegation; quote: PaymentQuote }): Promise<SettleResult> {
    const { mandate, delegation, quote } = input;
    const v = verifyMandate(mandate, quote, { now: now() });
    if (!v.valid) return { ok: false, reason: v.reason };

    const delegationHash = mandate.delegationRef;
    if (delegationHash && (await deps.isRevoked(delegationHash))) return { ok: false, reason: 'payment delegation revoked' };

    const nullifier = computeNullifier({
      rail: 'x402',
      chainId: deps.chainId,
      payer: mandate.payer,
      payee: mandate.payee,
      asset: deps.asset,
      mandateId: mandate.mandateId,
      nonce: mandate.nonce,
      resourceHash: quote.resourceHash,
    });
    const reserved = await deps.nonceStore.reserve(nullifier);
    if (!reserved.ok) {
      if (reserved.state === 'settled' && reserved.receipt) {
        return { ok: true, settlementHash: reserved.receipt.settlementHash, mandateId: reserved.receipt.mandateId, idempotent: true };
      }
      return { ok: false, reason: `duplicate settlement (${reserved.state})` };
    }

    const plan = buildRedemptionCalldata({
      mandate,
      delegation,
      delegationManager: deps.delegationManager,
      paymentEnforcer: deps.paymentEnforcer,
      asset: deps.asset,
      resourceHash: quote.resourceHash,
    });

    // PAY-RAIL-6 — simulate before burning the nonce: a reverting or over-gas settlement is
    // rejected as RETRYABLE so the one-shot mandate survives for a corrected resubmit.
    if (deps.simulate) {
      const sim = await deps.simulate(plan);
      if (!sim.ok) {
        await deps.nonceStore.markFailed(nullifier, true);
        return { ok: false, reason: `simulation reverted${sim.reason ? `: ${sim.reason}` : ''}` };
      }
      if (deps.maxGasPerSettlement !== undefined && sim.gas !== undefined && sim.gas > deps.maxGasPerSettlement) {
        await deps.nonceStore.markFailed(nullifier, true);
        return { ok: false, reason: `settlement gas ${sim.gas} exceeds cap ${deps.maxGasPerSettlement}` };
      }
    }

    await deps.nonceStore.markSettling(nullifier);
    try {
      const submit = deps.submitRedemption(plan);
      const { settlementHash } = deps.settlementTimeoutMs
        ? await withTimeout(submit, deps.settlementTimeoutMs)
        : await submit;
      const receipt: SettledReceipt = { settlementHash, mandateId: mandate.mandateId };
      await deps.nonceStore.markSettled(nullifier, receipt);
      return { ok: true, settlementHash, mandateId: mandate.mandateId, idempotent: false };
    } catch (e) {
      await deps.nonceStore.markFailed(nullifier, true);
      return { ok: false, reason: e instanceof Error ? e.message : 'settlement failed' };
    }
  }

  return { rail: 'x402' as const, verifyMandate, settle };
}
