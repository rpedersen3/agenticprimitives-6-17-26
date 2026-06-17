# @agenticprimitives/entitlements — spec

Full design: [`../../specs/277-mcp-delegated-vault-authorization.md`](../../specs/277-mcp-delegated-vault-authorization.md) §10.

This release implements the **matching engine** (`matchesEntitlement`, `resolveEntitlements`,
`InMemoryEntitlementResolver`) — the fail-closed resource/action/field/purpose/classification check.
Additive sub-waves add VC proof verification (`verifiable-credentials`), status-list revocation
(`BitstringStatusResolver`), presentations, and storage caches (`D1EntitlementCache`).

Architecture decisions:
- [ADR-0021](../../docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md) — generic;
  storage caches with platform types live in apps.
- [ADR-0013](../../docs/architecture/decisions/0013-no-silent-fallbacks.md) — fail-closed: deny unless a
  credential explicitly matches.

Do not edit a divergent copy here — edit the canonical spec.
