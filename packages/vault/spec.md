# @agenticprimitives/vault — spec

The full design lives in
[`../../specs/277-mcp-delegated-vault-authorization.md`](../../specs/277-mcp-delegated-vault-authorization.md)
(§13 Vault Package) with landscape analysis in
[`../../docs/feature-analysis/13-agentic-delegated-vault.md`](../../docs/feature-analysis/13-agentic-delegated-vault.md).

This package is the **`Vault` seam** — the interface every sensitive read/write flows through.
It is delivered in phases (spec 277 §22.1 / §26):

1. **Phase 1 (this):** interface + classification taxonomy + persisted envelope shape + in-memory
   adapter. Adapters preserve current (plaintext) behavior.
2. **Phase 2:** envelope encryption (`crypto` refs; `key-custody` wraps DEKs; R2 ciphertext / D1 metadata).
3. **Phase 3:** field projection + entitlement checks.
4. **Phase 4:** `DecryptGrant` / KAS one-time key-release.
5. **Phase 5:** required, PII-free audit on read/write/key-release (fail-closed).

Architecture decisions:
- [ADR-0021](../../docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md) — generic,
  vertical-agnostic; storage adapters with platform types live in apps.
- [ADR-0013](../../docs/architecture/decisions/0013-no-silent-fallbacks.md) — one release path;
  sensitive reads fail closed.

Do not edit a divergent copy here — edit the canonical spec.
