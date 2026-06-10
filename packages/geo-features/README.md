# @agenticprimitives/geo-features

**Where an agent operates is one of the most sensitive facts about it — and most geo registries publish it by default.** Coordination needs shared geography everyone can reference; safety needs the agent↔place association kept private. This package splits the two: a **geo feature** is a public, versioned, on-chain anchor in `GeoFeatureRegistry` (geometry hash + coverage/source roots + a coarse bbox; exact GeoJSON stays off chain); a **geo claim** — a Smart Agent's relation to a feature — is a **private verifiable credential in that agent's vault**, pointing at the on-chain `(featureId, version)`. The association is never on chain — it would leak operational data.

Because subject and issuer are Smart Agent addresses, a validator endorses a claim by signing the `endorsementDigest` with its own on-chain identity (ERC-1271-verifiable), the claim survives the subject's key rotations, and opt-in public assertion reuses the generic [`attestations`](../attestations) credential-hash path — never a geo-specific contract.

> Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

## What ships today

This SDK owns the credential shape (`GeoClaimCredential`), the self/endorsed builders, the commitment/digest math, and a thin on-chain feature reader ([spec 251](../../specs/251-skills-and-geo-features.md)):

- **Builders** — `buildSelfGeoClaim` and `buildEndorsedGeoClaim` (cross-issued; returns the `endorsementDigest` the issuer signs).
- **Codelists** — `GEO_KIND` (lockstep with `GeoFeatureRegistry.KIND_*` on chain, [ADR-0009](../../docs/architecture/decisions/0009-on-chain-ontology-shacl-naming.md)), `GEO_RELATION`, `GeoVisibility`. All are keccak hashes of the `ns/geo#` C-box concept URIs.
- **Math** — `computeFeatureId`, `geometryHash`, `geoClaimId`, `geoEndorsementDigest`, `geoClaimHash`.
- **Feature reader** — `geoFeatureExists(read, registry, ref)` via an injected `readContract` function (no viem/contract dependency) + `GEO_FEATURE_READ_ABI`.

```ts
import { buildEndorsedGeoClaim, GEO_RELATION, geoFeatureExists } from '@agenticprimitives/geo-features';

const { credential, endorsementDigest } = buildEndorsedGeoClaim({
  chainId: 84532,
  subject: orgAgent,
  issuer:  validator,
  feature: { featureId, version: 1 },     // points to the on-chain GeoFeatureRegistry
  relation: GEO_RELATION.servesWithin,
  visibility: 'public-coarse',
  nonce,
});
// the issuer signs `endorsementDigest` (ERC-1271); the app stores `credential` in the subject's vault.
```

Vault I/O is the app's job — this package is transport-agnostic. Exact geometry stays off chain (the SDK handles only its `geometryHash`); `evidenceCommit` is a bytes32 commitment, never a URI.

## How it's different

Open boundary datasets and geospatial registries answer "what places exist"; they have no model for "which agent verifiably operates where, disclosed on the agent's terms". The deltas here:

1. **Neutral public geography only.** A feature is a generic public place — it is never tagged with operational or sensitivity data. Sensitivity is an off-chain app policy layered over neutral features (spec 251 GFR-07).
2. **Possession is private by default.** The agent↔feature claim lives in the agent's vault as a signed VC; visibility tiers (`public-coarse`, `private-commitment`, `private-zk`, …) let the holder choose disclosure granularity.
3. **Lockstep, CI-checked.** `GEO_KIND.Region === GeoFeatureRegistry.KIND_REGION` — the codelists are bound to the contract constants, so the SDK cannot drift from the chain.

Skills are the independent sibling [`@agenticprimitives/agent-skills`](../agent-skills) — there is no skill↔geo mapping; a "skill X in region Y" fact is two separate claims. Neutral substrate: no vertical vocabulary ([ADR-0021](../../docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md)).

## Status

**W1 foundational — the off-chain geo-claim layer of the spec-251 skills/geo substrate is shipped.** The on-chain peer is `GeoFeatureRegistry.sol` in [`packages/contracts`](../contracts). See [AUDIT.md](./AUDIT.md).

> Testnet/pilot-ready. Production launch is gated on the public checklist in the root README — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).

**Authoritative spec:** [`specs/251-skills-and-geo-features.md`](../../specs/251-skills-and-geo-features.md). Bounded surface: `CLAUDE.md` + `capability.manifest.json`.

## Build

```bash
pnpm --filter @agenticprimitives/geo-features typecheck
pnpm --filter @agenticprimitives/geo-features test
pnpm --filter @agenticprimitives/geo-features build
```
