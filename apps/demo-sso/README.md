# demo-sso

**One sign-in, one canonical identity, every relying site — and the broker never owns you.**

This is **Agentic Connect**, the capstone integration demo for the [agenticprimitives](../../README.md) SSO wave ([spec 224](../../specs/224-agentic-connect.md), [ADR-0014](../../docs/architecture/decisions/0014-connect-is-an-sso-broker.md)). The pitch is simple and the implementation is not: sign in with a passkey, wallet, or Google at one Connect origin, get a person Smart Agent on Base Sepolia, and walk away with a session bound to an on-chain identity — not a vendor account.

## The chain it proves

> Passkey / SIWE / Google OIDC at the Connect origin → resolve-or-bootstrap a person Smart Agent on Base Sepolia → `AgentSession` (CAIP-10 subject, no `owner` field, ever) → delegation-gated PII at `/me/*` → optional A2A service agent provisioned with an `OPERATES_ON_BEHALF_OF` edge.

What you will see, in order:

1. **Connect** — passkey, wallet, or Google sign-in.
2. **Bootstrap** (first visit) — deploy the person Smart Agent via [`demo-a2a`](../demo-a2a), enroll the credential, optionally claim a `.demo.agent` name.
3. **Agent card** — `GET /me/profile` under a verified `AgentSession` where `sub` is the agent's CAIP-10 id.
4. **PII with step-up** — sensitive fields stay blurred until a custody-grade session unlocks `/me/sensitive`. A login-grade OIDC session cannot authorize a custody-class action ([ADR-0017](../../docs/architecture/decisions/0017-oidc-social-is-a-login-facet-not-custody.md)).
5. **A2A** (optional) — a second Smart Agent linked to your workspace.

The doctrine that makes it different from every hosted-auth vendor: the relying site is a **scoped delegate, never a custodian** ([ADR-0019](../../docs/architecture/decisions/0019-relying-site-authority-is-a-scoped-delegation.md)). Cross-origin enrollment issues a caveated, time-boxed ERC-7710 delegation signed by your root passkey — no `addPasskey`, no custodian slot, instantly revocable, and your address never changes.

Two broker variants ship side by side: an **in-browser broker** (key generated in-page, zero backend — the fast path) and the **server broker** in `functions/` (key held as a server secret, JWKS published, single-use code exchange — the production-correct shape). Real Google OIDC runs on the server broker; see [OIDC-SETUP.md](./OIDC-SETUP.md). Flow diagrams: [docs/passkey-sso-flow.md](./docs/passkey-sso-flow.md).

## Packages composed

- [`@agenticprimitives/connect`](../../packages/connect) — `AgentSession`, JWKS, `issueForResolution`, verification
- [`@agenticprimitives/connect-auth`](../../packages/connect-auth) — passkey, SIWE, Google OIDC ceremonies
- [`@agenticprimitives/identity-directory`](../../packages/identity-directory) (+ [`adapters`](../../packages/identity-directory-adapters)) — resolution: indexer proposes, on-chain confirms
- [`@agenticprimitives/agent-account`](../../packages/agent-account) — deploy + `isValidSignature`
- [`@agenticprimitives/delegation`](../../packages/delegation) / [`agent-naming`](../../packages/agent-naming) / [`agent-profile`](../../packages/agent-profile) / [`agent-relationships`](../../packages/agent-relationships) / [`contracts`](../../packages/contracts) / [`types`](../../packages/types)

## Run it

```bash
pnpm --filter @agenticprimitives-demo/sso dev   # http://localhost:5373 (UI + in-browser broker)
```

For passkey enrollment, `/me` PII, and A2A deploys you need the server broker:

```bash
cp .dev.vars.example .dev.vars                  # fill it in
node scripts/gen-broker-key.mjs                 # → BROKER_PRIVATE_JWK + kid
pnpm --filter @agenticprimitives-demo/sso build
wrangler pages dev dist --kv AUTH_CODES         # :8788
```

Full local-vs-deploy steps and Google console config: [OIDC-SETUP.md](./OIDC-SETUP.md).

## Status

Reference implementation, not a product. The flows run live against Base Sepolia; the in-browser broker deliberately simulates credential verification (it exists to make the flow inspectable without a backend), while the server broker is the production-correct shape. Production launch is gated on the public checklist in the [root README](../../README.md); findings are tracked in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).

Validate: `pnpm check:demo-sso`.
