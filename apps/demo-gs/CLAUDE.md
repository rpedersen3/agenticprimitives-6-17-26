# demo-gs — Claude guide

Global Switchboard skills/expertise broker (spec 250). Vite SPA. **Sibling of demo-jp** — same
Need / Offering / Match / Agreement intent-spine primitive, applied to a *skills* marketplace.

## The mapping (demo-jp → demo-gs) — 4 roles, a clean mirror
- **GCO Organization** (demand) = a **Great Commission Organization**. A connected person **creates an ORG** (e.g. *Hope Church Missions Team*) that **holds the GCO role** + posts skill **Needs**; the person is its signatory. **≈ demo-jp Adopter.** (The GCO role belongs to the ORG, not the person.)
- **KC Expert** (supply) = an **individual** person agent with skills who publishes an **Offering** + accepts requests. **≈ demo-jp Facilitator.** We create new KC people whose skills we match against.
- **Jane / Global Switchboard** = the **broker** operator (matches Needs ↔ Offerings). **≈ JP / Jill.**
- **Pete / Global Church** = the **issuer** operator — the *same* Global Church org as demo-jp, **NOT a GCO**. Issues the connection agreement. **≈ demo-jp Global Church.**
- New GCO orgs + KC people are **created in-app** (`src/lib/members.ts` + `MemberPicker`) — the Adopter/Facilitator "create + act as your identity" analog; Phase 1 swaps this for real demo-sso SAs.

## v1 = fixture-driven (spec 250 Phase 0/1)
Identity- and chain-decoupled: localStorage store, mocked taxonomy, a stubbed `AgentSession`. The store +
adapters keep clean seams for the deferred phases (real demo-sso session, vault persistence, on-chain
registries, the GC graph + C-Box registry, the read-only Switchboard bridge, the public API).

## Where to look (by intent)
| Working on | Read |
| --- | --- |
| The product/architecture brief | `specs/250-demo-gs-global-switchboard.md` (condenses the full GS design doc) |
| Domain types | `src/domain/gs-types.ts` |
| Skill taxonomy / causes / regions | `src/data/taxonomy.ts` (mocked; `SkillRef` cites URIs, never free text) |
| Match scoring + explanations | `src/domain/score-match.ts` (deterministic, reason-coded) + `score-match.test.ts` |
| Agreement lifecycle + provenance | `src/domain/gs-status.ts` |
| Personas (Pete/GCO, Jane/broker, KC) | `src/lib/personas.ts` |
| Persistence (localStorage, vault-shaped seams) | `src/lib/store.ts` |
| Demo fixtures (agents, needs, offerings) | `src/data/fixtures.ts` |
| **Substrate wiring (spec 251 Phase 3)** | `src/lib/substrate.ts` — Offerings → `SkillClaimCredential`/`GeoClaimCredential` via `@agenticprimitives/agent-skills`+`geo-features`; taxonomy `SkillRef.skillId`/`GeoFacet.featureId` are canonical substrate ids (`computeSkillId`/`computeFeatureId`). |
| UI shell + screens | `src/App.tsx` + `src/components/*` |

## Deploy (read first)
- **Live:** https://agenticprimitives-demo-gs.pages.dev (Cloudflare Pages, direct-upload, **production branch `main`**).
- Redeploy: `cd apps/demo-gs && pnpm build && npx wrangler pages deploy dist --project-name=agenticprimitives-demo-gs --branch=main` (any other branch → preview).
- The bundle reads the **live, seeded** SkillDefinitionRegistry / GeoFeatureRegistry (spec 251) via `src/lib/chain.ts` + the `@agenticprimitives/contracts/deployments` subpath; RPC overridable with `VITE_RPC_URL`.

## Hard rules (this app)
- **Identity is demo-sso's job, NOT demo-gs's.** v1 stubs an `AgentSession`; never call Privy/Firebase directly (spec 250 §"Identity boundary").
- **Skills are canonical references, never free text.** Both Needs and Offerings cite the same `SkillRef.gcUri` so they join on concept identity (the cross-app payoff). Labels are display only.
- **Matching is deterministic + explainable.** Every score carries reason codes + a human "why this match". No opaque ranking; exact-skill ≫ category.
- **Privacy tiers:** public anchor vs confidential profile/contact vs sensitive (absence). The fact that a specific KC matched a specific Need is confidential; only aggregate counts are public.
- **App-local, no premature extraction.** Domain + taxonomy + matching stay in `apps/demo-gs` until a 2nd consumer appears (spec 250 §"Reference").

## Validate
`cd apps/demo-gs && pnpm typecheck && pnpm test && pnpm build`. (No `pnpm check:demo-gs`.)
