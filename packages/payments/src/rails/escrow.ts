/**
 * Escrow rail (spec 243 §5.5, over PaymentEscrow.sol) — hold-and-capture for an order.
 *
 * Powers the deliver-then-pay flow: payer deposits a hold keyed by `orderHash` → provider
 * fulfils → `release` captures to the payee (and the app mints the entitlement, pay-AFTER-
 * fulfillment) → on failure/expiry `refund`/`reclaim` returns the funds. Builders emit the
 * `{to: escrow, value, data}` calls an SA executes; deposit needs a prior `approve`
 * (`buildErc20Approve`). App reads hold state via `getHold` (readContract), not log scans.
 */

import { encodeFunctionData, type Address } from 'viem';
import type { TransferPlan } from '../transfer.js';
import type { Hex32 } from '../index.js';

/** Mirrors PaymentEscrow.Status. */
export enum EscrowStatus {
  None = 0,
  Held = 1,
  Captured = 2,
  Refunded = 3,
  Reclaimed = 4,
}

export const ESCROW_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'orderHash', type: 'bytes32' },
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'payee', type: 'address' },
      { name: 'refundTo', type: 'address' },
      { name: 'releaser', type: 'address' },
      { name: 'expiry', type: 'uint64' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'release', stateMutability: 'nonpayable', inputs: [{ name: 'orderHash', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'refund', stateMutability: 'nonpayable', inputs: [{ name: 'orderHash', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'reclaim', stateMutability: 'nonpayable', inputs: [{ name: 'orderHash', type: 'bytes32' }], outputs: [] },
  {
    type: 'function',
    name: 'getHold',
    stateMutability: 'view',
    inputs: [{ name: 'orderHash', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'payer', type: 'address' },
          { name: 'asset', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'payee', type: 'address' },
          { name: 'refundTo', type: 'address' },
          { name: 'releaser', type: 'address' },
          { name: 'expiry', type: 'uint64' },
          { name: 'status', type: 'uint8' },
        ],
      },
    ],
  },
  { type: 'function', name: 'statusOf', stateMutability: 'view', inputs: [{ name: 'orderHash', type: 'bytes32' }], outputs: [{ type: 'uint8' }] },
] as const;

export interface EscrowDepositInput {
  escrow: Address;
  orderHash: Hex32;
  asset: Address;
  amount: bigint;
  payee: Address;
  /** where refund/reclaim returns; defaults on-chain to the payer (msg.sender) when zero */
  refundTo?: Address;
  /** extra address allowed to release besides the payee; 0 = payee-only */
  releaser?: Address;
  expiry: number;
}

const ZERO = '0x0000000000000000000000000000000000000000' as Address;

/** The deposit call (the payer SA must `approve` the escrow for `asset` first). */
export function buildEscrowDeposit(input: EscrowDepositInput): TransferPlan {
  return {
    to: input.escrow,
    value: 0n,
    data: encodeFunctionData({
      abi: ESCROW_ABI,
      functionName: 'deposit',
      args: [input.orderHash, input.asset, input.amount, input.payee, input.refundTo ?? ZERO, input.releaser ?? ZERO, BigInt(input.expiry)],
    }),
  };
}

function call(escrow: Address, fn: 'release' | 'refund' | 'reclaim', orderHash: Hex32): TransferPlan {
  return { to: escrow, value: 0n, data: encodeFunctionData({ abi: ESCROW_ABI, functionName: fn, args: [orderHash] }) };
}

/** Capture the hold to the payee (payee or configured releaser executes). */
export function buildEscrowRelease(escrow: Address, orderHash: Hex32): TransferPlan {
  return call(escrow, 'release', orderHash);
}
/** Payee-consented refund to the payer, before capture. */
export function buildEscrowRefund(escrow: Address, orderHash: Hex32): TransferPlan {
  return call(escrow, 'refund', orderHash);
}
/** Payer reclaims after expiry (never released). */
export function buildEscrowReclaim(escrow: Address, orderHash: Hex32): TransferPlan {
  return call(escrow, 'reclaim', orderHash);
}
