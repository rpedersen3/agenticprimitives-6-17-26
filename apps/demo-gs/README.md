# demo-gs — Global Switchboard

**Skills matching you can audit: every score has reasons, every record has an owner, every claim has an anchor.**

This is the Global Switchboard demo ([spec 250](../../specs/250-demo-gs-global-switchboard.md)): a relying app that runs the [agenticprimitives](../../README.md) intent spine — **Need → Offering → IntentMatch → Agreement** — as a skills marketplace. It is the sibling of [`demo-jp`](../demo-jp): same primitive, different vertical, which is itself the point. One intent substrate, two products, zero re-stitching.

> **Demo only.** "Global Switchboard", "GCO", "KC" are placeholders; no real-program affiliation. No real connections are brokered.

## The chain it proves

> Connect sign-in at the trust home → a person creates a GCO Organization Agent that posts a skill **Need** → a KC Person Agent publishes an expertise **Offering** → deterministic, reason-coded matching on shared skill / geo / cause anchors → the issuer registers the connection **Agreement** → confidential contact released only on accept — with all operational data living in per-agent MCP vaults.

Four roles, mirroring demo-jp:

| Role | Is | Does |
| --- | --- | --- |
| **GCO Org** | demand side — an org created by a connected person | posts skill Needs, requests connections |
| **KC Expert** | supply side — an individual person agent with skills | publishes an Offering, accepts/declines |
| **Jane** | Global Switchboard (broker, operator) | runs matching, manages the board |
| **Pete** | Global Church (issuer, operator) | issues the connection agreement |

Three properties carry the demo:

- **Skills are canonical references, never free text.** Needs and Offerings cite the same skill URI, so they join on concept identity; offering claims become `SkillClaimCredential`/`GeoClaimCredential` records whose ids are computed against the live, seeded on-chain SkillDefinitionRegistry and GeoFeatureRegistry (spec 251).
- **Matching is deterministic and explainable.** Every score carries reason codes and a human-readable "why this match" — no opaque ranking.
- **Vaults are the source of truth.** Needs, offerings, agreements, and the member registry live only in per-agent MCP vaults ([spec 247](../../specs/247-per-agent-mcp-vault.md)) via the [`demo-a2a`](../demo-a2a) proxy to [`demo-mcp`](../demo-mcp); the browser holds a transient in-memory cache, never persisted. The full browser-storage audit is in [`docs/storage-ledger.md`](docs/storage-ledger.md).

## Packages composed

- [`@agenticprimitives/agent-skills`](../../packages/agent-skills) / [`geo-features`](../../packages/geo-features) — canonical skill and geo claims
- [`@agenticprimitives/delegation`](../../packages/delegation) — vault access grants
- [`@agenticprimitives/browser-identity`](../../packages/browser-identity) / [`fedcm-rp`](../../packages/fedcm-rp) — Connect session, FedCM relying-party
- [`@agenticprimitives/contracts`](../../packages/contracts) — deployed registry addresses + ABIs
- [`@agenticprimitives/types`](../../packages/types) — shared primitives

## Run it

```bash
pnpm --filter @agenticprimitives-demo/gs dev        # http://localhost:5673
pnpm --filter @agenticprimitives-demo/gs typecheck
pnpm --filter @agenticprimitives-demo/gs test
pnpm --filter @agenticprimitives-demo/gs build
```

Live deployment: https://agenticprimitives-demo-gs.pages.dev (Cloudflare Pages, production branch `main`). The bundle reads the live registries on Base Sepolia; RPC overridable with `VITE_RPC_URL`.

## Status

Reference implementation, not a product. Identity, vault persistence, and on-chain skill/geo registries run live against Base Sepolia; the skill taxonomy is mocked, and the GC graph, Switchboard bridge, and public read API remain deliberate adapter seams for later phases. Production launch of the substrate is gated on the public checklist in the [root README](../../README.md); findings live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).
