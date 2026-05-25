# Spec — @agenticprimitives/identity-directory

The authoritative spec is [`specs/223-identity-directory.md`](../../specs/223-identity-directory.md)
(domain model, ports, query API + convergence, doctrine compliance, phased plan).

Decision record: [ADR-0015 — identity-directory is an evidence-backed read model](../../docs/architecture/decisions/0015-identity-directory-is-an-evidence-backed-read-model.md).
Conforms to the ontology in [spec 225](../../specs/225-ontology.md); keys on the
CAIP-10 `CanonicalAgentId` of [ADR-0016](../../docs/architecture/decisions/0016-canonical-agent-id-is-the-sso-subject.md).

This file is the per-package pointer required by `check:package-docs`; do not
duplicate the spec here — edit spec 223.

> Reconciliation note: spec 223 §5 sketched an `OidcPort`; OIDC *verification*
> lives in `connect-auth` (ADR-0017), so the directory core ships three ports
> (Naming / OnChainRead / Indexer) and `resolveByOidcSubject(iss, sub)` takes an
> already-verified subject. The broker wires connect-auth → directory.
