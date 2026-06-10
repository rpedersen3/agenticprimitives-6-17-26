# demo-web-pro

**Two people, one organization, one treasury — and not a single shared key between them.**

This is the canonical product-flow demo for the [agenticprimitives](../../README.md) substrate: the Treasury Service Agent story from [spec 211](../../specs/211-treasury-service-agent-demo.md), told end to end in six live acts. Where [`demo-web`](../demo-web) proves the baseline delegation chain in five minutes, this app proves the substrate's organizational claim — that people, orgs, and treasuries are all Smart Agents, and authority flows between them under custody policy, not under copied credentials.

## The chain it proves

> Passkey sign-in → Person Smart Agent deploy → Organization Smart Agent → Treasury Service Agent → two-person custody control → delegation surface → org dashboard.

All six acts run live today:

1. **Alice joins** — passkey-custodied Person Smart Agent
2. **Create Org** — an Organization Smart Agent, founded by Alice
3. **Create Treasury** — a Treasury Service Agent; the account is the embodiment, the agent is the identity
4. **Bob joins** — a second passkey-controlled person
5. **Two-person control** — custody-policy quorum over org actions
6. **Delegation surface + Org Dashboard** — scoped operational authority, inspectable

The doctrine on display: the human controls one Person Smart Agent via passkey; everything after that is **agent-to-agent authority** — admin changes are deliberate custody operations, stewardship is bounded delegation, and the web app itself holds no authority at all (it builds UX and calldata; contracts and the [`demo-a2a`](../demo-a2a) Worker enforce the model).

The walkthrough lives in [`docs/treasury-service-agent/guide.md`](docs/treasury-service-agent/guide.md). The recovery sequel — Sam loses his passkey, trustees restore access, the address never changes — is [`demo-web-recovery`](../demo-web-recovery), which reads this app's completed state as its prerequisite.

## Packages composed

- [`@agenticprimitives/connect-auth`](../../packages/connect-auth) — passkey ceremonies, sessions
- [`@agenticprimitives/agent-account`](../../packages/agent-account) — ERC-4337 + ERC-7579 account client, gasless deploys
- [`@agenticprimitives/account-custody`](../../packages/account-custody) — custody-policy actions, quorums
- [`@agenticprimitives/delegation`](../../packages/delegation) — caveated EIP-712 delegations
- [`@agenticprimitives/agent-naming`](../../packages/agent-naming) / [`agent-profile`](../../packages/agent-profile) / [`agent-relationships`](../../packages/agent-relationships) — names, profiles, and governance edges as facets of each agent
- [`@agenticprimitives/types`](../../packages/types) — shared primitives

## Run it

```bash
# Everything (Anvil + contracts + a2a + mcp + this app + demo-web):
pnpm dev

# Just this app:
pnpm --filter @agenticprimitives-demo/web-pro dev   # http://127.0.0.1:5273
```

Port 5273 is deliberately distinct from `demo-web`'s 5173 so both run side by side.

## Status

Reference implementation, not a product. All six acts are live against the deployed contracts; act status is tracked honestly in `src/treasury/acts.ts` (`not-started` → `simulated` → `live`). The substrate runs on Base Sepolia and local Anvil; production launch is gated on the public checklist in the [root README](../../README.md), with every security finding tracked in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).

Validate: `pnpm check:demo-web-pro`.
