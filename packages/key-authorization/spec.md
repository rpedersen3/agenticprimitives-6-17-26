# @agenticprimitives/key-authorization — spec

Full design: [`../../specs/277-mcp-delegated-vault-authorization.md`](../../specs/277-mcp-delegated-vault-authorization.md) §5 + §14.

This release: `DecryptGrantV1` construction (`createDecryptGrant`, canonical `grantHash`),
KAS verification (`verifyDecryptGrant` — scope/fields/purpose/classification/expiry/one-time-JTI/
auth-hash binding → `KeyReleaseDecision`), one-time `ReplayStore` (`createInMemoryReplayStore`), and
`createLocalDevKeyAuthorizationService`. Additive: signed grant proofs (Eip712Signature2026/JWS),
`RemoteKmsKeyAuthorizationService`, `D1KeyGrantLedger`, `DurableObjectGrantReplayStore`.

Decisions: [ADR-0013](../../docs/architecture/decisions/0013-no-silent-fallbacks.md) (fail-closed;
one-time JTI consumed only after all checks pass) · [ADR-0021](../../docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md).
Authority is NOT key custody — key-custody does the DEK unwrap; this package decides release.

Do not edit a divergent copy here — edit the canonical spec.
