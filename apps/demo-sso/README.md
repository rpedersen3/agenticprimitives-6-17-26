# @agenticprimitives-demo/sso

**Agentic Connect** — passkey, wallet (SIWE), or Google sign-in at one Connect origin; deploy a person Smart Agent on Base Sepolia; read PII gated by `AgentSession`; optionally provision an A2A service agent.

Capstone for [spec 224](../../specs/224-agentic-connect.md) + [spec 227](../../specs/227-real-connect-experience.md) ([ADR-0014](../../docs/architecture/decisions/0014-connect-is-an-sso-broker.md)).

```bash
pnpm --filter @agenticprimitives-demo/sso dev   # http://localhost:5373 (UI only)
```

For passkey, `/me` PII, and `/a2a` deploy: `wrangler pages dev dist` — see [docs/passkey-sso-flow.md](./docs/passkey-sso-flow.md) and [OIDC-SETUP.md](./OIDC-SETUP.md).

## Documentation

| Doc | Description |
| --- | --- |
| [docs/passkey-sso-flow.md](./docs/passkey-sso-flow.md) | Interaction diagrams: passkey → bootstrap → A2A → person MCP PII |
| [docs/README.md](./docs/README.md) | Doc index |
| [CLAUDE.md](./CLAUDE.md) | Layout, endpoints, secrets |
| [OIDC-SETUP.md](./OIDC-SETUP.md) | Google OIDC + wrangler |

## What you'll see

1. **Connect** — sign in with passkey, wallet, or Google.
2. **Bootstrap** (first visit) — deploy person SA via demo-a2a, enroll credential, optional `.demo.agent` name.
3. **Agent card** — `GET /me/profile` with a verified `AgentSession` (`sub` = CAIP-10, no `owner`).
4. **PII** — sensitive fields blurred until reveal; custody-grade session required (`/me/sensitive`).
5. **A2A** (optional) — second Smart Agent + `OPERATES_ON_BEHALF_OF` edge to your workspace.

## Packages wired

- [`@agenticprimitives/connect`](../../packages/connect) — `AgentSession`, JWKS, `issueForResolution`, verify
- [`@agenticprimitives/identity-directory`](../../packages/identity-directory) — resolve (indexer proposes, on-chain confirms)
- [`@agenticprimitives/connect-auth`](../../packages/connect-auth) — SIWE, passkey, Google OIDC
- [`@agenticprimitives/agent-account`](../../packages/agent-account) — deploy + `isValidSignature`
- Proxied [`demo-a2a`](../demo-a2a/) — UserOp build/submit on Base Sepolia
