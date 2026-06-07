# @agenticprimitives/scripture-content-extension — Claude guide

The **scripture vertical** for the verifiable-content substrate (spec 267). It
lives in the **`domains/` tier** (NOT `packages/`) — a reusable, named package
that carries vertical vocabulary, kept out of the pure-substrate `packages/` tree
(ADR-0021 + ADR-0033). Generic core stays in `packages/content-primitives`.

## What it owns

- `BOOKS` / `lookupBook` — the 66-book Bible canon (OSIS codes). Reference data,
  not a translation, not rendering text.
- `VERSIFICATION_V1` — the versioned verse-numbering model (the governance seam;
  spec 266 §2.1). Changing it = a deliberate new canonicalId namespace.
- `scriptureCanonicalLocus()` / `scriptureEnvelope()` — the **controlled-token,
  scheme-independent** locus + envelope the core hashes into a `canonicalId`.
  Validates ranges/integers before hashing. All surface grammars normalize here.
- `parseScriptureAlias()` — `scripture:john.3.16` + OSIS/USFM/tolerant forms →
  one canonical locus. ASCII-only (confusable defense).
- `scriptureSelector()` — the structured `selector` an app puts on a descriptor.

## Hard rules (ADR-0033)

- **No rendering text, no specific translation** here (R1/R3). Editions + text
  are the app's off-platform store; this package only **addresses + selects**.
- **Translation/edition is NEVER part of the public name** — it's descriptor
  metadata (spec 267 §2). `niv.john.3.16` is not a valid alias (book lookup fails).
- **All aliases for one verse → one canonicalId.** The id is scheme-independent
  (FRBR Work); never bake a surface grammar into it.

## Boundary

Depends only on `@agenticprimitives/content-primitives` (for `canonicalReference`
/ `CanonicalLocusEnvelope`). Must not import naming/profile/relationships/mcp-runtime.

## Drift triggers — STOP

- "Put verse text / a translation here" — STOP (R1/R3). App store only.
- "Accept `niv.` / `esv.` as an alias prefix" — STOP. Editions are descriptor metadata.
- "Encode the surface scheme into the canonicalId" — STOP. The id hashes the
  scheme-INDEPENDENT form; only `versification` (versioned) changes it.

## Validate

```bash
pnpm --filter @agenticprimitives/scripture-content-extension typecheck
pnpm --filter @agenticprimitives/scripture-content-extension test
```
