# Architecture Decision Records (ADRs)

Short docs (≤ 400 words each) recording **load-bearing** boundary decisions. Each ADR captures the **context**, the **decision**, and its **consequences** — so an agent thinking about reversing the decision can re-derive whether the original constraints still hold.

The drift mode this prevents: an agent doesn't know *why* a boundary is where it is, decides it looks suboptimal, and "refactors" it away — silently breaking the constraint the boundary was protecting.

## Index

- [`0001-split-identity-auth-and-agent-account.md`](./0001-split-identity-auth-and-agent-account.md) — why auth + smart-account is 2 packages, not 1.
- [`0002-session-lifecycle-in-delegation.md`](./0002-session-lifecycle-in-delegation.md) — why `SessionManager` lives in `delegation`, not `key-custody`.
- [`0003-tool-policy-protocol-agnostic.md`](./0003-tool-policy-protocol-agnostic.md) — why `tool-policy` cannot import MCP / A2A / LangChain.
- [`0004-mcp-runtime-as-middleware.md`](./0004-mcp-runtime-as-middleware.md) — why `mcp-runtime` is middleware on the official MCP SDK, not a replacement.
- [`0005-monorepo-with-product-boundaries.md`](./0005-monorepo-with-product-boundaries.md) — why we're a monorepo of independently-consumable packages, not a polyrepo and not a single SDK.
- [`0006-agent-naming-as-resolution-layer.md`](./0006-agent-naming-as-resolution-layer.md) — agent naming is a resolution layer, not a foundational dependency.
- [`0007-agent-identity-stack-three-packages.md`](./0007-agent-identity-stack-three-packages.md) — the agent-identity stack is three packages, not seven.
- [`0008-caip10-nativeid-record-predicate.md`](./0008-caip10-nativeid-record-predicate.md) — CAIP-10 `nativeId` as an optional record predicate for HCS-14 / ERC-8004 interop; we don't mint UAIDs.
- [`0009-on-chain-ontology-shacl-naming.md`](./0009-on-chain-ontology-shacl-naming.md) — on-chain ontology + SHACL shapes govern naming/relationship/identity records (reversal).
- [`0010-smart-agent-canonical-identifier.md`](./0010-smart-agent-canonical-identifier.md) — the Smart Agent address is the canonical identifier; names/credentials/profiles are facets pointing at it.
- [`0011-credential-recovery-and-re-association.md`](./0011-credential-recovery-and-re-association.md) — credentials rotate, identity persists; recovery is custody-governed, never a delegation.
- [`0012-no-eth-getlogs-in-product-read-paths.md`](./0012-no-eth-getlogs-in-product-read-paths.md) — no `eth_getLogs` in package/app read paths; use `readContract` or an indexer.
- [`0013-no-silent-fallbacks.md`](./0013-no-silent-fallbacks.md) — one mechanism per read/auth path; empty is an answer, never a trigger to escalate to a second, more expensive path.
- [`0014-connect-is-an-sso-broker.md`](./0014-connect-is-an-sso-broker.md) — Agentic Connect is an SSO broker at a central origin, not crypto embedded in each relying site.
- [`0015-identity-directory-is-an-evidence-backed-read-model.md`](./0015-identity-directory-is-an-evidence-backed-read-model.md) — `identity-directory` is an evidence-backed read model over canonical agents, separate from `agent-naming`.
- [`0016-canonical-agent-id-is-the-sso-subject.md`](./0016-canonical-agent-id-is-the-sso-subject.md) — `CanonicalAgentId` (CAIP-10) is the SSO subject; `AgentSession` has no `owner`.
- [`0017-oidc-social-is-a-login-facet-not-custody.md`](./0017-oidc-social-is-a-login-facet-not-custody.md) — OIDC / social login is a control facet, not custody authority; custody-class actions require step-up.
- [`0018-agenticprimitives-wide-formal-ontology.md`](./0018-agenticprimitives-wide-formal-ontology.md) — a monorepo-wide formal ontology (RDFS/OWL/SHACL) in its own package; pairs with the on-chain ontology (ADR-0009).
- [`0019-relying-site-authority-is-a-scoped-delegation.md`](./0019-relying-site-authority-is-a-scoped-delegation.md) — a relying site is a scoped ERC-7710 delegate of the person SA, never a custodian; runtime auth = holding a live caveated delegation, not `isCustodian` (closes the spec-229 full-custodian takeover risk).
- [`0020-faceted-agent-identity-doctrine.md`](./0020-faceted-agent-identity-doctrine.md) — every contextual identity surface is a facet of the canonical Smart Agent; facets are evidence/display/discovery, not authority.
- [`0021-generic-packages-vs-white-label-apps.md`](./0021-generic-packages-vs-white-label-apps.md) — packages are generic, vertical-agnostic trust building blocks; white-label / faith / deployment specifics live in apps as config data.
- [`0022-authority-must-be-declarative.md`](./0022-authority-must-be-declarative.md) — authority is a first-class declarative object; CI proves the implementation matches the declaration.
- [`0023-attestation-registry-eas-aligned-bilateral-consent.md`](./0023-attestation-registry-eas-aligned-bilateral-consent.md) — EAS-aligned, Verax-informed attestation registry with a bilateral-consent model (consent verified off-chain in the commitment-only design — see ADR-0027).
- [`0024-intent-coordination-substrate.md`](./0024-intent-coordination-substrate.md) — the intent coordination substrate (the 15-layer spine: intent → resolution → agreement → fulfillment → evidence).
- [`0025-related-agent-links-are-private.md`](./0025-related-agent-links-are-private.md) — person↔org links are private holder-resident vault credentials, never public on-chain edges.
- [`0026-per-agent-vault-substrate.md`](./0026-per-agent-vault-substrate.md) — an agent's data lives in its own delegation-gated vault, keyed by the delegator-principal (`owner == principal`).
- [`0027-canonical-authority-binding.md`](./0027-canonical-authority-binding.md) — every authority-bearing verification recomputes the canonical typed payload from calldata + domain constants; a stored hash / caller-supplied digest / nonzero reference is NOT authority. Complements ADR-0022.
- [`0028-accepted-testnet-posture.md`](./0028-accepted-testnet-posture.md) — a bounded set of disclosed-demo-key / deferred-custody trade-offs (N1, DEMO-1/2, operator sessions, stub packages) are DECIDED + gated; reviewers cite this ADR and confirm the gate, they do NOT re-raise them as new findings.

## Status discipline

Every ADR is one of:
- **proposed** — under discussion; the decision is not yet binding.
- **accepted** — binding; new code must respect it.
- **superseded by [ADR-N]** — replaced; the linked ADR is the new binding one.

To revisit an accepted ADR, write a new ADR that supersedes it. Don't edit the original — agents reading commit history need to see why the change happened.
