# demo-web

**The five-minute proof: a browser, a key, and a scoped delegation — no custody handed over, ever.**

Most "connect wallet" demos end where the interesting part begins. This one is the fast baseline for the [agenticprimitives](../../README.md) trust substrate: see the trust chain run, not read about it. In one screen you sign in, deploy a Smart Agent, authorize an A2A agent with a caveated delegation, and watch that agent call an MCP tool on your behalf — with the authority trail intact at every hop.

## The chain it proves

> Sign-in (SIWE or passkey) → counterfactual Smart Agent deploy → caveated EIP-712 delegation to the [`demo-a2a`](../demo-a2a) agent → delegated MCP profile read via [`demo-mcp`](../demo-mcp).

Two signer paths, same identity model:

- **EOA path** — a demo wallet (or your own via wagmi) signs SIWE; the Smart Agent is deployed with that EOA as credential.
- **Passkey path** — register a WebAuthn passkey, deploy a passkey-custodied Smart Agent, and sign the delegation with the passkey (ERC-1271/ERC-6492 verified on-chain).

Either way, the agent you authorize receives **a revocable, time-boxed, target-scoped delegation — never a key**. The downstream MCP server verifies that delegation before serving a single byte. That is pillar two of the substrate ("one delegation model, everywhere") running in a page.

This is deliberately the simple story. The full product arc — organizations, treasuries, two-person control — lives in [`demo-web-pro`](../demo-web-pro); credential recovery lives in [`demo-web-recovery`](../demo-web-recovery).

## Packages composed

- [`@agenticprimitives/connect-auth`](../../packages/connect-auth) — SIWE + passkey ceremonies, CSRF, sessions
- [`@agenticprimitives/agent-account`](../../packages/agent-account) — counterfactual deploy, ERC-4337 account client
- [`@agenticprimitives/delegation`](../../packages/delegation) — EIP-712 delegation issuance with caveat enforcers
- [`@agenticprimitives/agent-naming`](../../packages/agent-naming) — name display for the deployed agent
- [`@agenticprimitives/types`](../../packages/types) — shared primitives

## Run it

```bash
# Everything at once (Anvil + contracts + workers + apps), from the repo root:
pnpm dev

# Or just this app:
pnpm dev:web    # http://127.0.0.1:5173
```

The dev server forwards `/a2a/*` to the [`demo-a2a`](../demo-a2a) Worker on `:8787`, so the browser talks to the agent without CORS friction. Chain config (chain id, RPC, contract addresses) is fetched at runtime from `/a2a/deployments` — the same bundle runs against local Anvil or Base Sepolia with no rebuild.

## Status

Reference implementation, not a product. Runs end to end against Base Sepolia and local Anvil. Production launch of the substrate is gated on the public checklist in the [root README](../../README.md) — external contract audit, governance key rotation — with every security finding tracked live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml). Demo keys and mnemonics here are for development only.

Validate: `pnpm check:demo-web`.
