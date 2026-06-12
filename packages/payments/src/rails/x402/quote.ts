// Spec 272 X402-D9.2 — the immutable PaymentQuote. The 402 carries it; the service persists
// (taskId → quoteId → resourceHash → amount → payee) and a retry MUST match it. No silent re-pricing.

import { encodeAbiParameters, keccak256, type Address } from 'viem';
import type { Hex32, PaymentResource } from './resource.js';
import { canonicalizePaymentResource } from './resource.js';

/** A priced, bound, expiring offer for one access. `quoteId` is derived from the binding so two quotes
 *  for the same request+price are identical and a tampered field changes the id (tamper-evident). */
export interface PaymentQuote {
  quoteId: Hex32;
  scheme: 'exact';
  network: string; // CAIP-2, e.g. 'eip155:84532'
  asset: Address; // USDC
  payTo: Address; // treasury SA
  amount: bigint; // atomic units (flat per-call, X402-D3)
  resource: PaymentResource;
  resourceHash: Hex32;
  nonce: bigint;
  expiresAt: number; // unix seconds
  maxTimeoutSeconds: number;
}

/** Deterministic quote id over the binding + price + payee + nonce + expiry. Same inputs → same id;
 *  any change (amount, payee, resource field, nonce, expiry) → different id (X402-D9 quote immutability). */
export function computeQuoteId(args: {
  resourceHash: Hex32;
  asset: Address;
  payTo: Address;
  amount: bigint;
  network: string;
  nonce: bigint;
  expiresAt: number;
}): Hex32 {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'string' },
        { type: 'uint256' },
        { type: 'uint256' },
      ],
      [
        args.resourceHash,
        args.asset,
        args.payTo,
        args.amount,
        args.network,
        args.nonce,
        BigInt(args.expiresAt),
      ],
    ),
  );
}

/** Build a fully-formed, self-consistent PaymentQuote from a resource + price. */
export function buildPaymentQuote(args: {
  resource: PaymentResource;
  network: string;
  maxTimeoutSeconds?: number;
}): PaymentQuote {
  const { resource } = args;
  const resourceHash = canonicalizePaymentResource(resource);
  const quoteId = computeQuoteId({
    resourceHash,
    asset: resource.asset,
    payTo: resource.treasury,
    amount: resource.amount,
    network: args.network,
    nonce: resource.nonce,
    expiresAt: resource.expiresAt,
  });
  return {
    quoteId,
    scheme: 'exact',
    network: args.network,
    asset: resource.asset,
    payTo: resource.treasury,
    amount: resource.amount,
    resource,
    resourceHash,
    nonce: resource.nonce,
    expiresAt: resource.expiresAt,
    maxTimeoutSeconds: args.maxTimeoutSeconds ?? 300,
  };
}

/** X402-D9 quote immutability: a re-presented quote MUST match the persisted one on every field that
 *  prices or binds the charge. Returns the first mismatch (for telemetry) or null when identical. */
export function quoteMismatch(persisted: PaymentQuote, presented: PaymentQuote): string | null {
  if (persisted.quoteId !== presented.quoteId) return 'quoteId';
  if (persisted.resourceHash !== presented.resourceHash) return 'resourceHash';
  if (persisted.amount !== presented.amount) return 'amount';
  if (persisted.payTo.toLowerCase() !== presented.payTo.toLowerCase()) return 'payTo';
  if (persisted.asset.toLowerCase() !== presented.asset.toLowerCase()) return 'asset';
  if (persisted.network !== presented.network) return 'network';
  if (persisted.nonce !== presented.nonce) return 'nonce';
  if (persisted.expiresAt !== presented.expiresAt) return 'expiresAt';
  return null;
}

/** CAIP-2 helpers (X402-D6 — wire uses `eip155:<id>`, never a bare chain number). */
export function toCaip2(chainId: number): string {
  return `eip155:${chainId}`;
}
export function fromCaip2(network: string): number {
  const m = /^eip155:(\d+)$/.exec(network);
  if (!m) throw new Error(`[x402] unsupported network "${network}" (expected eip155:<chainId>)`);
  return Number(m[1]);
}
