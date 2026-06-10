# @agenticprimitives/agent-skills

**Agents get hired for what they can do — but publishing a full capability map on chain is an operational leak.** Discovery needs shared, versioned skill definitions everyone can point at; trust needs claims an agent cannot fake and an endorser cannot be impersonated on. This package splits the two cleanly: a **skill definition** is a public, versioned, on-chain anchor in `SkillDefinitionRegistry`; a **skill claim** — a Smart Agent's relation to a skill — is a **private verifiable credential in that agent's vault**, pointing at the on-chain `(skillId, version)`. There is no on-chain claim registry, by design.

Because the claim's subject and issuer are Smart Agent addresses, endorsements carry real weight: a certifying body signs the `endorsementDigest` with its own on-chain identity (ERC-1271-verifiable), the claim survives the subject's key rotations, and selective public assertion — when the agent opts in — reuses the generic [`attestations`](../attestations) credential-hash path rather than a skill-specific contract.

> Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

## What ships today

This SDK owns the credential shape (`SkillClaimCredential`), the self/endorsed builders, the commitment/digest math, and a thin on-chain definition reader ([spec 251](../../specs/251-skills-and-geo-features.md)):

- **Builders** — `buildSelfSkillClaim` (subject == issuer; proficiency capped at `SELF_MAX_PROFICIENCY`; self-meaningless relations forbidden) and `buildEndorsedSkillClaim` (cross-issued; returns the `endorsementDigest` the issuer signs).
- **Codelists** — `SKILL_KIND` (lockstep with `SkillDefinitionRegistry.KIND_*` on chain — a cross-stack test reads the live `.sol`), `SKILL_RELATION`, `SkillVisibility`. All are keccak hashes of the `ns/skill#` C-box concept URIs.
- **Math** — `computeSkillId`, `conceptHash`, `skillClaimId`, `skillEndorsementDigest`, `skillClaimHash`.
- **Definition reader** — `skillDefinitionExists(read, registry, ref)` via an injected `readContract` function (no viem/contract dependency) + `SKILL_DEFINITION_READ_ABI`.

```ts
import { buildEndorsedSkillClaim, SKILL_RELATION, skillDefinitionExists } from '@agenticprimitives/agent-skills';

const { credential, endorsementDigest } = buildEndorsedSkillClaim({
  chainId: 84532,
  subject: kcAgent,             // the Smart Agent the claim is about
  issuer:  certifyingBody,      // a different SA endorses it
  definition: { skillId, version: 1 },   // points to the on-chain SkillDefinitionRegistry
  relation: SKILL_RELATION.certifiedIn,
  proficiencyScore: 9000,
  nonce,
});
// the issuer signs `endorsementDigest` (ERC-1271); the app stores `credential` in the subject's vault.
```

Vault I/O is the app's job — this package is transport-agnostic and builds the credential only. `evidenceCommit` is a bytes32 commitment/merkle root, never a URI; the preimage stays in the vault.

## How it's different

Skill taxonomies and agent-capability frameworks (OASF-style schemas, marketplace skill catalogs) describe what a skill *is*; they have no answer for who *verifiably has it*. The deltas here:

1. **Claims are credentials, not catalog rows.** A claim is a signed VC bound to a persistent Smart Agent address — endorsable by another on-chain identity, revocable, and intact through credential recovery.
2. **Public taxonomy, private possession.** Definitions are shared on-chain anchors; the agent↔skill association never touches the chain unless the holder opts in. Competitors' public skill registries make every participant's capability map free intelligence.
3. **Lockstep, CI-checked.** `SKILL_KIND.Leaf === SkillDefinitionRegistry.KIND_LEAF` is asserted by a cross-stack test against the live Solidity — the SDK cannot drift from the contract.

Geo is the independent sibling [`@agenticprimitives/geo-features`](../geo-features) — no skill↔geo mapping exists on chain or in the SDKs; a "skill X in region Y" fact is two separate claims. Neutral substrate: no vertical vocabulary (domain language lives in apps, per [ADR-0021](../../docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md)).

## Status

**W1 foundational — the off-chain skill-claim layer of the spec-251 skills/geo substrate is shipped.** The on-chain peer is `SkillDefinitionRegistry.sol` in [`packages/contracts`](../contracts). See [AUDIT.md](./AUDIT.md).

> Testnet/pilot-ready. Production launch is gated on the public checklist in the root README — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).

**Authoritative spec:** [`specs/251-skills-and-geo-features.md`](../../specs/251-skills-and-geo-features.md). Bounded surface: `CLAUDE.md` + `capability.manifest.json`.

## Build

```bash
pnpm --filter @agenticprimitives/agent-skills typecheck
pnpm --filter @agenticprimitives/agent-skills test
pnpm --filter @agenticprimitives/agent-skills build
```
