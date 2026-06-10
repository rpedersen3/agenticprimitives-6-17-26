---
"@agenticprimitives/contracts": patch
---

EN-11 — QuorumEnforcer fail-closed on a degenerate quorum (2026-06-10 audit).

`QuorumEnforcer.beforeHook` now reverts `InvalidThreshold` when `threshold == 0`
(which skipped the verification loop and made the signature-count guard
unreachable → a quorum caveat passed with ZERO signatures) or when `threshold`
exceeds the signer set. Bytecode changed → batches into the pending Base Sepolia
redeploy.
