# demo-jp

**An intent marketplace where the broker can match you — but can never read your mail.**

This is the adopt-a-people-group pilot ([spec 236](../../specs/236-jp-adoption-pilot.md)): a relying app that drives the [agenticprimitives](../../README.md) **intent → match → agreement** spine with real people, real organizations, and a strict data-ownership model. It exists to prove a claim most marketplace software cannot make: every record lives in its owner's vault, every cross-party read rides a granted delegation, and the only thing that touches the chain is a commitment hash — never terms, never contact details.

> **Demo only.** "JP" is a placeholder; no real-program affiliation. No real connections are brokered.

## The chain it proves

> Connect sign-in at the trust home ([`demo-sso-next`](../demo-sso-next)) → person + org Smart Agents → intents expressed from the member's own dashboard → broker matches under an ERC-1271-verified recognition credential → issuer registers the agreement commitment and publishes a bilateral joint assertion on-chain → confidential data released only on accept, from the owner's vault.

Three actors, three trust roles:

- **Adopter / Facilitator** — real people connecting via Connect, each controlling a person Smart Agent and org Smart Agent(s). They express intents from their own dashboards.
- **JP ("Jill")** — the broker. Recognizes facilitators with an off-chain JP-signed credential (honored only if its signature ERC-1271-verifies — never presence-only) and brokers matches.
- **GC ("Pete")** — the issuer. Registers agreement commitments and publishes bilateral joint assertions on-chain.

The data doctrine is the differentiator: member records live in the **member's** MCP vault ([spec 247](../../specs/247-per-agent-mcp-vault.md)), which JP reads via a granted delegation; the issuer's index lives in the issuer's vault; on-chain reads are single-mechanism `readContract` calls only ([ADR-0012](../../docs/architecture/decisions/0012-no-eth-getlogs-in-product-read-paths.md)). The security posture, including the accepted testnet shortcut of deterministic operator keys, is documented adversarially in [AUDIT.md](./AUDIT.md).

## Packages composed

- [`@agenticprimitives/intent-marketplace`](../../packages/intent-marketplace) / [`intent-resolver`](../../packages/intent-resolver) / [`fulfillment`](../../packages/fulfillment) — the intent spine
- [`@agenticprimitives/agreements`](../../packages/agreements) / [`attestations`](../../packages/attestations) — bilateral commitments and joint assertions
- [`@agenticprimitives/connect`](../../packages/connect) / [`connect-auth`](../../packages/connect-auth) / [`browser-identity`](../../packages/browser-identity) — Connect sign-in
- [`@agenticprimitives/delegation`](../../packages/delegation) / [`related-agents`](../../packages/related-agents) / [`agent-relationships`](../../packages/agent-relationships) — vault grants and person↔org links
- [`@agenticprimitives/agent-account`](../../packages/agent-account) / [`agent-naming`](../../packages/agent-naming) / [`verifiable-credentials`](../../packages/verifiable-credentials) / [`payments`](../../packages/payments) / [`identity-directory-adapters`](../../packages/identity-directory-adapters) / [`contracts`](../../packages/contracts) / [`types`](../../packages/types)

## Run it

```bash
pnpm --filter @agenticprimitives-demo/jp dev    # http://localhost:5573
cd apps/demo-jp && pnpm typecheck && pnpm build
```

Deploy is Cloudflare Pages with production branch `main`:

```bash
cd apps/demo-jp && pnpm build && npx wrangler pages deploy dist --project-name=agenticprimitives-demo-jp --branch=main
```

## Status

Reference implementation, not a product. Runs live against Base Sepolia through the trust home and the [`demo-a2a`](../demo-a2a)/[`demo-mcp`](../demo-mcp) vault path. Known testnet shortcuts (deterministic operator keys) are documented in [AUDIT.md](./AUDIT.md) with hardening tracked in spec 248. Production launch of the substrate is gated on the public checklist in the [root README](../../README.md); findings live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).
