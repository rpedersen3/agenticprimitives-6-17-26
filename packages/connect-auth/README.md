# @agenticprimitives/connect-auth

**Credential connection** for Smart Agents — passkey, SIWE, and OAuth ceremonies,
JWT sessions, and pluggable `Signer` interfaces.

This package resolves **how a user proves control** (passkey, EOA, OAuth). The
**canonical identity** is the Smart Agent address (`agent-account`). Session JWTs
use the SA as primary subject; credentials appear as signer claims only
([ADR-0010](../../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md)).

Identity persists. Credentials rotate ([ADR-0011](../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md)).
Custodian add/remove belongs to `custody`, not here.

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
- Public AgentCard profiles → `agent-identity`.
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

## Security Invariants

- JWT secrets never logged; CSRF origin exact-match.
- WebAuthn challenges one-shot.
- Salt derivation deterministic (keccak).

See [`docs/security.md`](docs/security.md) and [`AUDIT.md`](AUDIT.md).

## Documentation Map

- [`docs/concepts.md`](docs/concepts.md) — credential vs canonical SA.
- [`docs/api.md`](docs/api.md) — public API guide.
- [`docs/security.md`](docs/security.md) — invariants.
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — common errors.
- [`docs/migration.md`](docs/migration.md) — migration notes.
- [`CLAUDE.md`](CLAUDE.md) — agent routing.
- [`spec.md`](spec.md) — spec pointer.

## Validation

```bash
pnpm check:identity-auth
pnpm check:forbidden-terms
```

## License

UNLICENSED.
