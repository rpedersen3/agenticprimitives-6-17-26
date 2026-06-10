# agenticprimitives

**The trust substrate for the agent economy** — an open monorepo of TypeScript packages and Solidity contracts that gives every AI agent, person, and organization one canonical on-chain identity, with custody, delegation, naming, credentials, and audit evidence designed as a single system.

AI agents are getting wallets, names, registries, and payment rails — this year. ERC-8004 agent identity went to mainnet. MetaMask shipped an Agent Wallet. GoDaddy launched an Agent Naming Service. x402 made machine payments real. Every team building agentic products now faces the same question with real money behind it:

> **When an agent acts on a human's behalf — who authorized what, under which limits, provable to whom?**

The standard answer is a stitch-job: Privy + Safe + Pimlico + ENS + EAS + Turnkey + a policy engine + an audit log. Eight vendors. Eight identity models. Zero coherent trust chain. The stitched stack cannot answer the question above, because no two of its parts agree on who "the agent" even is.

`agenticprimitives` is the other answer: **30+ TypeScript packages and 42 Solidity contracts, designed as one system**, where identity, custody, delegation, naming, credentials, policy, and audit evidence all point at one canonical anchor — and every security finding we've ever logged is public.

## Five things that are true here and almost nowhere else

### 1. The address IS the identity

Every person, organization, service agent, and treasury is an ERC-4337 Smart Agent address. Names, passkeys, Google logins, SIWE wallets, profiles, credentials, ERC-8004 registry entries — all of them are **replaceable facets pointing at that one anchor** ([ADR-0010](docs/architecture/decisions/0010-smart-agent-canonical-identifier.md)).

Lose your passkey? Recovery rotates the credential, **never the address**. Every delegation your agent ever issued stays valid. Your name still resolves. Your reputation still attaches. Identity persists; credentials rotate ([ADR-0011](docs/architecture/decisions/0011-credential-recovery-and-re-association.md)).

### 2. One delegation model, everywhere

The same EIP-712 delegation — with on-chain caveat enforcers for time windows, per-call value caps, allowed methods, quorums — authorizes a web app session, an A2A agent call, an MCP tool invocation, and an on-chain spend. *"This agent may call these two tools until Friday, spend at most 0.1 ETH per call, and I can revoke it instantly"* is one primitive, not four products. Apps and agents receive **revocable, scoped authority — never keys**. (Cumulative cross-redemption budgets are on the [contracts roadmap](docs/feature-analysis/90-prioritized-feature-gaps.md) — we say so because the audit does.)

### 3. Custody is not authority

Credential rotation, trustee quorums, guardian recovery, and upgrades are **custody-policy operations** enforced by our own ERC-7579 modules — never delegations, never a third-party multi-sig dependency. We ported the patterns worth porting (Safe-style signature packing) and own the rest, because the trust substrate shouldn't outsource its spine.

### 4. Contracts and SDK are one artifact

TypeScript typehashes are CI-locked to the Solidity constants. ABIs are sync-gated. Storage layouts are snapshot-gated. Package boundaries are doctrine-gated. You cannot drift the client from the chain, and you cannot quietly break a downstream package. The contract layer and the SDK co-evolve under the same checks — which is what "designed as one system" actually means in practice.

### 5. Audited in the open

Most projects publish an audit PDF once. We maintain a **live, CI-gated findings ledger** — [`docs/audits/findings.yaml`](docs/audits/findings.yaml) — where a "closed" finding must anchor to real source code or the build fails. We run adversarial line-by-line audits on ourselves ([all 42 contracts](docs/audits/2026-06-10-contract-by-contract-audit.md), [every package](docs/audits/2026-06-10-production-readiness-audit.md)) and publish the results, open findings included, before anyone asks.

Trust infrastructure should be the most transparent code you depend on. That transparency is the moat: anyone can copy a feature; almost no one will show you their open findings.

## What it replaces

| You'd normally integrate… | Here it's… |
| --- | --- |
| Privy / Dynamic / Web3Auth (auth + embedded wallets) | [`connect`](packages/connect), [`connect-auth`](packages/connect-auth) — sessions bound to the Smart Agent, not a vendor account |
| Safe / ZeroDev / Alchemy Account Kit (smart accounts) | [`agent-account`](packages/agent-account) + [`contracts`](packages/contracts) — ERC-4337 + ERC-7579 modular core |
| Turnkey / Fireblocks (KMS, signing policy) | [`key-custody`](packages/key-custody) — a pluggable KMS boundary your HSM/cloud KMS plugs *into*, so signing infrastructure never owns your identity |
| Safe multi-sig + Argent recovery (org control, recovery) | [`account-custody`](packages/account-custody) + native CustodyPolicy module — quorums + trustees + recovery, on-chain |
| MetaMask Delegation Toolkit / session keys (scoped authority) | [`delegation`](packages/delegation) + [`tool-policy`](packages/tool-policy) — caveats enforced on-chain, replay-protected off-chain |
| Pimlico / Alchemy Gas Manager (sponsored gas) | `SmartAgentPaymaster` + account clients |
| ENS / Unstoppable (naming) | [`agent-naming`](packages/agent-naming) — hierarchical registry, forward + reverse, on-chain normalization |
| EAS / Verax (attestations) | [`attestations`](packages/attestations), [`agreements`](packages/agreements) — bilateral consent, joint assertions, EIP-712-bound (W1 foundational — registries live on testnet, maturing toward production) |
| ERC-8004 registries / GoDaddy ANS / agent cards (discovery) | [`agent-profile`](packages/agent-profile), [`identity-directory`](packages/identity-directory) — profiles + directory reads today; ERC-8004/ANS mapping is an active interop target on the [roadmap](docs/feature-analysis/90-prioritized-feature-gaps.md) |
| OAuth scopes + API keys (agent tool access) | [`mcp-runtime`](packages/mcp-runtime) — MCP tools gated by the same delegations, JTI replay protection included |
| Custom audit logging | [`audit`](packages/audit) + evidence trail across every layer above |

The point isn't that each row is impossible elsewhere. The point is that **here, every row shares one identity, one delegation model, and one evidence trail** — and the seams between rows are exactly where stitched stacks leak authority.

## See it run

End to end on Base Sepolia: Google/passkey/SIWE sign-in → counterfactual Smart Agent deploy → custody policy + multi-sig → scoped delegations → A2A agent calls → MCP vault and tool access → audit evidence.

**Prerequisites:** Node ≥ 20.19, pnpm ≥ 9, [Foundry](https://book.getfoundry.sh/getting-started/installation) (anvil + forge).

```bash
pnpm install

# First time only (contract deps + build):
pnpm setup:contracts

# Anvil + deploy + apps in parallel:
pnpm dev
```

Then open http://127.0.0.1:5173. Demo apps: [`demo-web`](apps/demo-web) and [`demo-web-pro`](apps/demo-web-pro) (full product flows), [`demo-sso-next`](apps/demo-sso-next) (Connect/SSO), [`demo-a2a`](apps/demo-a2a) (agent-to-agent), [`demo-mcp`](apps/demo-mcp) (MCP vault + tools), [`demo-org`](apps/demo-org), [`demo-jp`](apps/demo-jp), [`demo-gs`](apps/demo-gs).

**Where to go next:**

- **Evaluate the architecture** — read [`specs/000-product-overview.md`](specs/000-product-overview.md), then [`specs/100-package-boundary-doctrine.md`](specs/100-package-boundary-doctrine.md).
- **Adopt a primitive** — pick one package from the table below; each README stands alone.
- **Audit us** — start at [`docs/audits/findings.yaml`](docs/audits/findings.yaml) and the [latest full pass](docs/audits/2026-06-10-production-readiness-audit.md).

## The packages

Publishable `@agenticprimitives/*` packages — each independently consumable, each validated against the competitive landscape it plays in ([feature-analysis series](docs/feature-analysis/index.md)). Dependency direction is doctrine: `types ← identity/auth ← account ← delegation ← runtime`, no back-edges.

| Concern | Packages |
| --- | --- |
| **Auth + sessions** | [`connect-auth`](packages/connect-auth) (passkey/SIWE/OAuth credentials, JWT sessions), [`connect`](packages/connect) (SSO broker, bound grants), [`browser-identity`](packages/browser-identity), [`fedcm-idp`](packages/fedcm-idp) / [`fedcm-rp`](packages/fedcm-rp) (FedCM) |
| **Account + custody** | [`agent-account`](packages/agent-account) (4337+7579 account SDK), [`account-custody`](packages/account-custody) (custody-policy actions), [`key-custody`](packages/key-custody) (KMS) |
| **Delegation + tools** | [`delegation`](packages/delegation), [`tool-policy`](packages/tool-policy), [`mcp-runtime`](packages/mcp-runtime), [`a2a`](packages/a2a) |
| **Names + discovery** | [`agent-naming`](packages/agent-naming), [`agent-profile`](packages/agent-profile), [`identity-directory`](packages/identity-directory) (+ [`adapters`](packages/identity-directory-adapters)), [`agent-relationships`](packages/agent-relationships), [`related-agents`](packages/related-agents) |
| **Credentials + trust** | [`verifiable-credentials`](packages/verifiable-credentials), [`attestations`](packages/attestations), [`agreements`](packages/agreements), [`agent-skills`](packages/agent-skills), [`geo-features`](packages/geo-features) |
| **Coordination + commerce** | [`intent-marketplace`](packages/intent-marketplace), [`intent-resolver`](packages/intent-resolver), [`fulfillment`](packages/fulfillment), [`payments`](packages/payments), [`content-primitives`](packages/content-primitives) |
| **Semantics + evidence** | [`ontology`](packages/ontology), [`audit`](packages/audit), [`types`](packages/types), [`contracts`](packages/contracts) |

Start with [`specs/000-product-overview.md`](specs/000-product-overview.md) and [`specs/100-package-boundary-doctrine.md`](specs/100-package-boundary-doctrine.md). Layout:

```
agenticprimitives/
├── packages/         # Publishable @agenticprimitives/* packages
├── apps/             # Demo + reference apps (web, a2a, mcp, sso, org…)
├── specs/            # Doctrine + per-capability specs (the architects of record)
├── docs/             # ADRs, audits, feature analysis, runbooks
└── scripts/          # CI guardrails + dev orchestration
```

## Pure primitives by design — integrations live above, on purpose

This repo is deliberately **only the primitive layer** ([ADR-0037](docs/architecture/decisions/0037-primitives-pure-repo-external-integration-and-ux-layers.md)). Composable integration layers — ERC-8004 registration/sync, ANS/DNS bridges, HCS publishers, indexers, discovery APIs — and product/UX layers are built in **external repos that import these packages**, never the reverse.

That's the strategy, not a limitation: competitors ship integrations without primitives; we ship primitives that make every integration a thin, replaceable layer. The repo's job is to make the primitives **expressive enough to be projected into any registry, naming system, or discovery surface** — SA-signed cards, typed attestations, complete indexable events — so the layers above stay thin.

The same logic sets our registry strategy ([ADR-0038](docs/architecture/decisions/0038-many-registries-hypothesis-registry-building-primitives.md)): we don't bet on any single agent registry winning. We expect **hundreds of registries — most of them vertical** (healthcare, travel, commerce, professional) — and a registry is ~20% membership policy and ~80% trust plumbing: identity, custody, signed claims, reputation, revocation, audit. That 80% is this substrate. The goal is to be **what agent registries are built from**: one agent, one Smart Agent address, *n* registry facets.

## Standards as facets, not integrations

Standards are implemented at the primitive boundary as facets of the Smart Agent anchor — designed to be projected into each surface by the layer above, not bridged one-off from inside:

**CAIP-10** identifiers · **ERC-4337** accounts · **ERC-7579** modules · **ERC-1271** signatures · **EIP-712** typed commitments · **ERC-7710-style** caveated delegation · **ERC-8004** agent registries (interop target — registry records map onto the SA anchor) · **HCS-11/HCS-14** + Hashgraph Online (profile/UAID interop) · **MCP + A2A** (tool and agent endpoints consume the same delegation substrate) · **SKOS/SHACL** semantic vocabularies.

The bet: agent trust standards are converging *right now* on how agents are named, discovered, and trusted. The winner won't be whoever integrates the most products — it'll be the substrate where every standard is a facet of one identity. That's the design center here.

## Status — honest version

**Testnet/pilot-ready. Not yet production.** That phrase is doing real work, and we can prove both halves:

- **What works today:** the full chain — auth → account deploy → custody → delegation → MCP/A2A → audit — runs end to end on Base Sepolia, behind 774 Foundry tests (including invariant suites), 27 package test suites, and the cross-stack CI gates described above. Use it now for integration prototyping, technical pilots, security review, and staging.
- **What gates production:** an external contracts audit (Cyfrin/CodeHawks contest planned), rotation of the intentionally-public testnet governance keys to KMS-backed production keys, and closure of the open items in the [findings ledger](docs/audits/findings.yaml) — which you can read, today, in full. The current self-audit pass: [production-readiness audit (2026-06-10)](docs/audits/2026-06-10-production-readiness-audit.md).

Because we build the trust substrate natively — our own multi-sig, our own delegation framework, our own registries — the security surface is broad, and we hold it to a correspondingly broad bar rather than inheriting someone else's. The findings ledger is gated in CI so a "closed" finding cannot drift from source.

## Provenance

Capabilities are extracted from earlier in-lab prototype work and re-shaped as standalone, dependency-minimal packages. Boundaries and features are validated against the landscape they compete in — MetaMask DTK + Agent Wallet, Safe, ZeroDev, Alchemy, Pimlico, Turnkey, Privy, Lit, ERC-8004 tooling, GoDaddy ANS, Hashgraph Online, MCP + A2A SDKs — documented per focus area in [`docs/feature-analysis/`](docs/feature-analysis/index.md). Fewer glued products. More coherent primitives.
