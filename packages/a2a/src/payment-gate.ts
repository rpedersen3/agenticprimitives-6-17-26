// Spec 272 PAY-A2A — payment-gated A2A skills (a2a-x402 v0.2 shape). a2a stays transport-agnostic and
// CANNOT import `payments` (package boundary) — so the concrete x402 rail is INJECTED via a `PaymentGate`
// (the same pattern as the runtime's enforcers/checks). A priced skill invoked without a satisfied
// payment parks in the EXISTING `input-required` task state with `x402.payment.*` metadata — NO new
// TaskState (PAY-A2A-2). Payment is MIDDLEWARE: skill handlers never see raw x402 wire objects, only
// "payment satisfied" + a receipt ref (PAY-A2A-6).

import type { A2aMessage } from './types.js';

/** PAY-A2A-1 — a skill declares its price in its descriptor. `price.amount` is atomic units (string for
 *  wire-safety); `asset`/`payee` are addresses. `rail` is the registered rail name (e.g. 'x402'). */
export interface SkillPayment {
  rail: string;
  price: { amount: string; asset: string };
  payee: string;
}

export type X402PaymentStatus =
  | 'payment-required'
  | 'payment-submitted'
  | 'payment-verified'
  | 'payment-completed'
  | 'payment-failed';

/** The `x402.payment.*` task metadata (a2a-x402 v0.2). `required`/`payload`/`receipts` are OPAQUE to
 *  a2a — the app fills them from `@agenticprimitives/payments` (PaymentRequired body / client payload /
 *  settlement receipts). Granular status lives here, never in the A2A TaskState machine. */
export interface X402PaymentMetadata {
  'x402.payment.status': X402PaymentStatus;
  'x402.payment.required'?: unknown;
  'x402.payment.payload'?: unknown;
  'x402.payment.receipts'?: unknown[];
}

export interface PaymentGateDecision {
  satisfied: boolean;
  /** When NOT satisfied: the PaymentRequired body to park (opaque; app-built from payments PAY-WIRE-1). */
  required?: unknown;
  /** When satisfied via a fresh settlement: the receipt ref to attach to the result. */
  receiptRef?: unknown;
}

/** The injected gate. The app wires the payments x402 rail (verify → settle → receipt). a2a only asks:
 *  "is this priced request paid?" and acts on the verdict. */
export interface PaymentGate {
  check(args: { skill: string; payment: SkillPayment; message: A2aMessage; payload?: unknown }): Promise<PaymentGateDecision>;
}

/** PAY-A2A-4 — the agent-card extension a priced agent advertises in `capabilities.extensions[]`.
 *  Clients activate via the `X-A2A-Extensions` header. */
export const X402_EXTENSION_URI = 'https://github.com/google-a2a/a2a-x402/v0.1';
export function x402AgentCardExtension(): { uri: string; required: boolean; description: string } {
  return { uri: X402_EXTENSION_URI, required: false, description: 'x402 pay-per-use for priced skills' };
}

/** Build the `x402.payment.*` metadata for an `input-required` park (PAY-A2A-2). */
export function buildPaymentRequiredMetadata(required: unknown): X402PaymentMetadata {
  return { 'x402.payment.status': 'payment-required', 'x402.payment.required': required };
}

/** Build the settled metadata to append once a payment clears (status + receipts). */
export function buildPaymentSettledMetadata(receipts: unknown[]): X402PaymentMetadata {
  return { 'x402.payment.status': 'payment-completed', 'x402.payment.receipts': receipts };
}

/**
 * PAY-A2A-3 — the payment middleware. Run BEFORE `handler.handle`. Returns:
 *  - `{ proceed: true, receiptRef? }` when the skill is free, or paid (the gate settled it), or no gate
 *    is wired — the handler then runs.
 *  - `{ proceed: false, parkMetadata }` when payment is required — the caller parks the task
 *    `input-required` and attaches `parkMetadata` (`x402.payment.*`), WITHOUT running the handler.
 *
 * Fail-closed: a priced skill with a gate that returns not-satisfied NEVER reaches the handler.
 */
export async function gateSkillPayment(args: {
  payment?: SkillPayment;
  gate?: PaymentGate;
  skill: string;
  message: A2aMessage;
  payload?: unknown;
}): Promise<{ proceed: true; receiptRef?: unknown } | { proceed: false; parkMetadata: X402PaymentMetadata }> {
  if (!args.payment) return { proceed: true }; // free skill
  if (!args.gate) return { proceed: true }; // no rail wired (dev / unpriced deployment) — app opts in
  const decision = await args.gate.check({
    skill: args.skill,
    payment: args.payment,
    message: args.message,
    payload: args.payload,
  });
  if (decision.satisfied) return { proceed: true, receiptRef: decision.receiptRef };
  return { proceed: false, parkMetadata: buildPaymentRequiredMetadata(decision.required) };
}
