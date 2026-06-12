---
"@agenticprimitives/payments": minor
"@agenticprimitives/contracts": minor
---

Payment stack — full general-purpose capability (spec 243 §5.5).

- **payments**: the W1.5 rails + primitives beyond x402 — `wallet` / `invoice` / `escrow` /
  `recurring` rails; EIP-712 signed `PaymentMandate` (`buildClosedMandate`, `mandate-sign`
  with ERC-1271 verify); immutable `PaymentReceipt` VC (`buildPaymentReceiptCredential`,
  `contextBindingHash` linking order ↔ fulfilment ↔ settlement); `entitlement` (pay-after-
  fulfilment + credits) and VOPRF blind `voucher` pack; `refund` / `split` / `transfer` /
  `ops` (idempotent event log + reconciliation + export).
- **contracts**: `PaymentEscrow.sol` — hold / capture(release) / refund / reclaim with
  payee-consented refund + expiry reclaim (FG-PAY-7), deploy script + 19 unit tests.
