# Incremental registry redeploy — SC-1 / SC-2 (audit 2026-06-09)

Lands the **AgreementRegistry** (SC-1, Critical) and **AttestationRegistry** (SC-2, High) fixes on
Base Sepolia **without a full factory reset** — every persona, name, and SA address in the existing
deployment is preserved. Both are no-arg leaf registries; nothing on-chain bakes in their addresses.

> SC-3 (DelegationManager) is immutable in the factory and therefore can only land via a full reset;
> it's a latent view function (`verifyAuthorizationForCall`) no app calls. SC-4/SC-5 are deploy-script
> guards that apply on the next full `Deploy.s.sol`. Defer all three to a reset that has a real driver.

## Steps

From `packages/contracts`, with `BASE_SEPOLIA_RPC` + `PRIVATE_KEY` in env (e.g. sourced from
`.env.deploy.local`):

```bash
# 1. Deploy the two new registries (writes deployments-registries-base-sepolia.json sidecar)
pnpm deploy:registries:base-sepolia

# 2. Merge the 2 new addresses into deployments-base-sepolia.json (preserves all other addresses)
DEPLOY_NETWORK=base-sepolia pnpm deploy:registries:merge

# 3. Regenerate the subpath export the apps import (@agenticprimitives/contracts/deployments/base-sepolia)
pnpm build:deployments
```

Then redeploy the **only** consumer with the changed ABI (`register` dropped `attestationStructHash`):

```bash
# 4. demo-jp (Pages prod branch is main — see apps/demo-jp/CLAUDE.md)
cd ../../apps/demo-jp && pnpm build && npx wrangler pages deploy dist \
  --project-name=agenticprimitives-demo-jp --branch=main
```

## Verify

- The two new addresses appear in `deployments-base-sepolia.json` (only those two keys changed).
- A demo-jp agreement registration + recognition flow succeeds end-to-end (the issuer now signs the
  recomputed bound digest; the old packed-hash path would revert `InvalidIssuerSignature`).
- Commit the updated `deployments-base-sepolia.json` after a successful deploy.
