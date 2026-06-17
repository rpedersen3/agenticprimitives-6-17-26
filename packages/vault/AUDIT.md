# @agenticprimitives/vault — audit notes

**Status:** w1-phase1 (the `Vault` seam). No encryption, no key material, no network I/O yet.

## Trust model (Phase 1)

- This package owns the **interface**, not the enforcement. Phase 1 deliberately preserves current
  behavior: the in-memory reference adapter stores plaintext, and consuming apps wrap their existing
  (plaintext) storage behind the same interface. The security value of Phase 1 is the **seam** — it
  forces all sensitive access onto one path so encryption (Phase 2), entitlements (Phase 3),
  DecryptGrant key-release (Phase 4), and required audit (Phase 5) can be added behind it.
- The package holds **no keys** and performs **no crypto** yet; it is runtime-agnostic and
  dependency-free.

## Security invariants (tested — `test/unit/vault.test.ts`)

- **Tombstone semantics** — `write({ data: null })` soft-deletes; tombstoned objects are absent from
  `read` and `list`.
- **Owner isolation** — objects are keyed by `(owner, resource)`; `list(owner)` returns only that
  owner's live objects; owner match is case-insensitive (mirrors D1 adapters' lower-casing).
- **Field projection** — `read({ fields })` returns only the requested keys of a plain record (Phase 1
  is a shallow plaintext projection; Phase 3 makes it a physical per-field decrypt).

## Not yet enforced (later phases — do not assume present)

- Encryption at rest, key wrapping, crypto-shredding (Phase 2 / `key-custody`).
- Entitlement / classification-ceiling checks (Phase 3 / `entitlements`).
- One-time key-release `DecryptGrant` (Phase 4 / `key-authorization`).
- Required PII-free audit on sensitive access (Phase 5 / `audit`).

Until those land, callers MUST keep their existing delegation + classification gates in place; the
`Vault` seam does not yet add authorization.
