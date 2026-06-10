# demo-org

**Sign in by name, found an organization, hold the keys to neither — and control both.**

This is the relying-site demo for the [agenticprimitives](../../README.md) personal-central-auth model ([spec 229](../../specs/229-personal-central-auth.md)): a site where you authenticate by **agent name** — the universal username — to the same canonical person Smart Agent you use everywhere else, then create a named **Organization Smart Agent** linked to you on-chain. The punchline is what the site never gets: no password, no custodian slot, no standing key. Just a scoped, revocable delegation.

## The chain it proves

> Name-first sign-in (passkey or SIWE) → runtime auth by on-chain delegation, not a central IdP → Organization Smart Agent created via the central-auth ceremony → `person → HAS_GOVERNANCE_OVER → org` recorded on-chain → the site holds only a caveated `org → site-delegate` delegation.

The auth model is [ADR-0019](../../docs/architecture/decisions/0019-relying-site-authority-is-a-scoped-delegation.md) live:

- **Passkey path** — enrollment at the central auth ([`demo-sso`](../demo-sso)) issues a caveated ERC-7710 delegation from your person agent to this site's delegate (time-boxed, zero value, targets limited to naming + relationships). Runtime login means: holds a live, unrevoked, in-window delegation. You can revoke it at the DelegationManager any time; your address never changes.
- **Wallet/SIWE path** — your EOA is your own custodian; the site holds no standing credential and every on-behalf action is signed by your wallet directly.

Org creation is a central-auth ceremony, not a site privilege: the demo-sso popup deploys the org custodied by **your root passkey only** — never this site's passkey, never the person agent — claims its name, records the governance edge (propose + confirm, root signs), and hands the site a scoped delegation to operate. The site stores the org and its delegation; reads present that delegation just like person-data reads do.

## Packages composed

- [`@agenticprimitives/connect`](../../packages/connect) / [`connect-auth`](../../packages/connect-auth) — sessions, SIWE, passkey ceremonies
- [`@agenticprimitives/agent-account`](../../packages/agent-account) — account client, signature verification
- [`@agenticprimitives/agent-naming`](../../packages/agent-naming) — name-first lookup and claiming
- [`@agenticprimitives/agent-relationships`](../../packages/agent-relationships) — the `HAS_GOVERNANCE_OVER` edge
- [`@agenticprimitives/delegation`](../../packages/delegation) — delegation verification and redemption
- [`@agenticprimitives/identity-directory-adapters`](../../packages/identity-directory-adapters) / [`contracts`](../../packages/contracts) / [`types`](../../packages/types)

## Run it

```bash
pnpm --filter @agenticprimitives-demo/org dev    # http://localhost:5473 (proxies /a2a → demo-a2a)
pnpm --filter @agenticprimitives-demo/org build
wrangler pages deploy dist                       # set BROKER_PRIVATE_JWK, BROKER_KID, DEMO_A2A_URL
```

Server broker routes run as Cloudflare Pages Functions; a KV namespace (`AUTH_CODES`) holds single-use nonces and challenges.

## Status

Reference implementation, not a product. Runs live against Base Sepolia (chain 84532) through the [`demo-a2a`](../demo-a2a) relayer. Production launch of the substrate is gated on the public checklist in the [root README](../../README.md); every security finding is tracked live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).

Validate: `pnpm check:demo-org`.
