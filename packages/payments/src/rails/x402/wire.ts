// Spec 272 PAY-WIRE-1/2/3 — x402 v2 HTTP wire. Headers: PAYMENT-REQUIRED (402) / PAYMENT-SIGNATURE
// (client→server) / PAYMENT-RESPONSE (server→client), all base64 JSON, CAIP-2 networks, `accepts[]`
// shape. The v1 `X-PAYMENT` names are dead — we never parse them (ADR-0013: one wire, fail-closed).

import type { Address } from 'viem';
import type { PaymentMandate } from '../../index.js';
import type { Hex32 } from './resource.js';
import type { PaymentQuote } from './quote.js';

export const X402_VERSION = 2 as const;
export const HEADER_PAYMENT_REQUIRED = 'PAYMENT-REQUIRED';
export const HEADER_PAYMENT_SIGNATURE = 'PAYMENT-SIGNATURE';
export const HEADER_PAYMENT_RESPONSE = 'PAYMENT-RESPONSE';
export const ASSET_TRANSFER_METHOD = 'erc7710-delegation' as const; // Wave 1; 'eip3009' is the Wave-5 sibling

/** One x402 `accepts[]` entry — our delegation-native variant of `scheme: 'exact'`. */
export interface PaymentRequirements {
  scheme: 'exact';
  network: string; // CAIP-2
  amount: string; // atomic units, decimal string
  asset: Address;
  payTo: Address;
  maxTimeoutSeconds: number;
  resource: { route: string; description?: string; mimeType?: string };
  extra: {
    assetTransferMethod: typeof ASSET_TRANSFER_METHOD;
    quoteId: Hex32;
    mandateTemplate: { resourceHash: Hex32; nonce: string; expiresAt: number };
  };
}

export interface PaymentRequiredBody {
  x402Version: typeof X402_VERSION;
  error?: string;
  accepts: PaymentRequirements[];
}

export interface SettlementResponse {
  success: boolean;
  settlementHash?: Hex32;
  mandateId?: Hex32;
  network: string;
  payer?: Address;
  error?: string;
}

// ── base64 JSON codec (bigint-safe) ──
function b64encode(obj: unknown): string {
  const json = JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  return typeof btoa === 'function' ? btoa(json) : Buffer.from(json, 'utf8').toString('base64');
}
function b64decode(b64: string): unknown {
  const json = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('utf8');
  return JSON.parse(json);
}

// ── PaymentMandate wire (de)serialize — the bigint fields become decimal strings on the wire ──
export function serializeMandate(m: PaymentMandate): Record<string, unknown> {
  return JSON.parse(JSON.stringify(m, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}
export function deserializeMandate(raw: unknown): PaymentMandate {
  const o = raw as Record<string, unknown>;
  const ap = o.amountPolicy as Record<string, unknown>;
  const cb = o.contextBinding as Record<string, unknown>;
  const mc = o.mandateConstraints as Record<string, unknown> | undefined;
  const big = (v: unknown): bigint => BigInt(v as string | number | bigint);
  return {
    ...(o as object),
    nonce: big(o.nonce),
    amountPolicy: {
      ...ap,
      ...(ap.amount !== undefined ? { amount: big(ap.amount) } : {}),
      ...(ap.minAmount !== undefined ? { minAmount: big(ap.minAmount) } : {}),
      ...(ap.maxAmount !== undefined ? { maxAmount: big(ap.maxAmount) } : {}),
    },
    contextBinding: { ...cb, nonce: big(cb.nonce) },
    ...(mc && mc.maxAggregateAmount !== undefined
      ? { mandateConstraints: { ...mc, maxAggregateAmount: big(mc.maxAggregateAmount) } }
      : {}),
  } as PaymentMandate;
}

// ── PAY-WIRE-1: build the 402 ──
export function buildPaymentRequired(
  quote: PaymentQuote,
  opts?: { error?: string; description?: string; mimeType?: string },
): { status: 402; headers: Record<string, string>; body: PaymentRequiredBody } {
  const requirements: PaymentRequirements = {
    scheme: 'exact',
    network: quote.network,
    amount: quote.amount.toString(),
    asset: quote.asset,
    payTo: quote.payTo,
    maxTimeoutSeconds: quote.maxTimeoutSeconds,
    // safe route only (no query string) — PAY-WIRE-6
    resource: { route: safeRoute(quote.resource.url), description: opts?.description, mimeType: opts?.mimeType },
    extra: {
      assetTransferMethod: ASSET_TRANSFER_METHOD,
      quoteId: quote.quoteId,
      mandateTemplate: { resourceHash: quote.resourceHash, nonce: quote.nonce.toString(), expiresAt: quote.expiresAt },
    },
  };
  const body: PaymentRequiredBody = { x402Version: X402_VERSION, error: opts?.error, accepts: [requirements] };
  return { status: 402, headers: { [HEADER_PAYMENT_REQUIRED]: b64encode(body) }, body };
}

/** Client-side: decode a PAYMENT-REQUIRED header back to the body (for tests + the reader's agent). */
export function parsePaymentRequired(headerValue: string): PaymentRequiredBody {
  const body = b64decode(headerValue) as PaymentRequiredBody;
  if (body.x402Version !== X402_VERSION) throw new Error(`[x402] unsupported x402Version ${body.x402Version}`);
  return body;
}

// ── PAY-WIRE-2: parse the client's signed payment ──
export interface PaymentSignaturePayload {
  x402Version: typeof X402_VERSION;
  accepted: PaymentRequirements;
  payload: { mandate: PaymentMandate };
}

/** Build the PAYMENT-SIGNATURE header (client side). */
export function buildPaymentSignature(accepted: PaymentRequirements, mandate: PaymentMandate): Record<string, string> {
  const body = { x402Version: X402_VERSION, accepted, payload: { mandate: serializeMandate(mandate) } };
  return { [HEADER_PAYMENT_SIGNATURE]: b64encode(body) };
}

/**
 * Server side: decode + validate the PAYMENT-SIGNATURE header. Fail-closed (returns null) on a missing
 * header, an unknown x402Version, a non-'exact' scheme, or an unsupported assetTransferMethod. NO v1
 * `X-PAYMENT` fallback (ADR-0013).
 */
export function parsePaymentSignature(
  headers: { get?(name: string): string | null } | Record<string, string | undefined>,
): { accepted: PaymentRequirements; mandate: PaymentMandate } | null {
  const raw = headerValue(headers, HEADER_PAYMENT_SIGNATURE);
  if (!raw) return null;
  let body: PaymentSignaturePayload;
  try {
    body = b64decode(raw) as PaymentSignaturePayload;
  } catch {
    return null;
  }
  if (body.x402Version !== X402_VERSION) return null;
  if (body.accepted?.scheme !== 'exact') return null;
  if (body.accepted?.extra?.assetTransferMethod !== ASSET_TRANSFER_METHOD) return null;
  if (!body.payload?.mandate) return null;
  return { accepted: body.accepted, mandate: deserializeMandate(body.payload.mandate) };
}

// ── PAY-WIRE-3: build the settlement response (a projection of the durable receipt) ──
export function buildPaymentResponse(r: SettlementResponse): Record<string, string> {
  return { [HEADER_PAYMENT_RESPONSE]: b64encode(r) };
}
export function parsePaymentResponse(headerValue: string): SettlementResponse {
  return b64decode(headerValue) as SettlementResponse;
}

// ── helpers ──
function headerValue(
  headers: { get?(name: string): string | null } | Record<string, string | undefined>,
  name: string,
): string | undefined {
  if (typeof (headers as { get?: unknown }).get === 'function') {
    return (headers as { get(n: string): string | null }).get(name) ?? undefined;
  }
  const rec = headers as Record<string, string | undefined>;
  return rec[name] ?? rec[name.toLowerCase()];
}
function safeRoute(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '';
  }
}
