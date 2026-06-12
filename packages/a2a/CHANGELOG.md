# @agenticprimitives/a2a

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
  - @agenticprimitives/fulfillment@0.0.0-alpha.5
  - @agenticprimitives/types@1.0.0-alpha.8

## 0.0.0-alpha.1

### Patch Changes

- ba49084: 2026-06-10 audit hardening wave + Base Sepolia redeploy.

  Contract/package security fixes from the post-NO-GO hardening program (the
  `@agenticprimitives/contracts` ABIs + the `deployments-base-sepolia.json`
  addresses move because **every contract was redeployed** — the new factory is
  `0x3E68B72B45e7C9d35B210E4Ab06e5Cece85cEbE4`):
  - **CA-F1 (High)** — `AgentAccountFactory` CREATE2 salt now commits to the full
    custody config (mode/trustees/timelockOverrides) so the counterfactual address
    can't be front-run with attacker-controlled recovery (ADR-0035).
    `getAddressForAgentAccount` gains a `timelockOverrides` param; the
    `@agenticprimitives/agent-account` client threads it.
  - **ATT-1 / ATT-3 / AGR-1** — registry issuer + joint-consent + transition digests
    now bind a full typed payload + `chainId` + `address(this)`.
  - **AN-1-ONCHAIN** — on-chain canonical label charset in `AgentNameRegistry`.
  - **SIG-1** — registries use malleability-safe OZ `ECDSA.tryRecover` (low-s).
  - **DM danger** — `verifyAuthorization` marked ⚠️ chain-only in NatSpec + the SDK.
  - **DEL-001 (P0-1, Critical)** — the session-key↔delegator binding in
    `@agenticprimitives/delegation` is now **fail-closed by default** (ADR-0036):
    `verifyDelegationToken` rejects any token lacking a valid `sessionDelegation` leaf
    unless the caller passes the explicit, greppable `allowUnboundSessionToken: true`
    opt-out. `@agenticprimitives/mcp-runtime` threads the same opt-out through
    `McpResourceVerifyConfig`. **Breaking:** the prior opt-in flags
    (`requireSessionDelegateBinding`, `strictSessionBinding`) are removed — callers that
    minted unbound tokens must set `allowUnboundSessionToken: true` or they fail closed.

  `@agenticprimitives/verifiable-credentials` + the first publish of
  `@agenticprimitives/a2a` (async delegation-authorized task transport) are bumped to
  catch the registry up to `master`.

- Updated dependencies [ba49084]
  - @agenticprimitives/delegation@1.0.0-alpha.7
  - @agenticprimitives/fulfillment@0.0.0-alpha.3
  - @agenticprimitives/types@1.0.0-alpha.7
