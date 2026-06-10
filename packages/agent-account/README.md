# @agenticprimitives/agent-account

**The address IS the identity.**

Every person, organization, service agent, and treasury in this stack is an ERC-4337 Smart Agent address (`0x…` / CAIP-10 `eip155:<chainId>:<address>`). Not a username with a wallet attached — the address itself is the canonical identity, and everything else (names, passkeys, profiles, registry entries) is a replaceable facet pointing at it. This package is where that anchor comes from: it derives the address counterfactually, deploys the account, builds UserOperations, and verifies ERC-1271 signatures.

That design choice has a consequence most smart-account SDKs cannot offer: the CREATE2 salt derives from auth methods and user scope — never from a name, never from credential material ([ADR-0010](../../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md), [spec 220](../../specs/220-agent-identity-bootstrap.md)). Lose a passkey, rotate a signer, change your name — the address never moves, and every delegation it ever issued stays valid ([ADR-0011](../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md)).

> Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

## Use This When

- You need counterfactual or deployed Smart Agent addresses (CREATE2 factory).
- You need `createAccount`, `isDeployed`, `buildUserOp`, or ERC-1271 verify paths.
- You need bundler helpers (`BundlerClient`, packed UserOp gas fields).
- You need quorum / admin payload hashing for custody-gated account actions.

## Do Not Use This For

- Passkey ceremonies, SIWE, OAuth, or JWT sessions → `connect-auth`.
- `.agent` name registration or resolution → `agent-naming`.
- AgentCard profiles or endpoint verification → `agent-profile`.
- Custodian enrollment, credential recovery, or quorum scheduling → `account-custody`.
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

The address exists before the account does. You can name it, fund it, and issue authority to it counterfactually; deployment happens when it first acts.

## Main Concepts

- **Smart Agent address**: the canonical identifier; stable across credential
  rotation ([ADR-0011](../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md)).
- **CREATE2 salt**: from auth methods + user scope only — never from `.agent`
  names ([spec 220](../../specs/220-agent-identity-bootstrap.md)).
- **Signer**: pluggable interface from `connect-auth`; this package consumes it.
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
// WebAuthn ceremony output is produced by connect-auth; on-chain wire format here.
```

## How it's different

Safe, ZeroDev, and Alchemy Account Kit ship excellent smart accounts — and stop there. The account is a container; who it is, what it may do, and how to prove it are someone else's integration problem. Here the account is the anchor of a substrate: the same address that `agent-account` derives is what `agent-naming` resolves, `account-custody` governs, `delegation` issues authority from, and `audit` attributes evidence to. The account contract itself is a thin ERC-7579 modular core ([spec 209](../../specs/209-erc7579-module-taxonomy.md)) — custody, threshold, and session machinery are modules, not inlined features. We ported the patterns worth porting (Safe-style signature packing) without taking a runtime dependency on anyone else's account stack.

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

## Status

Testnet/pilot-ready. Production launch is gated on the public checklist in the root README — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).

## License

UNLICENSED.
