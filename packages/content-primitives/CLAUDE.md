# @agenticprimitives/content-primitives — Claude guide

Name → resolve → commit → entitlement-gate → cite, for content that lives
off-platform and is controlled by third-party rights holders. **Bible verses are
its first usage domain (spec 267), not its vocabulary.**

## The one idea

**Content is not an Agent.** A `CanonicalLocus` (a passage address) is
**scheme-anchored** — a deterministic `locusId`, never registered, never an SA
facet. Only *issuers/corpora* and *parties* are Smart Agents (ADR-0010 still
governs them via `agent-naming`). This is the FRBR Work/Item split and the reason
this is a new substrate, not an `agent-naming` record type. See ADR-0033.

## What this package owns (FRBR)

- `CanonicalLocus` (Work) — `computeLocusId(scheme, normalizedPath)`.
- `CorpusManifest` (Manifestation) — issuer-owned, Merkle `corpusRoot`.
- `ContentDescriptor` (Item) — the deliverable leaf; `commitment` +
  `retrievalPointer` + issuer signature. **Never the text.**
- `Entitlement` / `CitationAssertion` — VC 2.0 subjects (envelope from
  `verifiable-credentials`).
- Merkle helpers (`/merkle` subpath), commitment + descriptor verification,
  fail-closed `evaluateEntitlement`.

## Hard rules (ADR-0033 — do not break)

- **R3 — no rendering text** in any descriptor, a commitment preimage we store,
  or on-chain. Descriptors carry a `retrievalPointer`.
- **R1 — no licensed/copyrighted content** in src/tests/fixtures (CI:
  `check:no-licensed-content`).
- **R4 — content-agnostic.** No faith/vertical vocabulary; `contentType` + the
  `ReferenceScheme` are app-injected (CI: `check:no-domain-in-packages`).
- **R5 — trust = issuer signature + access policy**, never a platform claim.

## Boundary

Allowed imports: `@agenticprimitives/types`, `@agenticprimitives/verifiable-credentials`,
`viem`. ERC-1271 verification is **injected** (`SignatureVerifier`, ADR-0006) — do
NOT import `agent-account`/`agent-naming`; apps compose them.

## Drift triggers — STOP

- "Register a locus / give a verse an SA / put it in `agent-naming`" — **STOP.**
  Loci are scheme-anchored content (ADR-0033).
- "Store the verse text / put text in the commitment we keep / on-chain" — **STOP** (R3).
- "Hardcode a translation, book table, OSIS grammar, or `'bible-verse'`" — **STOP.**
  App layer (spec 267); inject a `ReferenceScheme`.
- "Implement the ZK/payment reserved fns" — that's Phase 4/5 (spec 266 §6).

## Read first

`../../specs/266-verifiable-content-substrate.md` ·
`../../docs/architecture/decisions/0033-content-agnostic-verifiable-content-firewall.md`
· then `src/index.ts`.

## Validate

```bash
pnpm --filter @agenticprimitives/content-primitives typecheck
pnpm --filter @agenticprimitives/content-primitives test
```
