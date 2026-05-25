# Identity Auth Security

Treat this package as the **front door** to Smart Agents, not as the identity
store.

## Resolve Credential Before Authority

Never authorize "holder of credential X" without resolving to a canonical Smart
Agent address. JWT primary subject MUST be the SA; credential is a signer claim.

## JWT

- Signing secrets MUST NOT appear in logs or error messages.
- Support key rotation without invalidating in-flight sessions when possible.
- Reject tampered or expired tokens fail-closed.

## CSRF

- Origin allowlist uses exact URL parsing — never substring match.
- CSRF tokens are bound to session id + origin.

## WebAuthn

- Challenges MUST be one-shot (replay protection via nonce / store).
- Prefer `normaliseLowS` before signature encoding.
- Ceremony output is sensitive — do not persist raw attestation in public DBs.

## Salt

- `deriveSaltFromLabel` / `deriveSaltFromEmail` are deterministic keccak paths.
- Do not accept empty labels or emails.
- Never derive salt from `.agent` names or public profile hashes.

## Stateless Package

No database adapters, cookie I/O, or OAuth client secrets in this package.
Consumers own HTTP wiring and secret management.

## Credential Recovery Boundary

This package MUST NOT expose custodian add/remove APIs. Recovery flows through
`custody` so audit events stay `credential.*` not `delegation.*`
([ADR-0011](../../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md)).

## Forbidden Scope

No delegation builders, MCP transport, envelope encryption, or `SessionRow`
lifecycle — see `capability.manifest.json` `forbiddenTerms`.
