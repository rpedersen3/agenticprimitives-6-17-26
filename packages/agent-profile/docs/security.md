# Agent Identity Security

Profile facets describe a Smart Agent; they do not replace it as the trust root.

## Anchor On Canonical Address

On-chain profile subjects use the Smart Agent address (as `bytes32` uint160).
Off-chain JSON MUST be verifiable against the on-chain `metadata-hash` for that
same agent.

Never treat `displayName` or profile URL as the primary identifier in
cross-package APIs.

## Deterministic Content Hash

`canonicalProfileJson` MUST be stable:

- sorted object keys
- fixed numeric formatting
- rejected non-finite numbers

Two semantically equal profiles MUST yield identical `profileContentHash`.

## Verification Methods

Callers MUST pass explicit `VerificationMethod` values. The client MUST NOT
silently pick a method — avoids ambiguous "verified" states.

Endpoint verification proves URL control, not account policy or delegation scope.

## CAIP-10

Encode path enforces `CAIP10_NAMESPACE_ALLOWLIST`. Decode path accepts
grammar-valid strings for forward compatibility.

`eip155` addresses are lowercased on encode.

## Passkey Material

Profiles MAY include `credentialIdDigest` (hash) only — never raw WebAuthn
credential IDs. Matches `agent-naming` naming-record invariant.

## Refused

- UAID generation ([ADR-0008](../../../docs/architecture/decisions/0008-caip10-nativeid-record-predicate.md)).
- Importing `agent-naming` or `agent-relationships` (compose at app layer).
- OpenZeppelin `AccessControl` on profile contracts — owner SA + custody quorum
  via ERC-1271 ([ADR-0007](../../../docs/architecture/decisions/0007-agent-identity-stack-three-packages.md)).

## Credential Recovery

Rotating a passkey does not change the canonical SA or profile anchor. Profile
content may be updated separately; recovery is not "new agent" language
([ADR-0011](../../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md)).
