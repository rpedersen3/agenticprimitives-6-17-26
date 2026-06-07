# @agenticprimitives/content-primitives — audit notes

**Status:** Phase 1 (pure SDK). No contracts, no network I/O, no key material.

## Trust model

- The package is **mechanical**: it computes ids/commitments/hashes, builds and
  verifies descriptors, and evaluates a deterministic entitlement policy. It
  asserts nothing about whether a rendering is "correct" — trust flows from the
  issuer's ERC-1271 signature + the corpus access policy (R5).
- ERC-1271 verification is **injected** (`SignatureVerifier`); the package never
  holds keys or talks to a chain. Apps wire a verifier backed by
  `AgentAccountClient.isValidSignature`.

## Security invariants (tested)

- **Deterministic locus** — equal-normalizing references → identical `locusId`
  (`test/reference.test.ts`).
- **No rendering text (R3)** — `ContentDescriptor` has no text field; commitments
  are keccak hashes of off-platform text; `buildCitationAssertion` carries the
  commitment, never the text (`test/entitlement.test.ts`, `test/descriptor.test.ts`).
- **Fail-closed descriptor verify** — bad issuer signature, missing
  merkle-inclusion proof, or `zk` (reserved) → `{ok:false}`
  (`test/descriptor.test.ts`).
- **Fail-closed gating** — `licensed`/`private` without a matching, unexpired
  entitlement, or an unknown policy → `deny` (`test/entitlement.test.ts`).
- **No silent no-ops** — reserved ZK/payment fns throw (ADR-0013).

## Out of scope (reserved; throw until implemented)

ZK inclusion / citation proofs (Phase 4), paid access via payment mandates
(Phase 5), the on-chain `ContentCorpusRegistry` (Phase 3). See spec 266 §6.

## Known limitations

- `descriptorHash` uses sorted-key canonical JSON (JCS-style) over hex/string
  fields; it is not a full RFC 8785 implementation (no number normalization) —
  sufficient because descriptor fields are strings/hex. Revisit if numeric
  fields are added.
- Merkle tree uses sorted-pair hashing — sibling order is intentionally
  irrelevant; membership (not position) is what is proven.
