# Spec 267 — Scripture Demo Vertical (web + a2a + mcp)

> **v2 (2026-06-07).** The scripture scheme is now a reusable package,
> **`@agenticprimitives/scripture-content-extension`**, living in the top-level
> **`domains/`** tier (NOT `packages/`, so `packages/` stays pure substrate with no
> carve-out; ADR-0021/0033). It owns the Bible canon
> (OSIS + USFM codes), the versioned `ap.scripture.locus.v1` profile
> (`canon`/`versification`), the controlled-token canonical locus, and alias
> parsing that normalizes OSIS/USFM/common forms to ONE canonicalId (spec 266 v2).
> The MCP now does **candidate resolution** (`/tools/resolve` returns screened,
> verified candidate descriptors across editions under the `public-domain-demo`
> trust profile), wires the real **`@agenticprimitives/audit`** sink, and the a2a
> builds an **enriched `CitationAssertion`** (agentRunId/outputId/citationKind).
> Translation/edition is descriptor metadata, **never** part of the public name.

**Status:** v0 (Phase 2 of the verifiable-content roadmap — spec 266 §6).
**Owners:** `apps/demo-bible-web`, `apps/demo-bible-a2a`, `apps/demo-bible-mcp`
(all net-new).
**Depends on:** [spec 266](./266-verifiable-content-substrate.md)
(`@agenticprimitives/content-primitives` + `apcnt:` ontology),
[ADR-0033](../docs/architecture/decisions/0033-content-agnostic-verifiable-content-firewall.md)
(R1–R5).
**Builds on patterns:** the `demo-web` / `demo-a2a` / `demo-mcp` triad (Vite+React
browser; Hono+Workers A2A with `SessionStoreDO`; Hono+Workers+D1 MCP) and its
service-MAC + `withDelegation` wiring (spec 205).

---

## 1. Purpose

A BibleGateway/YouVersion-style experience: a reader picks **book / chapter /
verse** and a **translation (edition)**, and gets the verse text **plus a
provenance card** (issuer, commitment, "verified ✓", citation handle). The MCP
server resolves the passage through the spec-266 naming/descriptor approach. This
is the first usage domain of the generic substrate — **all** Bible/faith
specifics live here, never in packages (R4).

## 2. Hard rules in app terms (from ADR-0033)

- **R2 — one public-domain translation, pluggable.** The demo ships exactly one
  CC0 edition: the **Berean Standard Bible (BSB)** (CC0/public domain worldwide).
  No copyrighted edition appears anywhere (R1). Adding an edition is **data +
  config**: drop a manifest + descriptor set into the corpus store and add one
  registry entry — **no code change**.
- **R3 — no verse text on-chain or in a stored commitment preimage.** The corpus
  store holds text off-chain; descriptors carry `retrievalPointer` +
  `commitment` only. A mock `licensed` edition (synthetic placeholder text, never
  a real copyrighted work) exercises the gated path: its descriptors return a
  pointer + commitment and require an `Entitlement`, never inline text.
- **R5 — trust = issuer signature.** Each edition is published by an **issuer
  Smart Agent**; its `CorpusManifest` and every `ContentDescriptor` are signed
  (ERC-1271). The web app's "verified ✓" reflects that signature + commitment
  check, not a platform claim.

## 3. The reference scheme (app-owned)

The vertical supplies the `ReferenceScheme` adapter spec 266 §4 expects:

- `id = 'bible-verse'`.
- Book table: OSIS book codes (e.g. `Gen`, `John`, `Rev`) — the industry
  standard, app-local data (`src/lib/osis-books.ts`).
- `normalize("John 3:16" | "john.3.16" | "Jn 3.16") → "John.3.16"` (resolve
  abbreviations → OSIS book code, NFC, canonical `Book.C.V`).
- `locusId = computeLocusId('bible-verse', 'John.3.16')` (spec 266 §2.1) — the
  same id regardless of edition. **Translation-independent.**

White-label URI surface (app glue, not an on-chain TLD): MCP resource
`content://bible-verse/<edition>/John.3.16`; web route `/<edition>/John/3/16`.

## 4. Edition registry (the pluggability seam — R2)

`apps/demo-bible-mcp/src/editions/registry.ts` maps an edition id → its corpus:

```ts
interface EditionEntry {
  edition: string;          // e.g. 'bsb'
  version: string;          // e.g. '2023'
  issuerName: string;       // agent-naming name of the issuer SA (generic .agent)
  corpusRef: Hex;           // spec 266 §2.2
  accessPolicy: 'public' | 'licensed' | 'private';
  dataset: string;          // path/binding to the off-chain text + descriptor store
}
export const EDITIONS: EditionEntry[] = [ /* BSB only; + one mock 'licensed' */ ];
```

Adding a real edition = append an entry + load its dataset; zero code change.
A `docs/add-a-translation.md` + a **rights-holder operator guide** template
explain how a rights holder publishes a signed manifest + descriptors for their
own (possibly copyrighted) edition under their own terms — using the generic SDK,
on their own infrastructure (R1/R5).

## 5. The MCP server — `demo-bible-mcp`

Hono + Cloudflare Workers + D1, built on `mcp-runtime` + `tool-policy`
(`declareTool`, `withDelegation`, service-MAC middleware — the `demo-mcp`
pattern). D1 tables: `corpus_text` (edition, locusId, text — off-chain store),
`descriptors` (edition, locusId, descriptor JSON), `token_usage` (JTI),
`audit_events`. A build-time `scripts/ingest-bsb.ts` turns the BSB dataset into
per-locus rows + `ContentDescriptor`s + the corpus Merkle root (off-chain; R3).

Tools (classifications via `declareTool`):

| Tool | Classification | Returns |
| --- | --- | --- |
| `list_editions` | `@sa-tool: service-only`, `@sa-risk-tier: low` | the public edition registry (no auth) |
| `resolve_passage` | `delegation-verified`, `low` | verified `ContentDescriptor` + provenance (issuer name, commitment, signature-ok). **No text.** |
| `get_passage_text` | `delegation-verified`, `low`, `@sa-validation: access-policy` | for `public` editions: descriptor **+ BSB text** (+ commitment for client re-verify). For `licensed`/`private`: text only if a valid `Entitlement` is presented; else `requires-consent`/deny. |
| `verify_citation` | `service-only`, `low` | re-checks a `CitationAssertion` (commitment + issuer sig). |

`get_passage_text` gate uses `verifiable-content.evaluateEntitlement(accessPolicy,
entitlement?)` → `tool-policy`. Every resolve/access emits an `audit` event
(`content.passage.resolve`, `content.passage.access`,
`content.entitlement.verify`) — security-critical access uses the fail-hard sink.

## 6. The A2A agent — `demo-bible-a2a`

Hono + Workers, mirroring `demo-a2a`. Agent card advertises a
`resolve-scripture-passage` skill. On a request it orchestrates:
resolve issuer/corpus (via `agent-naming`) → `computeLocusId` → fetch descriptor
from MCP `resolve_passage` → gate via `Entitlement` → `get_passage_text` →
`verifyCommitment` → `buildCitationAssertion`, calling the MCP over the
service-MAC envelope (`generateServiceMac`/`verifyServiceMac`). The browser talks
to A2A; A2A talks to MCP (same trust boundary as the existing triad).

## 7. The web app — `demo-bible-web`

Vite + React, the `demo-web` proxy pattern (`/a2a/*` → A2A worker). UI:

- **Passage picker:** book → chapter → verse (OSIS book table) + an **edition
  dropdown** (from `list_editions`).
- **Verse view:** the rendered text (BSB) and a **provenance card** —
  issuer display name (reverse-resolved via `agent-naming`), `corpusRef`,
  `commitment`, "verified ✓ (issuer signature + commitment match)", and a
  copyable **citation handle** (the `CitationAssertion`).
- **Entitlement demo (optional, passkey path):** selecting the mock `licensed`
  edition shows "access requires entitlement"; a connect/passkey flow
  (`connect-auth` + `agent-account`) issues an `Entitlement`, after which
  `get_passage_text` returns the (placeholder) text — demonstrating the gate
  without any copyrighted content.

All faith/branding copy, OSIS tables, and the BSB dataset live under
`apps/demo-bible-web/src/lib/domain.ts` + `…/data/` (white-label centralization,
ADR-0021).

## 8. Wiring + deploy

- Workspace filters `@agenticprimitives-demo/bible-{web,a2a,mcp}`; root scripts
  `dev:bible-*`, `check:demo-bible-*`; add to `scripts/dev.sh` (anvil → ingest →
  wrangler dev a2a+mcp → vite).
- New `pnpm check:no-licensed-content` in `check:all` (ADR-0033). The BSB dataset
  is the only edition data committed; the mock `licensed` edition uses synthetic
  text.
- Cloudflare deploy mirrors `deploy-cloudflare.ts` (MCP worker + D1, A2A worker
  with `MCP` service binding, web Pages).

## 9. Acceptance criteria

- `demo-bible-web`: pick `John 3:16` / BSB → renders BSB text + a provenance card
  whose "verified ✓" reflects a real issuer ERC-1271 signature + commitment match.
- `resolve_passage('John 3:16','bsb')` returns a `ContentDescriptor` (no text)
  that `verifyContentDescriptor` accepts; `get_passage_text` returns BSB text +
  commitment that the client re-verifies.
- Mock `licensed` edition: `get_passage_text` denied without an `Entitlement`,
  allowed after issuing one — and the response carries a pointer + commitment,
  **never** inline copyrighted text (there is none in the repo).
- `pnpm check:no-licensed-content` + `pnpm check:no-domain-in-packages` pass.
- Adding a second edition is demonstrably a registry-entry + dataset drop-in (a
  test adds a fixture edition with no code change).

## 10. Out of scope

On-chain `ContentCorpusRegistry` (spec 266 Phase 3); ZK inclusion proofs; paid
access; cross-edition search; non-Bible content domains (the substrate supports
them; this app is scripture-only).
