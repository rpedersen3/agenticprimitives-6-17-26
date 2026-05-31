---
'@agenticprimitives/types': patch
'@agenticprimitives/audit': patch
'@agenticprimitives/connect-auth': patch
'@agenticprimitives/connect': patch
'@agenticprimitives/key-custody': patch
'@agenticprimitives/account-custody': patch
'@agenticprimitives/agent-account': patch
'@agenticprimitives/delegation': patch
'@agenticprimitives/tool-policy': patch
'@agenticprimitives/mcp-runtime': patch
'@agenticprimitives/agent-naming': patch
'@agenticprimitives/agent-profile': patch
'@agenticprimitives/agent-relationships': patch
'@agenticprimitives/identity-directory': patch
'@agenticprimitives/identity-directory-adapters': patch
'@agenticprimitives/ontology': patch
'@agenticprimitives/contracts': patch
---

R1 — CROSS-STACK-001 closure + storage-layout snapshot gate.

### Breaking

- **`DelegationManager.DELEGATION_TYPEHASH` byte value changed.** The
  contract previously hashed the non-standard EIP-712 type string
  `Delegation(...,bytes32 caveatsHash,...)` (inlining a precomputed
  caveats digest). It now hashes the canonical EIP-712 form
  `Delegation(...,Caveat[] caveats,...)Caveat(address enforcer,bytes terms)`
  to converge with the off-chain `DELEGATION_EIP712_TYPES` used by
  `@agenticprimitives/delegation` + viem. Any signature minted against
  the pre-R1 typehash (`0xac5469bad161df7c56017782e0a87a91008dbe46dacd5eb42e48e7f4b4fc4e39`)
  will not verify against the post-R1 typehash
  (`0x52f4b7596c22f77177e8e563e6502ad014a696bfc92f9c6cabcaf5738c4ed265`).
  Cross-stack signatures now round-trip (off-chain → on-chain) without
  bespoke re-hashing.

### Added

- `pnpm check:storage-layouts` — snapshot gate over `AgentAccount`,
  `CustodyPolicy`, `DelegationManager`, `SmartAgentPaymaster`. Locks
  slot/offset/type for each storage variable. Drift fails CI.

### Notes

- Forge test `test_DELEGATION_TYPEHASH_is_a_known_constant` and the
  TS-side `cross-stack-typehashes` integration test independently lock
  the converged typehash byte value.
- Audit row `CROSS-STACK-001` + `XCON-003` + `CON-AgentAccount-003`
  closed in `docs/audits/2026-05-packages-contracts-production-readiness.md`.
- Released as `0.1.0-alpha.2` (changeset pre-mode reentered).
