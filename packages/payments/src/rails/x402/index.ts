// @agenticprimitives/payments — x402 rail (spec 272). HTTP-native pay-per-use over the spec-243
// PaymentMandate. Consumed as `import { x402 } from '@agenticprimitives/payments'`.

export type { PaymentResource, Hex32 } from './resource.js';
export { ZERO_HASH, canonicalizePaymentResource, hashRequestBody, redactPaymentMetadata } from './resource.js';

export type { PaymentQuote } from './quote.js';
export { computeQuoteId, buildPaymentQuote, quoteMismatch, toCaip2, fromCaip2 } from './quote.js';

export type { PaymentRequirements, PaymentRequiredBody, SettlementResponse, PaymentSignaturePayload } from './wire.js';
export {
  X402_VERSION,
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_SIGNATURE,
  HEADER_PAYMENT_RESPONSE,
  ASSET_TRANSFER_METHOD,
  buildPaymentRequired,
  parsePaymentRequired,
  buildPaymentSignature,
  parsePaymentSignature,
  buildPaymentResponse,
  parsePaymentResponse,
  serializeMandate,
  deserializeMandate,
} from './wire.js';

export type { NonceReservationStore, NonceState, SettledReceipt, ReserveResult } from './nonce-store.js';
export { createMemoryNonceStore } from './nonce-store.js';

export type { X402RailConfig, X402RailDeps, SettleResult } from './executor.js';
export { computeNullifier, verifyMandate, buildRedemptionCalldata, createX402Rail } from './executor.js';
