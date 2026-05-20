# Use case 2 — High-risk agent delegation

> **Status:** stub. Implementation lands in phase 6c.3 (SDK) + 6c.5
> (frontend) + phase 7 (permission-card UX).

Maps to spec 207 § 4.1 use case #2. Agent requests permission to
transfer up to 10 USDC/day to approved vendors. Because it's T3
Value, the flow requires (a) a human-readable permission card,
(b) threshold approval at issue time, and (c) on-chain
`acceptSessionDelegation(hash)` blessing when the cap is above
`T3_HIGHVALUE_THRESHOLD` (default 0.01 ETH equivalent).

This walkthrough will cover:

1. The permission card the user sees (who / what / where / when /
   how much / how often / how to revoke).
2. Building a quorum-aware delegation via `buildQuorumCaveat`
   (lands with 6c.3).
3. Collecting threshold signatures via the SDK helper.
4. Calling `acceptSessionDelegation` on-chain (the agent calls it in
   the same userOp as the delegation redemption, batched via
   `MultiSendCallOnly`).
5. The audit-row trail produced: `delegation.mint` →
   `delegation.verify.accept` with `acceptedOnChain: true`.

Code: `apps/demo-web-pro/src/flows/threshold-approval/` (lands with 6c.5).
