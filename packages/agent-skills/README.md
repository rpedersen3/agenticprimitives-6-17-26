# @agenticprimitives/agent-skills

Off-chain **skill claim** credentials + on-chain `SkillDefinitionRegistry` helpers
([spec 251](../../specs/251-skills-and-geo-features.md)).

In the skills/geo substrate, a **skill definition** is a public, versioned, on-chain anchor; a **skill
claim** — a Smart Agent's relation to a skill — is a **private verifiable credential in that agent's
vault** that points to an on-chain `(skillId, version)`. There is no on-chain claim registry. This SDK
owns the credential shape, the self/endorsed builders, the commitment/digest math, and a thin on-chain
definition reader.

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

`SKILL_KIND` is **lockstep** with `SkillDefinitionRegistry.KIND_*` on chain (ADR-0009; a cross-stack test
asserts it). Neutral substrate — no domain/faith vocabulary (the Switchboard/JP domain language lives in
apps). Geo is the independent sibling `@agenticprimitives/geo-features` (no on-chain skill↔geo mapping).
