# `@agenticprimitives/contracts`

The Solidity contracts that back the agenticprimitives stack — ERC-4337 v0.7 Smart Agent core, ERC-7710 delegation manager + 5 enforcers, ERC-7579 modular CustodyPolicy, SmartAgentPaymaster (3 modes), `.agent` / `.impact` TLD naming, ontology + profile resolvers, identity facets, and an ERC-6492-aware UniversalSignatureValidator. **All sources are present and audited under `src/`**; this is not a stub. The package publishes ABI + per-network deployments + flattened sources for downstream consumers.

For the security & invariant breakdown see [`AUDIT.md`](./AUDIT.md). For the architecture rationale + per-file role see [`CLAUDE.md`](./CLAUDE.md). For the current security review checklist see [`docs/audits/2026-05-packages-contracts-production-readiness.md`](../../docs/audits/2026-05-packages-contracts-production-readiness.md).

**Current contract roster** (28 contracts under `src/`, 635 Foundry tests):
- `AgentAccount.sol` — UUPSUpgradeable + ERC-7579 + ERC-1271 + WebAuthn-supporting SA
- `AgentAccountFactory.sol` — CREATE2 deterministic deploys; salt from auth methods + scope (NEVER from a name)
- `SmartAgentPaymaster.sol` — verifying-paymaster + allowlist + devMode (testnet only) modes
- `agency/DelegationManager.sol` + `enforcers/{AllowedMethods,AllowedTargets,Timestamp,Value,Quorum}Enforcer.sol`
- `custody/CustodyPolicy.sol` — 16-action ERC-7579 module, T4/T5/T6 quorum tiers + 24h default T5 timelock
- `naming/{AgentNameRegistry,AgentNameUniversalResolver,AgentNameAttributeResolver,PermissionlessSubregistry}.sol`
- `identity/AgentProfileResolver.sol` + `ontology/{OntologyTermRegistry,ShapeRegistry,AttributeStorage}.sol`
- `relationships/{AgentRelationship,RelationshipTypeRegistry}.sol` (⚠ Privacy Fork — see AUDIT.md § 3.9)
- `governance/{AgenticGovernance,GovernanceManaged}.sol` — system pause + governance base
- `libraries/{WebAuthnLib,P256Verifier,SignatureSlotRecovery,MultiSendCallOnly}.sol`
- `UniversalSignatureValidator.sol` — single signature entrypoint (ERC-6492 + ERC-1271 + raw ECDSA fanout per spec 214 SB-4)
- `ApprovedHashRegistry.sol` — v=1 pre-approved hash signature path

Deployed addresses (Base Sepolia testnet): [`deployments-base-sepolia.json`](./deployments-base-sepolia.json) (committed, public; surfaced to TypeScript consumers via the generated `@agenticprimitives/contracts/deployments/base-sepolia` subpath).

**Production deployment is deferred** — the testnet uses a publicly disclosed deployer EOA intentionally (keeps the demo reproducible). See [`AUDIT.md` § 4.1](./AUDIT.md#41-the-production-gate-open-audit-item-n1) for the production rotation runbook.

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

Writes deployed addresses to `deployments-anvil.json`. The other demo apps (`apps/demo-web`, `apps/demo-a2a`, `apps/demo-mcp`) read this file on startup.

## Deploy to Base Sepolia

```bash
export BASE_SEPOLIA_RPC=https://sepolia.base.org
export PRIVATE_KEY=0x...     # funded deployer
pnpm deploy:base-sepolia
```

Writes to `deployments-base-sepolia.json`. The CI/Vercel/Fly deploy reads this. Demo idle cost: ~$0.
