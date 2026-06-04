# demo-gs — Claude guide

Global Switchboard skills/expertise broker (spec 250). Vite SPA. **Sibling of demo-jp** — same
Need / Offering / Match / Agreement intent-spine primitive, applied to a *skills* marketplace.

## The mapping (demo-jp → demo-gs) — 4 roles, a clean mirror
- **GCO Organization** (demand) = a **Great Commission Organization**. A connected person **creates an ORG** (e.g. *Hope Church Missions Team*) that **holds the GCO role** + posts skill **Needs**; the person is its signatory. **≈ demo-jp Adopter.** (The GCO role belongs to the ORG, not the person.)
- **KC Expert** (supply) = an **individual** person agent with skills who publishes an **Offering** + accepts requests. **≈ demo-jp Facilitator.** We create new KC people whose skills we match against.
- **Jane / Global Switchboard** = the **broker** operator (matches Needs ↔ Offerings). **≈ JP / Jill.**
- **Pete / Global Church** = the **issuer** operator — the *same* Global Church org as demo-jp, **NOT a GCO**. Issues the connection agreement. **≈ demo-jp Global Church.**
- GCO orgs + KC people come from a **real Connect sign-in** (a person/org SA at their Global.Church home) — the connected person's session (`src/lib/session.ts`) + an entry in Jane's member registry; the Adopter/Facilitator "create + act as your identity" analog.

## Persistence — MCP vaults are the source of truth (Wave 2, spec 252)
Operational data — needs, offerings, agreements, the member registry — lives ONLY in per-agent **MCP
vaults**, read/written through `src/lib/vault-client.ts` → the demo-a2a `/a2a/mcp/vault/*` proxy →
demo-mcp vault tools (spec 247). `src/lib/store.ts` holds a transient in-memory CACHE of the active
identity's entitled view, rebuilt from the vault on every load — it is NEVER persisted to the browser.
Browser storage holds ONLY non-authoritative state: the login session credential (`session.ts`,
validated + TTL'd), connect / org-create redirect stashes, the active-role preference, the last-name
hint, the Pete/Jane demo-shortcut selection, and the non-authoritative Switchboard deploy display cache.
See `docs/storage-ledger.md` for the full key audit + `src/lib/storage-cleanup.ts` for the one-time
sweep of obsolete fixture-era blobs. (Identity is still demo-sso's job; taxonomy is mocked; the on-chain
substrate registries, the GC graph + C-Box registry, the Switchboard bridge, and the public API stay as
clean adapter seams for the deferred phases.)

## Where to look (by intent)
| Working on | Read |
| --- | --- |
| The product/architecture brief | `specs/250-demo-gs-global-switchboard.md` (condenses the full GS design doc) |
| Domain types | `src/domain/gs-types.ts` |
| Skill taxonomy / causes / regions | `src/data/taxonomy.ts` (mocked; `SkillRef` cites URIs, never free text) |
| Match scoring + explanations | `src/domain/score-match.ts` (deterministic, reason-coded) + `score-match.test.ts` |
| Agreement lifecycle + provenance | `src/domain/gs-status.ts` |
| Personas (Pete/Jane operators, GCO/KC members) | `src/lib/personas.ts` |
| Persistence (vault source-of-truth + entitled cache) | `src/lib/store.ts` + `src/lib/member-vault.ts` + `src/lib/vault-client.ts` |
| Session credential + validation | `src/lib/session.ts` |
| Browser-storage audit + one-time cleanup | `docs/storage-ledger.md` + `src/lib/storage-cleanup.ts` |
| **Substrate wiring (spec 251 Phase 3)** | `src/lib/substrate.ts` — Offerings → `SkillClaimCredential`/`GeoClaimCredential` via `@agenticprimitives/agent-skills`+`geo-features`; taxonomy `SkillRef.skillId`/`GeoFacet.featureId` are canonical substrate ids (`computeSkillId`/`computeFeatureId`). |
| UI shell + screens | `src/App.tsx` + `src/components/*` |

## Deploy (read first)
- **Live:** https://agenticprimitives-demo-gs.pages.dev (Cloudflare Pages, direct-upload, **production branch `main`**).
- Redeploy: `cd apps/demo-gs && pnpm build && npx wrangler pages deploy dist --project-name=agenticprimitives-demo-gs --branch=main` (any other branch → preview).
- The bundle reads the **live, seeded** SkillDefinitionRegistry / GeoFeatureRegistry (spec 251) via `src/lib/chain.ts` + the `@agenticprimitives/contracts/deployments` subpath; RPC overridable with `VITE_RPC_URL`.

## Hard rules (this app)
- **Identity is the home's (Connect/demo-sso's) job, NOT demo-gs's.** Members connect via a real Connect sign-in (`session.ts`); never call Privy/Firebase directly (spec 250 §"Identity boundary").
- **Skills are canonical references, never free text.** Both Needs and Offerings cite the same `SkillRef.gcUri` so they join on concept identity (the cross-app payoff). Labels are display only.
- **Matching is deterministic + explainable.** Every score carries reason codes + a human "why this match". No opaque ranking; exact-skill ≫ category.
- **Privacy tiers:** public anchor vs confidential profile/contact vs sensitive (absence). The fact that a specific KC matched a specific Need is confidential; only aggregate counts are public.
- **App-local, no premature extraction.** Domain + taxonomy + matching stay in `apps/demo-gs` until a 2nd consumer appears (spec 250 §"Reference").

## Validate
`cd apps/demo-gs && pnpm typecheck && pnpm test && pnpm build`. (No `pnpm check:demo-gs`.)
