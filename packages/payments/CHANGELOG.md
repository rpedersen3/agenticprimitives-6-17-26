# @agenticprimitives/payments

## 0.0.0-alpha.6

### Patch Changes

- Updated dependencies [75a24d9]
  - @agenticprimitives/verifiable-credentials@0.0.0-alpha.7
  - @agenticprimitives/delegation@1.0.0-alpha.10
  - @agenticprimitives/attestations@0.0.0-alpha.6
  - @agenticprimitives/types@1.0.0-alpha.10

## 0.0.0-alpha.5

### Minor Changes

- f51a547: Payment stack — full general-purpose capability (spec 243 §5.5).
  - **payments**: the W1.5 rails + primitives beyond x402 — `wallet` / `invoice` / `escrow` /
    `recurring` rails; EIP-712 signed `PaymentMandate` (`buildClosedMandate`, `mandate-sign`
    with ERC-1271 verify); immutable `PaymentReceipt` VC (`buildPaymentReceiptCredential`,
    `contextBindingHash` linking order ↔ fulfilment ↔ settlement); `entitlement` (pay-after-
    fulfilment + credits) and VOPRF blind `voucher` pack; `refund` / `split` / `transfer` /
    `ops` (idempotent event log + reconciliation + export).
  - **contracts**: `PaymentEscrow.sol` — hold / capture(release) / refund / reclaim with
    payee-consented refund + expiry reclaim (FG-PAY-7), deploy script + 19 unit tests.

### Patch Changes

- @agenticprimitives/types@1.0.0-alpha.9
- @agenticprimitives/delegation@1.0.0-alpha.9
- @agenticprimitives/attestations@0.0.0-alpha.5
- @agenticprimitives/verifiable-credentials@0.0.0-alpha.5

## 0.0.0-alpha.4

### Minor Changes

- fa345d7: x402 pay-per-use (spec 272/273/274).
  - **contracts**: `PaymentEnforcer` (fused stateful caveat — treasury-scoped, per-charge + session caps, frequency window, one-shot nonce, transfer-only), `PaymentReceiptRegistry`, `MockUSDC` (EIP-3009). Deployed on Base Sepolia.
  - **delegation**: `buildPaymentMandateCaveats` / `encodePaymentTerms` / `describePaymentMandate`; real on-chain `isRevoked` + `buildRevokeDelegationCall`; `EnforcerAddressMap.payment`. **Fix:** `ROOT_AUTHORITY` corrected to the contract sentinel `0xff…ff` (was `0x00…00`) — every `DelegationClient` root delegation now passes the on-chain authority check, so `redeemDelegation` works.
  - **payments**: the x402 rail — `x402.buildRedemptionCalldata`, `computeNullifier`, `verifyMandate`, `createX402Rail`, v2 wire (PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE), resource canonicalization + nonce store.
  - **a2a**: payment-gated skills (`gateSkillPayment`, `x402AgentCardExtension`).
  - **agent-account**: `buildErc20TransferCall` + `readErc20Balance`.

### Patch Changes

- Updated dependencies [fa345d7]
  - @agenticprimitives/delegation@1.0.0-alpha.8
  - @agenticprimitives/attestations@0.0.0-alpha.4
  - @agenticprimitives/types@1.0.0-alpha.8
  - @agenticprimitives/verifiable-credentials@0.0.0-alpha.4

## 0.0.0-alpha.3

### Patch Changes

- Updated dependencies [ba49084]
  - @agenticprimitives/delegation@1.0.0-alpha.7
  - @agenticprimitives/verifiable-credentials@0.0.0-alpha.3
  - @agenticprimitives/attestations@0.0.0-alpha.3
  - @agenticprimitives/types@1.0.0-alpha.7

## 0.0.0-alpha.2

### Patch Changes

- @agenticprimitives/types@1.0.0-alpha.6
- @agenticprimitives/delegation@1.0.0-alpha.6
- @agenticprimitives/attestations@0.0.0-alpha.2
- @agenticprimitives/verifiable-credentials@0.0.0-alpha.2

## 0.0.0-alpha.1

### Patch Changes

- @agenticprimitives/types@1.0.0-alpha.5
- @agenticprimitives/delegation@1.0.0-alpha.5
- @agenticprimitives/attestations@0.0.0-alpha.1
- @agenticprimitives/verifiable-credentials@0.0.0-alpha.1
