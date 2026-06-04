# @agenticprimitives/agent-skills — AUDIT

Off-chain skill-CLAIM SDK (spec 251). Transport-agnostic; no on-chain claim writes.

## Invariants
- **Claims are off-chain, vault-resident, private.** This package only BUILDS the credential + computes
  ids/digests; the app stores it under the agent's vault delegation. No on-chain claim registry exists.
- **`SKILL_KIND` is lockstep with `SkillDefinitionRegistry.KIND_*`** (cross-stack test reads the live `.sol`).
- **`evidenceCommit` is a bytes32 commitment / merkle root — never a URI.** Preimage stays in the vault.
- **Endorsement digest is ERC-1271-verifiable** by the issuer SA (the app verifies; this SDK only derives).
- **Neutral substrate** — no domain/faith vocabulary (enforced by `forbiddenTerms` + `check:no-domain-in-packages`).

## Surface
Pure functions + types only. No network, no key material, no chain writes. The on-chain reader takes an
injected `readContract` fn (no viem/contract runtime dep).

## Trust boundary
A claim's authority is the issuer signature over `skillEndorsementDigest` (verified off-chain via ERC-1271)
+ the pinned `(skillId, version)` existing on the registry (`skillDefinitionExists`). This SDK derives those
inputs; verification + storage are the consuming app's responsibility.
