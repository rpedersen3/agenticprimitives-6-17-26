# ADR-0016 — CanonicalAgentId (CAIP-10) is the SSO subject; AgentSession has no owner

**Status:** Accepted (2026-05-25).
**Related:** [spec 224](../../../specs/224-agentic-connect.md), [spec 223](../../../specs/223-identity-directory.md), [ADR-0008](./0008-caip10-nativeid-record-predicate.md), [ADR-0010](./0010-smart-agent-canonical-identifier.md), [ADR-0011](./0011-credential-recovery-and-re-association.md).

---

## Context

[ADR-0010](./0010-smart-agent-canonical-identifier.md) makes the Smart Agent
address the canonical identifier and every name/credential/profile a facet
pointing AT it. SSO must carry a subject across relying sites and **across
chains**. A bare EVM `Address` is ambiguous across chains (the same address can
exist on many chains, and an agent may be deployed on more than one). The P8
`CanonicalAgentIdentity = Address` alias captured "the on-chain account handle"
but is not chain-qualified, so it cannot be the portable SSO subject.

Separately, sessions must not smuggle in an ownership model. A credential
*controls* an agent under a custody policy; it does not *own* it. An
`AgentSession.owner` field would re-introduce the owner concept the custody
vocabulary firewall ([spec 212](../../../specs/212-agent-centric-delegation.md))
deliberately removed, and would imply the session principal has unilateral
authority it does not have.

## Decision

> **The canonical SSO subject is `CanonicalAgentId`, a branded CAIP-10 string
> `<namespace>:<reference>:<smartAgentAddress>` (e.g. `eip155:8453:0x…` or
> `hedera:mainnet:0.0.x`). `AgentSession.sub` carries it. `AgentSession` has NO
> `owner` field.**

- **`CanonicalAgentId` is the promotion of `agent-profile`'s existing
  `Caip10Address` brand into `@agenticprimitives/types` — not a new type.**
  `agent-profile` already ships `Caip10Address = string & { __brand: 'caip10' }`
  plus `Caip10Parts { namespace, reference, address }`, `buildCaip10Address(parts):
  Caip10Address`, `parseCaip10(value): Caip10Parts`, `isValidCaip10`, and
  `CAIP10_NAMESPACE_ALLOWLIST` (`eip155`/`hedera`/`solana`) under its `/caip10`
  subpath (ADR-0008). This wave **moves the TYPE into `types`** — the
  `Caip10Address` brand + `Caip10Parts` — and defines `type CanonicalAgentId =
  Caip10Address` (a semantic alias for the subject role). The **runtime builder
  + parser + allowlist (`buildCaip10Address`/`parseCaip10`/`isValidCaip10`/
  `CAIP10_NAMESPACE_ALLOWLIST`/`InvalidCaip10Error`) STAY in `agent-profile`**,
  because `@agenticprimitives/types` is a runtime-free, zero-dep leaf (its
  invariant) and ADR-0008 already placed the builder there; they are re-typed to
  the promoted brand and re-exported. Net: exactly **one brand and one builder**,
  namespace-plural by construction — NOT an `eip155`-only `(chainId, address)`
  form (which could not express `hedera:*`).
- **Builds on [ADR-0008](./0008-caip10-nativeid-record-predicate.md).** The
  `(chainId, address)` signature sketched in ADR-0008 (2026-05-23) never shipped;
  the shipped `Caip10Parts` form is authoritative. We still do NOT mint HCS-14
  UAIDs (ADR-0008 § "Why NOT generate UAIDs"); we key on the CAIP-10 string and
  parse a UAID's `nativeId` only when consuming one.
- The bare `Address` remains the canonical handle **within a chain**; the P8
  `CanonicalAgentIdentity = Address` alias is reconciled to mean exactly that
  ("the EVM account facet of a CanonicalAgentId"), and SSO/directory code keys
  on the CAIP-10 string, never the bare address.
- `AgentSession` carries: `sub` (CanonicalAgentId), the `CredentialPrincipal`
  that authenticated (credential kind + its identifier), an `Assurance` level,
  issued/expiry, and audience. The relationship between principal and subject
  is **"this credential is a control facet of this agent under its custody
  policy"** — expressed as authorization, never ownership.

### Forbidden

- `AgentSession.owner`, or any field implying the session principal owns the
  agent.
- Using a bare `Address` (chain-unqualified) as an SSO subject or directory key.
- Deriving custody authority from session membership; custody changes go
  through `account-custody` ([ADR-0011](./0011-credential-recovery-and-re-association.md)),
  never through a session.

## Consequences

**Positive:** subjects are portable across chains and unambiguous; the no-owner
shape keeps the custody firewall intact into the session layer; directory keys
and SSO subjects share one type.

**Negative:** every subject is a parsed/validated string, not a raw address —
call sites must use the helpers and handle parse failure. Multi-chain
deployments of one logical agent need an explicit convergence rule (documented
in spec 223/224: same address on multiple chains → distinct CanonicalAgentIds
that the directory may link as the same logical agent with evidence).

## Cross-references

- [spec 224 — Agentic Connect](../../../specs/224-agentic-connect.md) (AgentSession shape)
- [spec 223 — identity-directory](../../../specs/223-identity-directory.md) (CanonicalAgentId as key)
- CAIP-10 account-id spec.
