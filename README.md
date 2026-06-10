# agenticprimitives

`agenticprimitives` is a native substrate for agentic applications: Smart Agent accounts, custody, names, profiles, delegations, policy, MCP access, audit trails, and directory reads designed as one coherent system.

The fundamental premise is that automation in security review, architecture governance, testing, and audit evidence can let a small team build a seamless primitive layer faster than product teams can integrate a suite of disconnected vendors. Instead of stitching together separate auth, wallet, delegation, policy, audit, profile, and agent-runtime products, this repo aims to make those concerns share one canonical identity model, one custody model, one delegation model, and one evidence trail.

That does not mean skipping hardening. It means using AI-assisted review, static analysis, invariant tests, package-boundary checks, specs, ADRs, and public self-audit artifacts as a continuous engineering system. The goal is a substrate where user experience stays simple because the primitives below it are already integrated.

## Architectural Strategy

- **Canonical Smart Agent identity:** every person, organization, service agent, and treasury service is anchored by a CAIP-10 Smart Agent address. Names, credentials, profiles, skills, relationships, and app-specific records are facets pointing at that anchor.
- **Credential-first access:** Google, passkeys, SIWE wallets, and future credentials are replaceable control facets. A public name is a handle, not the login key.
- **Custody is separate from authority:** custody controls the Smart Agent; delegation grants scoped authority to apps, agents, and MCP tools. Relying apps receive revocable permissions, not keys.
- **Substrate-level integration:** packages are intentionally small, but their contracts fit together: Connect issues sessions for the same Smart Agent that owns delegations, vault grants, names, profiles, and audit evidence.
- **No silent fallbacks:** product paths use one canonical mechanism at a time. Empty results are real answers, not triggers for hidden weaker paths.
- **Audit as product infrastructure:** audit events, evidence indexes, storage snapshots, branch coverage, typehash checks, and public review docs are part of the build, not a final ceremony.

## Product Suite Replaced

Most web3 applications assemble a product suite: auth provider, embedded wallet, smart-account vendor, paymaster, naming service, attestation service, treasury tool, recovery flow, multi-sig, policy layer, audit trail, and agent runtime. `agenticprimitives` is the substrate-level version of that suite.

| Architectural area | Typical product category | Native primitive |
| --- | --- | --- |
| Auth / SSO / embedded login | Privy, Dynamic, Web3Auth, Magic, Coinbase Embedded Wallets | `connect`, `connect-auth`, Connect apps |
| Smart accounts | Safe, ZeroDev, Biconomy, Alchemy Account Kit, Coinbase Smart Wallet, Stackup | `agent-account`, `contracts` |
| Passkeys / social custody | Privy, Turnkey, Web3Auth, Magic, Capsule | `connect-auth`, `key-custody`, `account-custody` |
| KMS / signer infrastructure | Turnkey, Fireblocks, Lit Protocol, AWS / GCP KMS wrappers | `key-custody` |
| Recovery / trustees | Argent recovery, Safe recovery modules, Web3Auth recovery, Privy recovery | `account-custody`, recovery specs |
| Multi-sig / org control | Safe, Squads, Fireblocks, Coinshift | `agent-account`, custody modules |
| Delegation / session authority | MetaMask Delegation Toolkit, Safe modules, Lit Actions, custom session keys | `delegation`, `tool-policy` |
| Paymaster / sponsored gas | Pimlico, Alchemy Gas Manager, Biconomy, Gelato Relay, Stackup | `SmartAgentPaymaster`, `agent-account`, `demo-a2a` relayer paths |
| Bundler / UserOp flow | Pimlico, Alchemy, Stackup, Biconomy, ZeroDev | `agent-account` clients + app relayer paths |
| Naming service | ENS, Unstoppable Domains, SPACE ID, Lens handles | `agent-naming` |
| Agent naming / agent domains | Agent Naming Service, GoDaddy-style agent domains, custom vanity domains | `agent-naming`, Connect home domains, A2A endpoint routing |
| Agent registries / discovery | ERC-8004 registries, Hashgraph Online agent discovery, custom agent catalogues | `identity-directory`, `agent-profile`, `agent-relationships`, future registry projections |
| Profiles / AgentCard | ENS text records, Lens profiles, Farcaster profiles, custom DB profiles | `agent-profile` |
| Directory / read model | Ceramic, IDX, custom indexers, CRM / member directories | `identity-directory`, `identity-directory-adapters` |
| Attestations / claims | EAS, Verax, Gitcoin Passport, Sismo, Clique | contracts + claim / attestation specs |
| Relationships / trust graph | EAS schemas, Lens graph, Ceramic graph, custom DB edges | `agent-relationships` for public edges; private vault credentials for confidential edges |
| Treasury / org funds | Safe treasury, Coinshift, Request Finance, Fireblocks, Utopia | service Smart Agents + custody / delegation / policy primitives |
| MCP / agent tool authorization | Custom API keys, OAuth scopes, LangChain guards, MCP middleware | `mcp-runtime`, `delegation`, `tool-policy` |
| Audit / evidence / monitoring | OpenZeppelin Defender, Tenderly, Forta, Hypernative, custom audit logs | `audit`, CI checks, audit evidence docs |
| Ontology / controlled vocabularies | Custom schemas, SKOS stores, graph DB vocabularies | `ontology` |
| Skills / geo / capability registry | Marketplace databases, CRM tags, directory taxonomies | planned skills + geo registries over `ontology` |
| Agent standards interop | HCS, ERC-8004, CAIP-10, DID-style identifiers, AgentCard conventions | `types`, `agent-profile`, `identity-directory-adapters`, `ontology` |

The target integrated stack is not `Privy + Safe + Pimlico + ENS + EAS + Turnkey + Defender + custom backend`. It is one Smart Agent substrate where credentials, names, delegations, policies, paymasters, attestations, treasury controls, MCP access, and audit evidence all point at the same canonical address.

## Standards Posture

The substrate follows standards at the primitive boundary rather than treating standards as one-off app integrations:

- **CAIP-10:** canonical agent identifiers are chain-qualified Smart Agent addresses.
- **ERC-4337:** Smart Agents are account-abstraction accounts with UserOp-based execution.
- **ERC-7579:** account capabilities should live in modules, not in a monolithic account core.
- **ERC-1271:** Smart Agents verify signatures for sessions, delegations, and app grants.
- **EIP-712:** delegations, custody actions, agreements, and attestations use typed-data commitments where signatures need durable meaning.
- **ERC-7710-style delegation:** scoped, caveated authority is modeled as a first-class primitive.
- **ERC-8004:** agent registry / trust / discovery semantics are an interop target; this repo keeps CAIP-10 Smart Agent addresses as the native ID and maps registry records as facets.
- **HCS-11 / HCS-14 and Hashgraph Online:** agent profiles, registry records, and CAIP-10 alignment are supported as profile / directory / ontology interop surfaces rather than replacing the Smart Agent anchor.
- **MCP and A2A:** tool access and agent-to-agent endpoints consume the same delegation and policy substrate as web apps.
- **SKOS / SHACL / ontology vocabularies:** skills, geo features, controlled vocabularies, and validation shapes are modeled as reusable semantic primitives.

## Working Hypothesis

Agentic trust standards are moving quickly. ERC-8004, HCS, Hashgraph Online, Agent Naming Service patterns, and agent registry products are converging on the question of how agents are discovered, named, trusted, and verified. At the same time, MetaMask Delegation Toolkit, ERC-7710-style delegation, ERC-4337 accounts, and ERC-7579 modules are making authority programmable at the account layer.

Our hypothesis is that the winning platform is not a pile of integrations across those product categories. It is a substrate where standards are implemented as interoperable facets over the same Smart Agent anchor.

The timing also matters. Security automation has changed the build strategy. Static analysis, invariant testing, symbolic execution, AI-assisted review, and community audit loops are now fast enough to run continuously, not just before launch. Recent public examples, including AI-assisted discovery of serious issues in mature crypto systems such as Zcash, reinforce the point: audit-first engineering can find cross-layer failures that traditional product integration often hides.

Over the last two months, this repo has been moving toward that model: specs before non-trivial code, package-boundary checks, storage-layout snapshots, typehash equality gates, Foundry / fuzz / invariant coverage, public self-audit docs, and explicit community-review packets. The bet is that a transparent, audit-first primitive substrate will increasingly beat the traditional web3 suite model on UX coherence, security evidence, and long-term adaptability.

## Packages

**17 publishable `@agenticprimitives/*` packages**, each independently consumable, each backed by competitive-landscape research. Grouped below by concern; see [`specs/100-package-boundary-doctrine.md`](./specs/100-package-boundary-doctrine.md) for the package-boundary contract.

### Auth + sessions

| Package | Purpose |
| --- | --- |
| [`@agenticprimitives/connect-auth`](./packages/connect-auth) | Credential primitives for passkey / SIWE / Google OAuth, JWT sessions, and pluggable `Signer` interfaces |
| [`@agenticprimitives/connect`](./packages/connect) | Connect / SSO broker primitives: AgentSession mint + verify, OIDC-style bound grants, redirect helpers |

### Agent account + custody

| Package | Purpose |
| --- | --- |
| [`@agenticprimitives/agent-account`](./packages/agent-account) | ERC-4337 + ERC-7579 smart-account substrate: deterministic addressing, ERC-1271, UserOp building, factory mode wiring |
| [`@agenticprimitives/account-custody`](./packages/account-custody) | Custody-policy SDK: action enum + arg builders, EIP-712 typed-data, custodian/trustee/recovery types |
| [`@agenticprimitives/key-custody`](./packages/key-custody) | Pluggable KMS: envelope encryption, secp256k1 signers, HMAC, and per-subject derivation for social-custodied agents |

### Delegation + MCP

| Package | Purpose |
| --- | --- |
| [`@agenticprimitives/delegation`](./packages/delegation) | EIP-712 delegations, caveat evaluation, and revocable authority from web apps to agents and MCP tools |
| [`@agenticprimitives/tool-policy`](./packages/tool-policy) | Protocol-agnostic classification + risk tiers + threshold policy + exact-call DSL |
| [`@agenticprimitives/mcp-runtime`](./packages/mcp-runtime) | `withDelegation` middleware around the official MCP SDK + JTI stores (sqlite/postgres/memory) |

### Names + facets

| Package | Purpose |
| --- | --- |
| [`@agenticprimitives/agent-naming`](./packages/agent-naming) | Hierarchical name registry + resolver for deployment-configured names such as `.impact` (forward + reverse) |
| [`@agenticprimitives/agent-profile`](./packages/agent-profile) | CAIP-10 profile resolver + AgentCard schema + on-chain profile reads |
| [`@agenticprimitives/agent-relationships`](./packages/agent-relationships) | ⚠️ EXPERIMENTAL — on-chain trust-fabric edges. Public graph; **not for confidential edges** (see package README) |

### Directory + ontology

| Package | Purpose |
| --- | --- |
| [`@agenticprimitives/identity-directory`](./packages/identity-directory) | Evidence-backed read model — composes canonical addresses, names, profiles, public relationships, and index projections into a queryable directory |
| [`@agenticprimitives/identity-directory-adapters`](./packages/identity-directory-adapters) | CAIP-10 / on-chain / naming / indexer adapter implementations for `identity-directory` |
| [`@agenticprimitives/ontology`](./packages/ontology) | Hashgraph-aligned ontology (T-box / C-box) + controlled vocabularies + SHACL shapes |

### Audit + types + contracts

| Package | Purpose |
| --- | --- |
| [`@agenticprimitives/audit`](./packages/audit) | Audit-event schema + sink interface + in-band sinks (console / memory / PII guardrail) + `MetricsSink` observability primitive |
| [`@agenticprimitives/types`](./packages/types) | Cross-cutting branded primitives (`SmartAgentAddress`, `Hex`, etc.) — leaf in the dependency graph |
| [`@agenticprimitives/contracts`](./packages/contracts) | Solidity sources + ABIs + storage-layout snapshots for the on-chain primitives consumed by the other packages |

See [`specs/`](./specs) for the full design. Start with [`000-product-overview.md`](./specs/000-product-overview.md) and [`100-package-boundary-doctrine.md`](./specs/100-package-boundary-doctrine.md).

## Layout

```
agenticprimitives/
├── packages/         # The 17 publishable @agenticprimitives/* packages
├── apps/             # Demo apps (web + a2a + mcp + sso + org + jp + contracts)
├── specs/            # Doctrine, per-package contracts, archive
├── docs/             # Usage guides, ADRs, audits, runbooks
└── scripts/          # CI guardrails + dev orchestration
```

## Demo Apps

The demo apps exercise the substrate end to end: Connect sign-in, Smart Agent deployment, scoped app grants, A2A routing, MCP vault access, organization creation, intent matching, and audit evidence on Base Sepolia.

```bash
# First time only:
cd apps/contracts && bash setup.sh && cd ..

# Run the demo (Anvil + deploy + 3 apps in parallel):
pnpm dev
```

Then open http://127.0.0.1:5173. See [`apps/demo-web/`](./apps/demo-web), [`apps/demo-web-pro/`](./apps/demo-web-pro), [`apps/demo-sso-next/`](./apps/demo-sso-next), [`apps/demo-a2a/`](./apps/demo-a2a), [`apps/demo-mcp/`](./apps/demo-mcp), [`apps/demo-jp/`](./apps/demo-jp), and [`apps/demo-gs/`](./apps/demo-gs).

Live deploy targets are Cloudflare Pages / Workers plus Base Sepolia contracts.

## Status

**Ready for test and pre-production environments — not yet full production.** This is a comprehensive, vertically-integrated set of trust primitives — smart-account custody, multi-sig and credential recovery, agent-to-agent delegation with on-chain caveat enforcement, naming, verifiable credentials, attestation and agreement registries, and MCP/A2A authority — implemented **natively** rather than assembled from third-party components. Package boundaries are enforced by CI; cross-stack EIP-712 typehash, ABI-sync, storage-layout, and finding-ledger gates keep the contract and TypeScript layers in lockstep; the demo apps exercise the full chain (Google/passkey/SIWE auth → smart-account deploy → custody policy + multi-sig → off-chain delegations + MCP vault/tool calls) end to end on Base Sepolia. Use it today for **test, staging, and pre-production work**: integration prototyping, technical pilots that bind testnet value, security review, and audit preparation.

**A comprehensive set of native primitives warrants a comprehensive audit — which we are actively undertaking.** Because we implement the trust substrate ourselves (no third-party multi-sig, no borrowed delegation framework), the security surface is correspondingly broad, and we hold it to a correspondingly broad bar rather than inheriting someone else's. A continuously-maintained finding ledger — [`docs/audits/findings.yaml`](./docs/audits/findings.yaml) — is the single source of truth for every security finding's status, gated in CI so a "closed" finding cannot drift from source. The active contract-layer tracker is [`docs/audits/2026-06-10-contract-by-contract-audit.md`](./docs/audits/2026-06-10-contract-by-contract-audit.md) (independent per-contract deep dive of all 42 `.sol` files), and the public self-audit packet starts at [`docs/audits/archive/2026-06-03/self-audit-2026-06.md`](./docs/audits/archive/2026-06-03/self-audit-2026-06.md).

**Full production launch additionally requires** a small set of operational steps, independent of the architecture:

1. **External contracts audit** (Cyfrin / CodeHawks contest planned) — the independent third-party complement to our in-house program above.
2. **Clean production governance keys** — the current testnet deployer is intentionally public so the demo stack is reproducible from a clean clone; production deploys MUST rotate to a fresh KMS-backed key per the [`packages/contracts/AUDIT.md`](./packages/contracts/AUDIT.md) runbook.
3. **Closure of the residual production-readiness items** tracked in [`docs/architecture/product-readiness-audit.md`](./docs/architecture/product-readiness-audit.md).

## Provenance

Capabilities are extracted from [`smart-agent`](https://github.com/agentictrustlabs/smart-agent) (branch `003-intent-marketplace-proposal`), then re-shaped as standalone, dependency-minimal packages. Boundaries and feature choices are validated against MetaMask DTK, 1claw, Coinbase AgentKit, Alchemy Account Kit, ZeroDev, Pimlico, Safe, TurnKey, Lit Protocol, Privy, MCP SDK, and A2A SDK, while preserving the native-substrate goal: fewer glued products, more coherent primitives.
