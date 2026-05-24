# ADR-0008 — Cross-resolver interop via CAIP-10 `nativeId` record predicate

**Status:** accepted (2026-05-23)
**Owner:** [technical-architect-auditor](../../agents/technical-architect-auditor.md).
**Related:** [ADR-0006](./0006-agent-naming-as-resolution-layer.md),
[ADR-0007](./0007-agent-identity-stack-three-packages.md),
[spec 215](../../../specs/215-agent-naming.md) (records schema),
[spec 217](../../../specs/217-agent-identity.md) (profile schema).

## Context

[HCS-14](https://hol.org/docs/standards/hcs-14/) (Universal Agent
ID, published 2025-09-11) defines a portable agent identifier:
`uaid:aid:<base58(SHA-384(canonical-json))>` — a deterministic
hash of `{ registry, name, version, protocol, nativeId, skills[] }`
where `nativeId` uses CAIP-10 (`eip155:<chainId>:<address>`,
`hedera:<network>:<id>`, etc.).

The standard cross-references ERC-8004 (Trustless Agents) as the
EVM analog. HCS-14-aware resolvers + ERC-8004 indexers can route
to any agent regardless of which registry it lives in, AS LONG AS
they can discover the agent's `nativeId`.

Two options for our `.agent` registry:

1. **Generate full UAIDs in `@agenticprimitives/agent-identity`** —
   compute and store the `uaid:aid:…` string per name. Full two-way
   interop: third parties can route to our agents by UAID, and our
   agents can advertise their UAID.
2. **Expose `nativeId` as an optional record predicate only** — our
   names advertise their CAIP-10 native identifier; HCS-14-aware
   resolvers can wrap them into UAIDs on the consumer side; we
   don't run UAID derivation.

## Decision

**Option 2: CAIP-10 `nativeId` is an optional record predicate. We
do NOT generate UAIDs.**

Concretely:

- Spec 215 § 5 (records schema) gains one new predicate:
  ```
  nativeId  →  string  (CAIP-10 format: "eip155:<chainId>:<address>")
  ```
- `@agenticprimitives/agent-naming/records` adds an encoder/decoder
  + range validation for the CAIP-10 grammar (chain namespace
  whitelist + bytes32 address validation).
- `@agenticprimitives/agent-identity` (spec 217) provides a pure
  helper that builds the CAIP-10 string from `(chainId, address)`:
  ```ts
  export function buildCaip10Address(chainId: number, address: Address): string;
  ```
  Plus a parser for the reverse direction.
- **No UAID computation in any package we ship.** Consumers who
  need a UAID-shaped identifier can compute it from our records
  using HCS-14's algorithm + their own canonical-JSON serializer.

## Rationale

### Why expose `nativeId`

Cross-resolver interop is a low-cost win: a single 60-character
string per name makes our agents addressable by every HCS-14 or
ERC-8004 indexer that wants to consume them. Costs us a record
predicate; gains us the universe of agent-resolution tooling that
ships in 2026+. This is the same logic as having a `mailto:` URL
in your business card — it's a one-line concession that opens up
every email tool ever written.

### Why NOT generate UAIDs

1. **UAID is a derived value.** Anyone with the canonical inputs
   can compute it. Storing it on chain duplicates state without
   adding security; offering it via SDK adds a maintenance burden
   (we'd have to track HCS-14 spec drift, ship golden vectors,
   handle hash-algorithm migrations).
2. **UAID semantics are not ours.** HCS-14 defines what counts as
   the canonical input set, what canonicalization rules apply, and
   how skills are enumerated. Mirroring those rules in our package
   locks us into someone else's spec. Treating it as a consumer-side
   computation lets HCS-14 evolve without breaking our consumers.
3. **Our names ARE the human-readable handle.** Spec 215 § 1
   (Purpose) commits to names being the user-facing identity layer.
   Adding a parallel SHA-384-based identifier creates two competing
   identities for the same thing.
4. **One-way interop is sufficient.** HCS-14 consumers can read our
   nativeId and wrap it; we can read HCS-14 UAIDs by parsing them
   for `nativeId` and resolving on our side. No two-way coupling
   required.

### Why CAIP-10 specifically

[CAIP-10](https://chainagnostic.org/CAIPs/caip-10) is the chain-
agnostic account identifier standard (chain namespace + chain id +
account). It's the lingua franca of:
- WalletConnect v2
- ERC-8004 (Trustless Agents)
- HCS-14 (`nativeId` field)
- Wallet RPC standards (`eth_accounts` → CAIP-10 in EIP-6963 era)

Picking CAIP-10 gives us free interop with all of the above.
Picking anything else costs us all of it.

## Concrete grammar

A `nativeId` record value MUST match the CAIP-10 grammar:

```
chain_id    = namespace + ":" + reference
account_id  = chain_id + ":" + account_address
namespace   = [-a-z0-9]{3,8}
reference   = [-_a-zA-Z0-9]{1,32}
account_address = [-.%a-zA-Z0-9]{1,128}
```

Our encoder restricts to a known-good namespace set in v0:
`eip155` (EVM chains), `hedera`, `solana`. Unknown namespaces
encode to an error; consumers who need additional namespaces submit
a PR to expand the allowlist.

### Examples

```
eip155:84532:0x24045061dc2dd6FfdE1218F27C79637eCe5e7ec7   (Base Sepolia agent)
eip155:8453:0x...                                          (Base mainnet agent)
hedera:testnet:0.0.123456                                  (Hedera testnet agent)
```

## Consequences

**Positive:**
- One-line interop with every HCS-14 / ERC-8004 tool.
- No spec-tracking burden — HCS-14 can evolve their canonical-JSON
  rules without breaking us.
- Consumers who care about UAIDs compute them where they're used
  (close to the use case; trivially up-to-date).
- The `nativeId` record itself is useful even WITHOUT HCS-14 —
  it's the canonical chain+address representation for any
  cross-chain wallet or block explorer that already speaks CAIP-10.

**Negative:**
- Consumers who want a UAID string must compute it themselves.
  Mitigation: spec 217 documents the canonical canonical-JSON
  inputs the consumer needs (our `nativeId` + their choice of
  registry + name + version + protocol + skills).
- If HCS-14 becomes the dominant cross-resolver protocol AND we
  later regret not shipping a UAID helper, we can add one in a
  follow-up wave without breaking the record schema (the helper
  is pure derivation over already-stored data).

## Implementation (lands with spec 215 records update)

`packages/agent-naming/src/records.ts` gains:

```ts
export const PREDICATE = {
  // ... existing predicates ...
  nativeId: 'native-id',  // CAIP-10
} as const;
```

Encoder validates the CAIP-10 grammar; rejects unknown namespaces.
Decoder accepts any well-formed CAIP-10 string.

Tests cover:
- Valid `eip155` / `hedera` / `solana` encodings round-trip.
- Malformed inputs throw on encode.
- Unknown namespaces throw on encode.
- Decoder accepts any grammar-valid string (forward-compatible).

## Validation

- Spec 215 records table shows `native-id` as an optional predicate.
- `packages/agent-naming/test/records.test.ts` has CAIP-10 cases.
- ADR-0007 § "Refused: full HCS-14 UAID derivation" cross-references
  this ADR.
- An external HCS-14-aware resolver consuming `nativeId` is the
  documented interop story (no two-way coupling).
