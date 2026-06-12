/**
 * Payment ops core (spec 243 §5.5) — the plumbing every mature payment stack needs:
 * an idempotent event model + webhook-style subscribers, reconciliation/payment-detection,
 * and receipt export. In-process for W1 (the app delivers webhooks later). Pure — no I/O.
 */

import type { Address } from '@agenticprimitives/types';
import type { Hex32 } from './index.js';

export type PaymentEventType =
  | 'payment.created'
  | 'payment.reserved'
  | 'payment.settling'
  | 'payment.settled'
  | 'payment.failed'
  | 'payment.refunded'
  | 'payment.expired'
  | 'payment.disputed'
  | 'entitlement.issued'
  | 'entitlement.consumed';

export interface PaymentEvent {
  /** dedupe key — re-emitting the same key is a no-op (at-least-once producers, exactly-once consumers) */
  idempotencyKey: string;
  type: PaymentEventType;
  at: number;
  orderHash?: Hex32;
  mandateId?: Hex32;
  data?: Record<string, unknown>;
}

export interface PaymentEventLog {
  /** Returns `{ accepted: false }` when `idempotencyKey` was already seen (no re-emit, no re-notify). */
  emit(event: PaymentEvent): { accepted: boolean };
  list(): PaymentEvent[];
  byType(type: PaymentEventType): PaymentEvent[];
  byOrder(orderHash: Hex32): PaymentEvent[];
  /** Webhook-style subscriber — invoked once per ACCEPTED event. Returns an unsubscribe fn. */
  subscribe(fn: (event: PaymentEvent) => void): () => void;
}

export function createPaymentEventLog(): PaymentEventLog {
  const events: PaymentEvent[] = [];
  const seen = new Set<string>();
  const subs = new Set<(e: PaymentEvent) => void>();
  return {
    emit(event) {
      if (seen.has(event.idempotencyKey)) return { accepted: false };
      seen.add(event.idempotencyKey);
      events.push(event);
      for (const fn of subs) fn(event);
      return { accepted: true };
    },
    list: () => [...events],
    byType: (type) => events.filter((e) => e.type === type),
    byOrder: (orderHash) => events.filter((e) => e.orderHash?.toLowerCase() === orderHash.toLowerCase()),
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

// ── reconciliation / payment detection ──────────────────────────────

export interface ReceiptRow {
  mandateId: Hex32;
  payer: Address;
  payee: Address;
  asset: Address;
  amount: bigint;
  settlementHash: Hex32;
  at: number;
  orderHash?: Hex32;
  /** set on a refund leg — the original charge it reverses */
  refunds?: Hex32;
}

export interface ReceiptFilter {
  payer?: Address;
  payee?: Address;
  orderHash?: Hex32;
  asset?: Address;
}

const eq = (a?: string, b?: string) => (a && b ? a.toLowerCase() === b.toLowerCase() : a === b);

export function listReceiptsBy(receipts: ReceiptRow[], filter: ReceiptFilter): ReceiptRow[] {
  return receipts.filter(
    (r) =>
      (filter.payer === undefined || eq(r.payer, filter.payer)) &&
      (filter.payee === undefined || eq(r.payee, filter.payee)) &&
      (filter.asset === undefined || eq(r.asset, filter.asset)) &&
      (filter.orderHash === undefined || eq(r.orderHash, filter.orderHash)),
  );
}

/** Net balance change for `account` across the receipt set (incoming as payee − outgoing as payer). */
export function balanceDelta(receipts: ReceiptRow[], account: Address): bigint {
  let delta = 0n;
  for (const r of receipts) {
    if (eq(r.payee, account)) delta += r.amount;
    if (eq(r.payer, account)) delta -= r.amount;
  }
  return delta;
}

/** Payment detection: is `orderHash` paid (optionally to ≥ `expectedAmount`)? From receipts, not logs. */
export function isOrderPaid(receipts: ReceiptRow[], orderHash: Hex32, expectedAmount?: bigint): boolean {
  const charges = receipts.filter((r) => eq(r.orderHash, orderHash) && !r.refunds);
  if (charges.length === 0) return false;
  if (expectedAmount === undefined) return true;
  const total = charges.reduce((s, r) => s + r.amount, 0n);
  return total >= expectedAmount;
}

// ── export ──────────────────────────────────────────────────────────

export function exportReceiptsJSON(receipts: ReceiptRow[]): string {
  return JSON.stringify(
    receipts.map((r) => ({ ...r, amount: r.amount.toString() })),
    null,
    2,
  );
}

export function exportReceiptsCSV(receipts: ReceiptRow[]): string {
  const header = 'mandateId,payer,payee,asset,amount,settlementHash,at,orderHash,refunds';
  const rows = receipts.map((r) =>
    [r.mandateId, r.payer, r.payee, r.asset, r.amount.toString(), r.settlementHash, r.at, r.orderHash ?? '', r.refunds ?? ''].join(','),
  );
  return [header, ...rows].join('\n');
}
