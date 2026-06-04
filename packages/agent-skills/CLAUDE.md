# @agenticprimitives/agent-skills — Claude guide

> **Status:** w1-foundational. The off-chain skill-CLAIM layer of the spec-251 skills/geo substrate.

## What this package owns
- The **skill CLAIM credential** shape (`SkillClaimCredential`) — a private VC, vault-resident, that
  points to an on-chain `(skillId, version)` in `SkillDefinitionRegistry`. **Claims are NOT on chain.**
- **Builders** — `buildSelfSkillClaim` (subject==issuer; capped proficiency; self-meaningless relations
  forbidden) + `buildEndorsedSkillClaim` (cross-issued; returns the `endorsementDigest` the issuer signs,
  ERC-1271-verifiable).
- **Codelists** — `SKILL_KIND` (on-chain-bound; **lockstep** with `SkillDefinitionRegistry.KIND_*`),
  `SKILL_RELATION`, `SkillVisibility`. All = keccak of the `ns/skill#` C-box concept URIs.
- **Math** — `computeSkillId`, `conceptHash`, `skillClaimId`, `skillEndorsementDigest`, `skillClaimHash`.
- **Definition reader** — `skillDefinitionExists(read, registry, ref)` via an injected `readContract` fn
  (no viem/contract dep) + `SKILL_DEFINITION_READ_ABI`.

## What this package does NOT own
- The on-chain registry → `packages/contracts/src/skills/`. The **vault I/O** (storing/reading the claim
  credential) → the **app** (demo-gs/demo-jp `vault-client`); this package is transport-agnostic.
- Geo → `@agenticprimitives/geo-features` (independent; no cross-import — there is no skill↔geo mapping).

## Hard rules
- **Claims are off-chain, vault-resident, private** (spec 251). This package builds the credential; the
  app stores it under the agent's vault delegation. A public assertion (opt-in) reuses the generic
  `AttestationRegistry` credential-hash path — never a skill-specific contract.
- **`SKILL_KIND` is lockstep with the contract.** `SKILL_KIND.Leaf === SkillDefinitionRegistry.KIND_LEAF`
  (cross-stack test reads the live `.sol`). Don't edit a kind URI on one side only.
- **`evidenceCommit` is a bytes32 commitment / merkle root — NEVER a URI.** The preimage lives in the vault.
- **Neutral substrate — NO domain/faith vocabulary** (spec 251 "People groups are excluded").

## Read these first
1. `capability.manifest.json` 2. `../../specs/251-skills-and-geo-features.md` 3. `src/index.ts`
4. `../contracts/src/skills/SkillDefinitionRegistry.sol` (the on-chain peer).

## Validate
```bash
pnpm --filter @agenticprimitives/agent-skills typecheck
pnpm --filter @agenticprimitives/agent-skills test
```
