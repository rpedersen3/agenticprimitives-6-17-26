# Agent Naming Security

This package is a **facet registry**, not the identity anchor. Treat names as
user-facing labels; bind authority to Smart Agent addresses and contract checks
([ADR-0010](../../../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md)).

## Read-Path Discipline (No Log Scans)

Binding: [ADR-0012](../../../docs/architecture/decisions/0012-no-eth-getlogs-in-product-read-paths.md).

Product reads must use `readContract` only:

- `resolveName` and `getRecords` — compliant.
- `reverseResolve` — on-chain round-trip uses `readContract`; returning the
  dotted string currently uses **chunked `eth_getLogs`** in `_reconstructName`
  (**transitional debt** — do not add more log walkers).

Approved exits: store plaintext `label` on chain, or a naming indexer, or app
cache after registration. Chunking log ranges does not make log scans an
acceptable long-term pattern.

## Deterministic Normalization

Every name must normalize the same way on every runtime:

1. NFC normalize.
2. Trim whitespace.
3. Lowercase.
4. Validate labels.

Two strings that normalize identically must produce the same `namehash`.

Phase 1 uses ASCII-only labels to avoid Unicode spoofing and homoglyph attacks.
Do not loosen this until the package has a full IDN/punycode policy and golden
vectors.

## Forward And Reverse Resolution

Forward resolution answers:

```text
name -> address
```

Reverse resolution answers:

```text
address -> primary name
```

Reverse resolution is only trustworthy when it round-trips:

```text
reverseResolve(address) -> name
resolveName(name) -> same address
```

This prevents a malicious account from claiming someone else's name as its
primary name.

## Unknown Predicates

The record layer has asymmetric behavior:

- Encode side is strict. Unknown fields are not representable through
  `AgentNameRecords` and known fields are validated before encoding.
- Decode side is forward-compatible. Unknown predicate ids are ignored.

This prevents clients from accidentally writing unsupported records while still
allowing older readers to survive newer resolver schemas.

## Passkey Material

Never store raw passkey credential IDs in naming records.

The only passkey-related record is `passkeyCredentialDigest`, a `bytes32` hash
of the credential ID. Use it for UI correlation only, not as an auth secret.

## CAIP-10 Native ID

`nativeId` must match CAIP-10 grammar on encode:

```text
namespace:reference:account
```

Phase 1 encode-side namespaces are allowlisted:

- `eip155`
- `hedera`
- `solana`

`eip155` account addresses are lowercased during encode. Decode remains more
permissive so clients do not fail on future namespaces.

## Endpoint Records

`a2aEndpoint` and `mcpEndpoint` are discovery records. They tell clients where
an agent service claims to be reachable.

They do not prove endpoint control. If a product needs endpoint-control proof,
compose with `@agenticprimitives/agent-profile` verification methods.

## Naming Is Not Account Safety Policy

This package can build calls that rotate name owners, resolvers, records, and
subregistries. It does not decide who is allowed to submit those calls.

Authorization lives in the owner Smart Agent and its account safety policy. The
call builders return encoded calldata only; transaction submission and approval
flows happen outside this package.

## Subregistries

Subregistries can make child-name issuance easier, but they change the authority
model for a whole subtree.

Before setting a subregistry, decide:

- who can register children
- whether registration requires a credential, invite, fee, or stake
- whether names expire
- how disputes and reserved names are handled
- whether the subtree should ever become permissionless

For organization/service namespaces, prefer permissioned or credential-gated
subregistries unless anti-spam rules are already deployed.
