# Identity Auth Concepts

`@agenticprimitives/connect-auth` is the **credential and session layer**. It
connects users to Smart Agents; it does **not** own canonical identity
([ADR-0010](../../../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md)).

## Credential Vs Canonical Smart Agent

| | Credential | Canonical Smart Agent |
| --- | --- | --- |
| Examples | Passkey, SIWE EOA, Google subject | ERC-4337 SA `Address` |
| Package | `connect-auth` (ceremony + session) | `agent-account` (deploy + UserOps) |
| Rotates? | Yes, via `custody` recovery | No — same address across rotation |
| JWT role | Signer claim | **Primary subject** |

Flow ([spec 220 § 6](../../../specs/220-agent-identity-bootstrap.md)):

1. User completes passkey or SIWE ceremony (`connect-auth`).
2. App looks up which Smart Agents list that credential as custodian.
3. If multiple matches, user picks the active SA.
4. Session is keyed by canonical SA address.

## Signer Interfaces

`Signer`, `PasskeySigner`, `EOASigner`, `KMSSigner` are the contract between
auth and execution:

- `agent-account` consumes `Signer` for deploy and UserOp signing.
- `key-custody` provides concrete `KMSSigner` implementations.
- This package defines interfaces and passkey/EOA ceremony helpers only.

## Salt Derivation

`deriveSaltFromEmail` and `deriveSaltFromLabel` feed CREATE2 salt for
**counterfactual address derivation** in `agent-account`.

These inputs represent **stable user / auth scope**, not:

- `.agent` registered names (`agent-naming`)
- AgentCard content (`agent-profile`)

Mixing name into salt would couple identity to a facet that can change.

## JWT Session Vs Delegation Session

| Term | Package | Meaning |
| --- | --- | --- |
| JWT session | `connect-auth` | Signed cookie bound to authenticated user + SA |
| `SessionRow` | `delegation` | Delegation-bound session signing key lifecycle |

See [vocabulary-map](../../../docs/architecture/vocabulary-map.md).

## What This Package Does Not Do

- Deploy Smart Agents (`agent-account`).
- Add or remove custodians (`custody` / `CustodyAction.RecoverAccount`).
- Register `.agent` names or publish AgentCards (facet packages).
- Mint delegation tokens (`delegation`).

## Credential Recovery Wording

Product copy: "recover **access** to this Smart Agent," not "recover identity."
After recovery the JWT primary subject is unchanged — the same SA address
([ADR-0011](../../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md)).
