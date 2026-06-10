# Feature analysis — competitive overlap & gap series

> **Section purpose:** reusable, per-focus-area competitive deep dives comparing the agenticprimitives substrate to commercial and open-source products. Each focus-area document inventories the relevant products, maps their features onto the actual AP packages/contracts, and rolls up **feature overlap** (what they do that we also do) and **feature gap** (what they do that we don't — and what we do that they can't).
>
> Source baseline: *AgenticPrimitives Product Overlap and Competitive Substrate Audit* (working doc, 2026-06-10), decomposed here into focus-area documents and extended with per-product deep dives and a prioritized substrate gap roadmap.

## Documents in this series

| # | Document | Focus area | Primary AP packages |
| --- | --- | --- | --- |
| 01 | [Auth, embedded wallets & onboarding](01-auth-embedded-wallets.md) | User login, account linking, embedded wallet provisioning | `connect`, `connect-auth`, `browser-identity`, `fedcm-idp`/`fedcm-rp`, `key-custody` |
| 02 | [Smart accounts & account abstraction](02-smart-accounts-aa.md) | ERC-4337/7579 accounts, modules, session keys, batching | `agent-account`, `account-custody`, `contracts`, `delegation` |
| 03 | [Key custody, KMS, MPC & recovery](03-key-custody-kms-recovery.md) | Key holding, signing policy, HSM/KMS/MPC, recovery | `key-custody`, `account-custody`, `contracts` (CustodyPolicy) |
| 04 | [Delegation, policy & authorization](04-delegation-policy-authorization.md) | Delegation, session keys, capability tokens, policy engines | `delegation`, `tool-policy`, `contracts` (DelegationManager, enforcers) |
| 05 | [Paymasters, bundlers & gas abstraction](05-paymasters-bundlers-gas.md) | Gas sponsorship, bundling, relaying | `contracts` (SmartAgentPaymaster), `agent-account` clients |
| 06 | [Naming, profiles, directory & social graph](06-naming-profiles-directory.md) | Names, reverse resolution, profiles, discovery, relationships | `agent-naming`, `agent-profile`, `identity-directory(+adapters)`, `agent-relationships`, `related-agents` |
| 07 | [Credentials, attestations & trust graph](07-credentials-attestations-trust.md) | VCs, attestations, reputation, revocation | `verifiable-credentials`, `attestations`, `agreements`, `agent-skills`, `geo-features`, `contracts` registries |
| 08 | [MCP, A2A, agent runtimes & tools](08-mcp-a2a-runtimes-tools.md) | Tool runtimes, agent protocols, skills distribution, tool authorization | `mcp-runtime`, `tool-policy`, `identity-auth`, `delegation` |
| 09 | [Agent payments, treasury & commerce](09-payments-treasury-commerce.md) | x402/AP2 machine payments, settlement, streaming, org treasury | `agent-account` (treasury), `delegation` (spend), paymaster |
| 10 | [Audit, forensics & indexing](10-audit-forensics-indexing.md) | Evidence trails, indexers, agent tracing, compliance | `mcp-runtime` audit, `attestations`, ADR-0012 indexer |
| 11 | [Ontology, skills, semantics & entitlements](11-ontology-skills-entitlements.md) | Vocabularies, skill taxonomies, SHACL validation, entitlements | `ontology`, `agent-skills`, `geo-features`, `tool-policy` |
| 12 | [**Agent registry, discovery & intents**](12-agent-registry-discovery-intents.md) | ERC-8004, GoDaddy ANS, DNS-AID, agent cards, intent protocols | `agent-naming`, `agent-profile`, `identity-directory`, `attestations` |
| 90 | [**Prioritized feature gaps — substrate roadmap**](90-prioritized-feature-gaps.md) | Consolidated, prioritized gap list across all focus areas | all |
| 91 | [**Next push: discovery → intent → outcome**](91-next-push-discovery-to-outcomes.md) | The recommended next feature wave (signed cards, skills, intents, budget enforcers) under ADR-0037 venue rules | `agent-profile`, `agent-skills`, `intent-*`, `fulfillment`, `delegation`, `contracts` |

## Feature taxonomy (used in every document)

| Code | Meaning |
| --- | --- |
| AUTH | Authentication, identity, sessions, OIDC/SIWE/passkeys |
| WALLET | Embedded wallet / wallet provisioning |
| CUSTODY | Key custody, MPC, KMS, enclave or HSM signing |
| AA | Smart accounts, ERC-4337, ERC-7579, account abstraction |
| DELEG | Delegation, session keys, scoped permissions, capability tokens |
| POLICY | Policy engine, approvals, risk tiers, authorization DSL |
| PAYMASTER | Paymaster, bundler, relayer, gas sponsorship |
| NAME | Naming, handles, reverse resolution |
| PROFILE | Profiles, agent cards, social/profile records |
| DIR | Directory, discovery, indexer, registry read model |
| VC | Verifiable credentials, attestations, reputation |
| VAULT | Private data vault, entitlements, content access |
| MCP | MCP/A2A/tool runtime, agent tool access, connectors |
| PAY | Payments, mandates, agent commerce, invoices, settlement |
| AUDIT | Audit logs, observability, monitoring, incident response |
| ONTO | Ontology, schema, SHACL/RDF/semantic validation |
| RECOVERY | Recovery, trustees, backup credentials, account recovery |
| TREASURY | Org treasury, payroll, multi-sig operations |

## Per-product deep-dive worksheet (the template each entry follows)

1. **Product identity** — type (commercial / open-source / protocol / cloud), license/model, status.
2. **Feature inventory** — what it actually ships, tagged with the taxonomy.
3. **Overlap with AP** — which AP packages/contracts cover the same ground, and how the approaches differ.
4. **Feature gap: AP lacks** — concrete capabilities the product has that the substrate doesn't, **split by layer** (see below).
5. **Feature gap: product lacks** — what the integrated substrate provides that the product can't, split by the same layers.
6. **Verdict** — adopt / integrate / partner / compete / ignore, with priority.

## Gap layers (every gap is classified into exactly one)

| Layer | Label | Scope | Current focus |
| --- | --- | --- | --- |
| **Contracts** | `[Contracts]` | Solidity surface — registries, accounts, enforcers, paymaster, custody modules, on-chain invariants | **Active** |
| **SDK/packages** | `[SDK]` | TypeScript packages, adapters, backends, protocol conformance, indexers, server-side plumbing | **Active** |
| **UX/product** | `[UX]` | Hosted components, consoles, dashboards, onboarding flows, admin UIs, explorers | **DEFERRED — parked, not current focus** |

Each focus-area document ends with a **per-layer rollup** (Contracts gaps, SDK/package gaps, then UX gaps in a clearly-separated deferred section). The [prioritized roadmap (90)](90-prioritized-feature-gaps.md) is organized the same way: Contracts and SDK gaps are prioritized for execution; UX gaps are recorded but parked.

**Execution venue ([ADR-0037](../architecture/decisions/0037-primitives-pure-repo-external-integration-and-ux-layers.md)):** a gap being on this roadmap does not mean its code lands in this repo. Protocol bridges, registry sync, indexers, discovery APIs, and all UX surfaces are built in external repos (`agentic-trust`, `agent-indexer`, `agent-explorer`, `oasf`, …) that compose `@agenticprimitives/*`; this repo only grows the primitive surface they project from. Doc 90 marks these **⤴ external**.

## Verdict legend

| Verdict | Meaning |
| --- | --- |
| **Integrate** | Use it as a backend/adapter behind an AP package boundary; don't rebuild |
| **Adopt patterns** | Don't integrate the product; copy the UX/architecture lesson |
| **Partner** | Strategic ecosystem alignment (mutual distribution / interop standards) |
| **Compete** | Direct competitor for the substrate's core differentiators |
| **Track** | Adjacent today; revisit on a trigger (market or roadmap event) |

## How the substrate wins (cross-cutting thesis)

Every focus area shares one structural argument: most competitors solve **one or two layers** well and force customers to stitch identity, custody, delegation, tool access, payments, and audit together. The AP substrate's value proposition is that all of these share:

1. **One canonical identity anchor** — the Smart Agent address IS the identity (ADR-0010); auth users, wallets, names, credentials, tool sessions all point at it.
2. **One delegation model** — EIP-712 delegations + caveats + JTI replay protection serve app, agent, MCP/A2A, and on-chain paths alike.
3. **One custody/policy surface** — credential rotation, trustee quorums, and recovery are custody-policy operations, never delegations (ADR-0011).
4. **Contracts and packages designed together** — typehashes, ABIs, storage layouts, and TS builders co-evolve under one CI gate.
5. **Audit evidence as a first-class artifact** — finding ledgers, evidence indexes, runbooks, and preflights ship with the substrate.

The same thesis defines the bar for gap closure: a gap matters most when it blocks a customer from *staying inside* the substrate (e.g. no connector catalog forces them to bolt on Composio with its own auth model, fragmenting the trust chain).

## Maintenance

- One document per focus area; add new products to the relevant document, not to this index.
- When a gap closes, update both the focus-area doc and [90-prioritized-feature-gaps.md](90-prioritized-feature-gaps.md).
- Re-baseline the priority roadmap quarterly or after any major market event (e.g. a competitor shipping agent-native delegation).
