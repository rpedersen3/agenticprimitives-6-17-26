# apps/contracts — demo contracts

Solidity contracts for the agenticprimitives demo. **Vendored minimum** from [`smart-agent/packages/contracts/`](https://github.com/agentictrustlabs/smart-agent/tree/003-intent-marketplace-proposal/packages/contracts). Just the contracts needed to demonstrate the end-to-end flow:

- `AgentAccount.sol` — ERC-4337 smart account (UUPS upgradeable, owner-based, ERC-1271)
- `AgentAccountFactory.sol` — CREATE2 factory for deterministic addressing
- `DelegationManager.sol` — delegation registry + revocation
- `ICaveatEnforcer.sol` + `enforcers/*` — the four enforcers our demo uses (Timestamp, AllowedTargets, AllowedMethods, Value)

Not vendored (out of scope for demo): passkey validators, paymaster, naming registry, the marketplace/funding contracts, ontology, governance, etc. Those live in smart-agent.

> **Status:** contracts not yet vendored in this commit. The `src/` directory is empty; vendoring lands in a follow-up commit. This commit ships the foundry scaffold so the structure is in place.

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
