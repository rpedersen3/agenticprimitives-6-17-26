---
"@agenticprimitives/contracts": patch
---

WA-1 / WA-2 — WebAuthn custody-signature hardening (2026-06-10 audit).

`WebAuthnLib` + `SignatureSlotRecovery` bytecode changed → a Base Sepolia
redeploy is required for on-chain enforcement.

- **WA-1 (Medium)** — `WebAuthnLib.verify` now enforces low-s (`s ≤ n/2`,
  `P256_N_DIV_2`) before the RIP-7212 call. RIP-7212 accepts both `(r, s)` and
  `(r, n−s)`, so without this a second valid signature always existed over the
  same message (P-256 malleability). The bound covers every caller from the one
  library chokepoint.
- **WA-2 (Medium)** — the custody-COUNCIL quorum passkey path
  (`SignatureSlotRecovery`) now requires User-Verification (`requireUv=true`),
  consistent with the native ERC-1271 path (AgentAccount, R8.2). A UP-only
  custody assertion is rejected; custody signers must use
  `userVerification:'required'`.
