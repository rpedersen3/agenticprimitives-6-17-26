# @agenticprimitives/delegated-signer — audit notes

**Status:** w1-foundational (pure SDK). No contracts, no network I/O, no key material held.

## Trust model

- The package is **mechanical composition**: it resolves a name (via an injected
  resolver), confirms the account (injected verifier), checks a delegation
  chain's authority linkage, and returns a signer bound to the chain's leaf key.
  It holds no keys and opens no connections — naming/account/chain access are all
  INJECTED (ADR-0006), so the package is a pure, unit-testable leaf.
- It does NOT perform on-chain ERC-1271 signature verification of each delegation
  link — that is `@agenticprimitives/delegation`'s `verifyAuthorization`, injected
  upstream when needed. This package verifies STRUCTURE + authority-hash linkage.

## Security invariants (tested — `test/unit/resolve-delegated-signer.test.ts`)

- **Rooted at the named SA** — `chain[0]` must be a ROOT delegation
  (`authority == ROOT_AUTHORITY`) whose `delegator` equals the resolved name's SA.
- **Cryptographic chain linkage** — each link's `authority` must equal
  `hashDelegation(parent, chainId, delegationManager)` and its `delegator` must
  equal the parent's `delegate`. A tampered authority or broken continuity throws.
- **Terminates at the signer key** — the leaf's `delegate` must equal the
  backend's `getSignerAddress()`; a chain authorizing a different key is rejected.
- **Fail-closed** (ADR-0013) — unresolved name, invalid/undeployed account, or
  empty/broken chain all throw; no fallback path.

## Out of scope

- On-chain signature verification of links (inject `verifyAuthorization`).
- KMS signing internals (`@agenticprimitives/key-custody`).
- Naming/registry and account-deployment logic (injected app clients).
