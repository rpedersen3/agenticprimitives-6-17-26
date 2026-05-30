# Agent Account Concepts

`@agenticprimitives/agent-account` owns the **canonical Smart Agent identifier**:
the ERC-4337 account address on chain ([ADR-0010](../../../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md)).

## Canonical Identity

| Question | Answer |
| --- | --- |
| What is the identity? | The deployed (or counterfactual) Smart Agent `Address`. |
| Wire format | CAIP-10 `eip155:<chainId>:<address>` (encode helpers may live in `agent-profile` or `types`; the address is authoritative here). |
| What is NOT identity? | `.agent` names, JWT subjects without SA resolution, EOAs, passkey credential IDs, profile URIs. |

Identity starts with the agent account. Not the user wallet, not the name, not
the registry.

## Facets Point At This Address

Sibling packages register facets that reference the same SA:

- **`agent-naming`** — `addr` + `nativeId` resolver records, primary name.
- **`agent-profile`** — AgentCard profile anchored at the SA subject.
- **`connect-auth`** — resolves passkey / SIWE to the SA that lists them as
  custodians; does not create the SA.
- **`custody`** — adds / rotates custodians on the SA via `CustodyPolicy`.

Apps compose the bootstrap sequence in [spec 220](../../../specs/220-agent-identity-bootstrap.md).

## CREATE2 Addressing

Addresses are deterministic from:

- factory + init code hash
- owner / auth material
- **salt** (from `connect-auth` helpers such as `deriveSaltFromEmail` or
  `deriveSaltFromLabel` for **user scope**)

Salt MUST NOT include:

- chosen `.agent` name or label
- profile content hash
- rotating credential material ([ADR-0011](../../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md))

## Signer Pluggability

This package consumes `Signer` from `connect-auth` (Passkey, EOA, KMS-backed).
It does not run WebAuthn ceremonies or store keys. That split follows spec 100 §
S1 (signer is a peer of the account, not embedded).

## UserOperations

`buildUserOp` assembles ERC-4337 v0.8 UserOps for the configured EntryPoint.
Execution batches use `buildExecuteCallData` for `AgentAccount.execute` calldata.

Bundling / gas packing is available via `BundlerClient` for consumers that talk
to a bundler RPC directly.

## Relationship To Custody

Threshold, recovery, and custodian-set changes live in `CustodyPolicy` (see
`account-custody` package + spec 209). This package exposes account-side helpers (quorum
signature packing, admin payload hashes) but not custody vocabulary in the hot
path.
