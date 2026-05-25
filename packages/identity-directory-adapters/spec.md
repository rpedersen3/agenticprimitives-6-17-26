# Spec — @agenticprimitives/identity-directory-adapters

This package implements the ports defined by
[`specs/223-identity-directory.md`](../../specs/223-identity-directory.md) §5
(NamingPort / OnChainReadPort / IndexerPort). The directory's contract — domain
model, convergence, doctrine — is spec 223; this package adds no new contract,
only source bindings.

Decision record: [ADR-0015 — identity-directory is an evidence-backed read model](../../docs/architecture/decisions/0015-identity-directory-is-an-evidence-backed-read-model.md).
Boundary: [spec 100 §4](../../specs/100-package-boundary-doctrine.md) — adapters is
the one composition layer permitted to import `agent-naming`.

This file is the per-package pointer required by `check:package-docs`; do not
duplicate the spec here — edit spec 223.
