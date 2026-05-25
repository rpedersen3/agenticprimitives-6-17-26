# @agenticprimitives/agent-account

ERC-4337 Smart Agent substrate — **canonical identity owner**.

Every person, org, service, or treasury agent is anchored by its Smart Agent
address (`0x…` / CAIP-10 `eip155:<chainId>:<address>`). This package deploys
that account, derives its address, builds UserOps, and verifies ERC-1271
signatures. Names, profiles, and passkeys are **facets** handled by sibling
packages.

> **Layer:** Core — the canonical identity **anchor**.
> **Canonical key:** Smart Agent address (CAIP-10 `eip155:<chainId>:<address>`). Names / profiles / edges point AT it; they never *are* the identity.

## Use This When

- You need counterfactual or deployed Smart Agent addresses (CREATE2 factory).
- You need `createAccount`, `isDeployed`, `buildUserOp`, or ERC-1271 verify paths.
- You need bundler helpers (`BundlerClient`, packed UserOp gas fields).
- You need quorum / admin payload hashing for custody-gated account actions.

## Do Not Use This For

- Passkey ceremonies, SIWE, OAuth, or JWT sessions → `identity-auth`.
- `.agent` name registration or resolution → `agent-naming`.
- AgentCard profiles or endpoint verification → `agent-identity`.
- Custodian enrollment, credential recovery, or quorum scheduling → `custody`.
- Delegation tokens or session authority → `delegation`.

## Install

Workspace-internal; not yet published.

```bash
pnpm add @agenticprimitives/agent-account
```

## 60-Second Quickstart

```ts
import { AgentAccountClient } from '@agenticprimitives/agent-account';
import { deriveSaltFromEmail } from '@agenticprimitives/connect-auth';
import type { Signer } from '@agenticprimitives/connect-auth';

const account = new AgentAccountClient({
  rpcUrl: process.env.RPC_URL!,
  chainId: 84532,
  entryPoint: process.env.ENTRYPOINT_ADDRESS as `0x${string}`,
  factory: process.env.AGENT_FACTORY_ADDRESS as `0x${string}`,
});

// Salt from auth scope — NOT from a .agent name (ADR-0010).
const salt = deriveSaltFromEmail(user.email, 0);
const address = await account.getAddress(bootstrapSigner.address, salt);

if (!(await account.isDeployed(address))) {
  await account.createAccount(
    { owner: bootstrapSigner.address, salt },
    bootstrapSigner as Signer,
  );
}
```

## Main Concepts

- **Smart Agent address**: the canonical identifier; stable across credential
  rotation ([ADR-0011](../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md)).
- **CREATE2 salt**: from auth methods + user scope only — never from `.agent`
  names ([spec 220](../../specs/220-agent-identity-bootstrap.md)).
- **Signer**: pluggable interface from `identity-auth`; this package consumes it.
- **UserOperation**: ERC-4337 v0.8 UserOp build path via `buildUserOp`.

See [`docs/concepts.md`](docs/concepts.md).

## Common Recipes

```ts
import { buildExecuteCallData, type ContractCall } from '@agenticprimitives/agent-account';

const calls: ContractCall[] = [
  { to: target, value: 0n, data: calldata },
];
const executeData = buildExecuteCallData(calls);
```

```ts
import { encodeWebAuthnSignature, SIG_TYPE_WEBAUTHN } from '@agenticprimitives/agent-account';
// WebAuthn ceremony output is produced by identity-auth; on-chain wire format here.
```

## Runtime Support

Node and browser via `viem`. Requires RPC URL for chain reads and transaction
submission.

## Security Invariants

- Salt derives from stable keccak inputs; no raw user-supplied salt bytes.
- EntryPoint version is explicit in client config.
- Bootstrap signer is distinct from day-to-day custodian signers.

See [`docs/security.md`](docs/security.md) and [`AUDIT.md`](AUDIT.md).

## Documentation Map

- [`docs/concepts.md`](docs/concepts.md) — canonical identity vs facets.
- [`docs/api.md`](docs/api.md) — public API guide.
- [`docs/security.md`](docs/security.md) — invariants and trust boundaries.
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — common errors.
- [`docs/migration.md`](docs/migration.md) — migration notes.
- [`CLAUDE.md`](CLAUDE.md) — agent routing.
- [`spec.md`](spec.md) — spec pointer.

## Validation

```bash
pnpm check:agent-account
pnpm check:forbidden-terms
```

## License

UNLICENSED.
