# ADR-0002 — Session lifecycle lives in `delegation`, not `key-custody`

**Status:** accepted (2026-05-19)
**Supersedes:** initial scaffold that placed `SessionManager` in `key-custody`

## Context

The first scaffold put session lifecycle (`SessionManager`, `SessionStore`, encrypt/decrypt of session packages) inside `key-custody` because envelope encryption *implementation* was there. Competitive research showed this was structurally wrong.

Signals:
- **Lit Protocol** puts SessionSigs in `@lit-protocol/auth-helpers`, not in the signing or crypto packages.
- **Turnkey** binds `UserSession` to stampers (credential layer), not to chain signers.
- **Privy** ties server sessions to the authorization key (authority layer), not to a separate KMS package.
- **Coinbase CDP** describes "delegated signing" as a session abstraction living next to policy APIs, not next to KMS.

The unifying rule: **session = bounded authority over time**. Authority belongs where it's expressed (the delegation), not where it's stored (the KMS).

## Decision

`@agenticprimitives/delegation` owns `SessionManager`, `SessionStore`, `SessionRow`, `SessionPackage`, `SessionMeta`. It manages the lifecycle (init → package → resolve → revoke).

`@agenticprimitives/key-custody` owns the **primitives** the SessionManager calls into: `generateSessionDataKey`, `decryptSessionDataKey`, `signA2AAction`. It does not know what a session is structurally; it encrypts opaque byte payloads with AAD that the caller supplies.

The AAD shape (sessionId hash, account address, chain id, expiresAt, keyVersion) is constructed in `delegation` and passed into `key-custody` as `aadContext: Record<string, string>`.

## Consequences

- An MCP server developer reading `key-custody`'s public API sees primitives, not lifecycle. Mental model stays narrow.
- A consumer who wants a different session model (e.g., per-tool-call session, or a recovery-keyed session) reimplements `SessionManager` in their own code without touching `key-custody`.
- `key-custody` becomes drop-in-replaceable: any provider that implements `A2AKeyProvider` works, including custom ones (Vault, Nitro Enclaves) we never ship.
- The cost: `delegation` now depends on `key-custody` (`A2AKeyProvider` interface). Acceptable — that's the natural dependency direction.

## To reverse this

You'd need to show that the abstraction boundary is causing real concrete pain (not theoretical churn). The KMS landscape is unanimous on this split; departing from it requires evidence that our use case is genuinely different.

## References

- [`specs/100-package-boundary-doctrine.md`](../../../specs/100-package-boundary-doctrine.md) §S4 ("Session lifecycle lives with delegation/authority, not with KMS")
- [`specs/202-delegation.md`](../../../specs/202-delegation.md) §5 (session-delegation lifecycle)
- [`specs/203-key-custody.md`](../../../specs/203-key-custody.md) §1 (out-of-scope: session lifecycle)
