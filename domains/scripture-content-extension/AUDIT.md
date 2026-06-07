# @agenticprimitives/scripture-content-extension — audit notes

**Status:** Phase 1. Pure functions, no I/O, no key material, no network.

## Trust model

A vertical-extension package: it addresses + selects scripture, nothing more. It
holds no rendering text, no translation, and grants no access. All trust
decisions (issuer signatures, entitlements, policy) happen in the core
`verifiable-content` SDK and the consuming app.

## Security invariants (tested)

- **Canonical convergence** — all surface aliases for a verse normalize to one
  canonical form → one `canonicalId` (`test/parse.test.ts`).
- **Confusable defense** — non-ASCII aliases are rejected (homograph attack).
- **No translation in the name** — unknown leading tokens (e.g. `niv.`) fail book
  lookup; editions are descriptor metadata only.
- **Range validation** — out-of-range chapters are rejected.
- **Governance seam** — `versification` is part of the canonical form; changing
  it is a deliberate new namespace.

## Out of scope

USFM/OSIS *full* parsers, apocrypha/deuterocanon, multiple versification systems,
cross-references, rendering text, translations. Phase 2+.
