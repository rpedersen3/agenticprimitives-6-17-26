# @agenticprimitives/geo-features — Claude guide

> **Status:** w1-foundational. The off-chain geo-CLAIM layer of the spec-251 skills/geo substrate.

## What this package owns
- The **geo CLAIM credential** (`GeoClaimCredential`) — a private VC, vault-resident, pointing to an
  on-chain `(featureId, version)` in `GeoFeatureRegistry`. **Claims are NOT on chain** — the agent↔feature
  association would leak operational data.
- **Builders** — `buildSelfGeoClaim` + `buildEndorsedGeoClaim` (cross-issued; returns the
  `endorsementDigest` the issuer signs, ERC-1271-verifiable).
- **Codelists** — `GEO_KIND` (on-chain-bound; **lockstep** with `GeoFeatureRegistry.KIND_*`),
  `GEO_RELATION`, `GeoVisibility`. All = keccak of the `ns/geo#` C-box concept URIs.
- **Math** — `computeFeatureId`, `geometryHash`, `geoClaimId`, `geoEndorsementDigest`, `geoClaimHash`.
- **Feature reader** — `geoFeatureExists(read, registry, ref)` via an injected `readContract` fn.

## What this package does NOT own
- The on-chain registry → `packages/contracts/src/geo/`. Vault I/O → the **app**. Exact geometry → off
  chain (this SDK handles only its `geometryHash`).
- Skills → `@agenticprimitives/agent-skills`. **No cross-import** — the two are independent; there is no
  on-chain (or in-SDK) skill↔geo mapping. A "serves skill X in region Y" fact is two separate claims.

## Hard rules
- **Claims are off-chain, vault-resident, private** (spec 251). A public assertion (opt-in) reuses the
  generic `AttestationRegistry` credential-hash path.
- **`GEO_KIND` is lockstep with the contract** (`GEO_KIND.Region === GeoFeatureRegistry.KIND_REGION`).
- **NEUTRAL public geography only.** A feature is a generic public place; NEVER tag it with operational /
  sensitivity / ministry data. Sensitivity is an off-chain app policy over neutral features (spec 251 GFR-07).
- **`evidenceCommit` is bytes32, never a URI.** **Neutral substrate — no domain/faith vocabulary.**

## Read these first
1. `capability.manifest.json` 2. `../../specs/251-skills-and-geo-features.md` 3. `src/index.ts`
4. `../contracts/src/geo/GeoFeatureRegistry.sol`.

## Validate
```bash
pnpm --filter @agenticprimitives/geo-features typecheck
pnpm --filter @agenticprimitives/geo-features test
```
