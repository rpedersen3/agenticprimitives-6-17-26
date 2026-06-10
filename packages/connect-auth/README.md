# @agenticprimitives/connect-auth

**Credential ceremonies that resolve to a canonical identity — not the other way around.**

Most auth SDKs make the credential the identity: lose the passkey, lose the account. `connect-auth` inverts that. Passkey, SIWE, and OAuth are **ceremonies that prove control**; the identity they resolve to is the Smart Agent address ([ADR-0010](../../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md)). Session JWTs carry the SA address as primary subject — the credential is a signer claim only. So when a credential rotates ([ADR-0011](../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md)), the user signs back in as the same agent, with the same delegations, the same name, the same reputation. Identity persists; credentials rotate.

This package also defines the `Signer` interfaces (`Signer`, `PasskeySigner`, `EOASigner`, `KMSSigner`) that `agent-account` and `delegation` consume — the architectural contract that lets the whole stack swap signing backends without touching account or delegation code. Custodian add/remove belongs to `custody`, not here: this package never mutates a credential set, only resolves credential → SA.

> Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

## Use This When

- You implement passkey signup/login (WebAuthn).
- You implement SIWE or Google OAuth sign-in.
- You mint or verify JWT cookie sessions and CSRF tokens.
- You need `Signer` interfaces for `agent-account` or `delegation`.
- You derive CREATE2 salt from stable user scope (`deriveSaltFromEmail`, etc.).

## Do Not Use This For

- Smart Agent deploy, UserOps, or ERC-1271 account logic → `agent-account`.
- Enrolling / rotating custodians on an SA → `custody`.
- `.agent` names → `agent-naming`.
- Public AgentCard profiles → `agent-profile`.
- Delegation tokens or encrypted session rows → `delegation`.
- KMS backends → `key-custody` (implements `KMSSigner`).

## Install

```bash
pnpm add @agenticprimitives/connect-auth
```

## 60-Second Quickstart

```ts
import { mintSession, verifySession } from '@agenticprimitives/connect-auth';
import * as passkey from '@agenticprimitives/connect-auth/passkey';

// In your HTTP handler (app wires cookies):
const { sessionClaims } = await passkey.completeSignup(req);
const cookieValue = mintSession(sessionClaims);
// sessionClaims MUST include canonical Smart Agent address as primary subject
```

```ts
import { deriveSaltFromEmail } from '@agenticprimitives/connect-auth';
import { AgentAccountClient } from '@agenticprimitives/agent-account';

// Salt from user scope — NOT from .agent name.
const salt = deriveSaltFromEmail(user.email, 0);
```

## Main Concepts

- **Credential**: passkey, SIWE EOA, or OAuth identity — control facet, not the SA.
- **Canonical SA**: resolved after auth (custodian lookup); JWT primary subject.
- **Signer**: interface consumed by `agent-account` / `delegation`.
- **JWT session**: signed cookie session (distinct from `delegation` `SessionRow`).

See [`docs/concepts.md`](docs/concepts.md).

## Auth Method Subpaths (Tree-Shakable)

- `@agenticprimitives/connect-auth/passkey`
- `@agenticprimitives/connect-auth/siwe`
- `@agenticprimitives/connect-auth/google`

## How it's different from Privy, Dynamic, and Web3Auth

Hosted auth vendors give you login plus an embedded key, and the identity lives in their database — your users exist because the vendor's account table says so. Here the identity is an on-chain address that no auth provider can revoke, and this package is one composable layer over it:

- **Framework-agnostic and stateless.** No hosted dashboard, no database, no cookie I/O — your app wires HTTP routes and storage; this package handles the cryptographic ceremonies and JWT mint/verify.
- **No key custody.** It defines the `KMSSigner` interface; concrete signing backends live in `key-custody`. The auth layer never holds material it could lose.
- **Login is not authority.** A session JWT proves who signed in. What the agent may *do* is the delegation layer's job — scoped, revocable, on-chain-enforceable — not a side effect of holding a session.

## Security Invariants

- JWT secrets never logged; CSRF origin exact-match.
- WebAuthn challenges one-shot.
- Salt derivation deterministic (keccak).

See [`docs/security.md`](docs/security.md) and [`AUDIT.md`](AUDIT.md).

## Documentation Map

- [`docs/concepts.md`](docs/concepts.md) — credential vs canonical SA.
- [`docs/cross-browser-secure-home-passkey.md`](docs/cross-browser-secure-home-passkey.md) — Chrome/Firefox + Windows Hello secure-home flow.
- [`docs/api.md`](docs/api.md) — public API guide.
- [`docs/security.md`](docs/security.md) — invariants.
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — common errors.
- [`docs/migration.md`](docs/migration.md) — migration notes.
- [`CLAUDE.md`](CLAUDE.md) — agent routing.
- [`spec.md`](spec.md) — spec pointer.

## Status

Testnet/pilot-ready. Production launch is gated on the public checklist in the root README — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).

## Validation

```bash
pnpm check:connect-auth
pnpm check:forbidden-terms
```

## License

UNLICENSED.
