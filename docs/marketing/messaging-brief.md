# agenticprimitives — messaging & positioning brief

> **Audience for this doc:** anyone writing user-facing copy for this repo (READMEs, docs intros, launch posts). It is the single source of voice + positioning. Derived from the [feature-analysis series](../feature-analysis/index.md) (competitive deep dives, 2026-06).

## The one-liner

**The trust substrate for the agent economy.** One canonical on-chain identity per agent, person, and organization — with custody, delegation, naming, credentials, payments-policy, and audit evidence designed as one system instead of stitched from ten vendors.

## The category

We are not "an auth provider", "a wallet SDK", or "an agent framework". We are the **substrate** those things should sit on: 30+ TypeScript packages and 42 audited-in-the-open Solidity contracts that share one identity anchor, one delegation model, and one evidence trail.

## The problem (why now)

AI agents are getting wallets, names, registries, and payment rails **this year** — ERC-8004 went to mainnet, MetaMask shipped an Agent Wallet, GoDaddy launched an Agent Naming Service, x402 made machine payments real. Every team building agentic products today faces the same stitch-job: Privy + Safe + Pimlico + ENS + EAS + Turnkey + a policy engine + an audit log — eight vendors, eight identity models, zero coherent trust chain. When an agent acts on a human's behalf, *who authorized what, under which limits, provable to whom?* The stitched stack cannot answer that question. A substrate can.

## The five pillars (every doc leads with one or more)

1. **The address IS the identity.** Every person, org, service agent, and treasury is an ERC-4337 Smart Agent address. Names, passkeys, profiles, credentials, registry entries — all replaceable facets pointing at that anchor. Lose a credential, keep your identity: recovery rotates keys, never the address, and every delegation you ever issued stays valid.
2. **One delegation model, everywhere.** The same EIP-712 delegation with on-chain caveats authorizes a web app, an A2A agent call, an MCP tool, and an on-chain spend. Scoped, revocable, replay-protected authority — apps and agents get permissions, never keys.
3. **Custody is not authority.** Credential rotation, trustee quorums, and recovery are custody-policy operations governed by our own multi-sig modules — never delegations, never a third-party multi-sig dependency.
4. **Contracts and SDK are one artifact.** TypeScript typehashes, ABIs, and storage layouts are CI-locked to the Solidity. You cannot drift the client from the chain.
5. **Audited in the open.** A public, CI-gated findings ledger (`docs/audits/findings.yaml`) where a "closed" finding must anchor to real source. We publish our own adversarial audits before anyone asks. Trust infrastructure should be the most transparent code you depend on.

## Proof points (use these, keep them current)

- 42 Solidity contracts, line-by-line self-audit published; 774 Foundry tests incl. invariant suites; 27 package test suites.
- Cross-stack CI gates: EIP-712 typehash equality, ABI sync, storage-layout snapshots, package-boundary doctrine, finding-ledger freshness.
- Live end-to-end on Base Sepolia: Google/passkey/SIWE sign-in → Smart Agent deploy → custody policy → delegations → MCP vault/tool calls → audit evidence.
- Competitive landscape mapped per focus area in `docs/feature-analysis/` — we know exactly where we overlap and where we're alone.

## What only the substrate can say (differentiators vs. category leaders)

- vs. **auth/wallet vendors** (Privy, Dynamic, Web3Auth): they end at login + a key; we begin there — the session is bound to an on-chain identity with custody policy and delegated authority behind it.
- vs. **smart-account vendors** (Safe, ZeroDev, Alchemy): they ship an account; we ship the account *plus* who it is (naming, profiles, registry), what it may do (delegation + policy), and how to prove it (attestations + audit).
- vs. **agent frameworks** (LangChain, MCP middleware, AgentKit): they orchestrate calls; we make every call attributable to a canonical principal with on-chain-enforceable limits.
- vs. **registries/standards** (ERC-8004, ANS, HCS): we don't compete with standards — the Smart Agent anchor implements them as facets, so one identity serves all of them.

## Voice & style

- **Confident, technical, evidence-backed.** Every bold claim sits next to a proof point or a link. No "revolutionary", no "blazingly fast", no exclamation marks.
- **Honest about status.** Pre-production stays labeled pre-production; stub packages stay labeled stubs. Our transparency IS the brand — overclaiming destroys the one differentiator competitors can't copy.
- **Concrete over abstract.** "An agent can spend 50 USDC/day from the org treasury, revocable instantly" beats "flexible policy controls".
- **Short sentences carry the punch.** Lead with the differentiated claim, then earn it.

## Hard constraints (non-negotiable)

- **ADR-0021:** `packages/*` stay generic — no vertical vocabulary, no white-label/product names, no hostnames, no deployment specifics. Package READMEs may be compelling, but the positioning is "generic trust building block", never branded vertical copy. (CI: `check:no-domain-in-packages`, `check:forbidden-terms`.)
- **Budgets:** package `README.md` ≤ 1800 words; `CLAUDE.md` ≤ 60 lines.
- **Accuracy outranks flair.** Never claim a capability the package doesn't ship today; roadmap items are framed as roadmap.

## Boilerplate (reusable blocks)

**Short (npm/package header):**
> Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

**Status (pre-production):**
> Testnet/pilot-ready. Production launch is gated on the public checklist in the root README — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).
