# @agenticprimitives/contracts

**Contracts and SDK are one artifact.**

This is the on-chain enforcement layer of the agenticprimitives substrate — 42 Solidity sources, all present and audited under `src/`, none of them stubs. ERC-4337 v0.7 Smart Agent core, ERC-7710-style delegation manager with caveat enforcers, an ERC-7579 modular CustodyPolicy, a three-mode paymaster, `.agent` TLD naming with hierarchical subregistries, ontology and profile resolvers, identity facets, and an ERC-6492-aware UniversalSignatureValidator. The package publishes ABI subpaths, per-network deployment JSON, flattened sources, and the Solidity itself — so a TypeScript consumer pulls addresses and ABIs from the same artifact the auditors read.

"One artifact" is CI-enforced, not aspirational: TypeScript typehashes are locked to the Solidity constants (`pnpm check:eip712-typehash-equality`), ABIs are sync-gated, and storage layouts are snapshot-gated (`pnpm check:storage-layouts`). You cannot drift the client from the chain.

> Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

## What's in `src/`

- `AgentAccount.sol` — UUPSUpgradeable + ERC-7579 + ERC-1271 + WebAuthn-supporting Smart Agent; a thin modular core where custody, threshold, and session machinery are modules, not inlined features
- `AgentAccountFactory.sol` — CREATE2 deterministic deploys; salt from auth methods + scope (NEVER from a name)
- `SmartAgentPaymaster.sol` — verifying-paymaster + allowlist + devMode (testnet only) modes
- `agency/DelegationManager.sol` + `enforcers/{AllowedMethods,AllowedTargets,Timestamp,Value,Quorum,CallDataHash}Enforcer.sol` — scoped delegation with on-chain caveat enforcement
- `custody/CustodyPolicy.sol` — 16-action ERC-7579 module, T4/T5/T6 quorum tiers + 24h default T5 timelock
- `naming/{AgentNameRegistry,AgentNameUniversalResolver,AgentNameAttributeResolver,PermissionlessSubregistry}.sol`
- `identity/AgentProfileResolver.sol` + `ontology/{OntologyTermRegistry,ShapeRegistry,AttributeStorage}.sol`
- `relationships/{AgentRelationship,RelationshipTypeRegistry}.sol` (⚠ Privacy Fork — experimental surface; see AUDIT.md § 3.9)
- `governance/{AgenticGovernance,GovernanceManaged}.sol` — system pause + governance base
- `libraries/{WebAuthnLib,P256Verifier,SignatureSlotRecovery,MultiSendCallOnly}.sol` — security-critical primitives
- `UniversalSignatureValidator.sol` — single signature entrypoint (ERC-6492 + ERC-1271 + raw ECDSA fanout per spec 214 SB-4)
- `ApprovedHashRegistry.sol` — v=1 pre-approved hash signature path

Behind it: 774 Foundry tests including invariant suites, plus Halmos symbolic proofs, Echidna and Medusa fuzzing campaigns, and PR-blocking static analysis (Slither, Aderyn, CodeQL, Solhint).

Deployed addresses (Base Sepolia testnet): [`deployments-base-sepolia.json`](./deployments-base-sepolia.json) — committed, public, and surfaced to TypeScript consumers via the generated `@agenticprimitives/contracts/deployments/base-sepolia` subpath.

## How it's different

Compared to Safe, ZeroDev, or Alchemy's contract stacks, the difference is scope and coupling. Those projects ship an account (and ship it well); the rest of the trust chain — who the account is, what it may delegate, how custody recovers it — is left to integrations with other vendors' contracts. Here the account, delegation manager, caveat enforcers, custody module, naming registry, and signature validator are designed and audited as one system, sharing one identity anchor. There is no third-party multi-sig dependency: custody quorums are our own ERC-7579 module, with Safe-style signature packing ported as a pattern rather than inherited as a runtime dependency. And the consumption model is different — most contract suites hand you addresses and a block explorer link; this package hands you versioned ABIs, deployments, and flattened sources as npm subpaths, CI-locked to the TypeScript SDK that consumes them.

## Setup

First time only:

```bash
bash setup.sh    # clones OpenZeppelin, forge-std, account-abstraction into lib/
forge build
```

`setup.sh` is idempotent. It clones into `lib/` (gitignored) rather than using `git submodule add` so this repo doesn't take a submodule dependency.

## Deploy to Anvil

```bash
# Start Anvil in another terminal
anvil

# Then in this directory:
pnpm deploy:anvil
```

Writes deployed addresses to `deployments-anvil.json`. The demo apps (`apps/demo-web`, `apps/demo-a2a`, `apps/demo-mcp`) read this file on startup.

## Deploy to Base Sepolia

```bash
export BASE_SEPOLIA_RPC=https://sepolia.base.org
export PRIVATE_KEY=0x...     # funded deployer
pnpm deploy:base-sepolia
```

Writes to `deployments-base-sepolia.json`. CI and hosted deploys read this. Demo idle cost: ~$0.

## Audit posture

Trust infrastructure should be the most transparent code you depend on, so the audit trail is public by default:

- [`AUDIT.md`](./AUDIT.md) — the security and invariant dossier for every contract under `src/`, including the production key-rotation runbook (§ 4.1).
- [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml) — the live, CI-gated findings ledger; a "closed" finding must anchor to real source or the build fails.
- [`docs/audits/2026-05-packages-contracts-production-readiness.md`](../../docs/audits/2026-05-packages-contracts-production-readiness.md) — the per-contract findings dossier.
- [`CLAUDE.md`](./CLAUDE.md) — architecture rationale and per-file roles.

## Status

Testnet/pilot-ready. Production launch is gated on the public checklist in the root README — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).

**Production deployment is deliberately deferred:** the testnet uses a publicly disclosed deployer EOA on purpose (it keeps the demo reproducible). The production rotation runbook is [`AUDIT.md` § 4.1](./AUDIT.md#41-the-production-gate-open-audit-item-n1).
