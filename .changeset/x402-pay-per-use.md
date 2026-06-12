---
"@agenticprimitives/contracts": minor
"@agenticprimitives/delegation": minor
"@agenticprimitives/payments": minor
"@agenticprimitives/agent-account": minor
"@agenticprimitives/a2a": minor
---

x402 pay-per-use (spec 272/273/274).

- **contracts**: `PaymentEnforcer` (fused stateful caveat — treasury-scoped, per-charge + session caps, frequency window, one-shot nonce, transfer-only), `PaymentReceiptRegistry`, `MockUSDC` (EIP-3009). Deployed on Base Sepolia.
- **delegation**: `buildPaymentMandateCaveats` / `encodePaymentTerms` / `describePaymentMandate`; real on-chain `isRevoked` + `buildRevokeDelegationCall`; `EnforcerAddressMap.payment`. **Fix:** `ROOT_AUTHORITY` corrected to the contract sentinel `0xff…ff` (was `0x00…00`) — every `DelegationClient` root delegation now passes the on-chain authority check, so `redeemDelegation` works.
- **payments**: the x402 rail — `x402.buildRedemptionCalldata`, `computeNullifier`, `verifyMandate`, `createX402Rail`, v2 wire (PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE), resource canonicalization + nonce store.
- **a2a**: payment-gated skills (`gateSkillPayment`, `x402AgentCardExtension`).
- **agent-account**: `buildErc20TransferCall` + `readErc20Balance`.
