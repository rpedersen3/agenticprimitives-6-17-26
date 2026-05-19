# Spec 120 — Deploy (all-Cloudflare)

**Status:** v0 draft · 2026-05-19
**Purpose:** how to take the demo from local Anvil to a public Cloudflare deploy.

The demo runs on **Cloudflare end-to-end**: Pages for `demo-web`, Workers for `demo-a2a` and `demo-mcp`, Durable Object for sessions, D1 for PII + JTI tracking. Contracts deploy to **Base Sepolia** (or any L2 you prefer).

---

## 1. Local dev (no account needed)

```bash
# One-time: install Foundry libs + build contracts
cd apps/contracts && bash setup.sh && pnpm build && cd ../..

# Each session:
pnpm dev   # starts anvil + deploys contracts + 3 workers + vite web
```

`pnpm dev` orchestrates:
1. `anvil --port 8545` (local chain).
2. `forge script Deploy.s.sol` → writes `apps/contracts/deployments-anvil.json`.
3. `tsx scripts/gen-dev-vars.ts` → writes `apps/demo-{a2a,mcp}/.dev.vars` with contract addresses + dev secrets.
4. `wrangler d1 migrations apply demo-mcp --local` → applies the SQL schema to the local D1.
5. `wrangler dev` for demo-a2a (port 8787) and demo-mcp (port 8788).
6. `vite dev` for demo-web (port 5173, proxies `/a2a/*` to the Worker).

No Cloudflare account needed for any of this. `wrangler dev` runs Workers locally via miniflare.

---

## 2. One-time Cloudflare setup

```bash
# Create a Cloudflare account, then:
wrangler login    # browser-based OAuth; stores creds in ~/.config/.wrangler/

# Create the D1 database for demo-mcp.
cd apps/demo-mcp
wrangler d1 create demo-mcp
# Copy the printed database_id into wrangler.toml under [[d1_databases]].
wrangler d1 migrations apply demo-mcp --remote
cd ../..
```

The DO for `demo-a2a` is created automatically on first `wrangler deploy` (per the `new_sqlite_classes` migration in wrangler.toml).

---

## 3. Deploy contracts to Base Sepolia

```bash
# Get a funded deployer EOA + RPC URL.
export BASE_SEPOLIA_RPC=https://sepolia.base.org
export PRIVATE_KEY=0x...   # funded with ~0.05 ETH on Base Sepolia

cd apps/contracts
forge script script/Deploy.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC \
  --broadcast \
  --private-key $PRIVATE_KEY \
  -vvv
# Writes deployments-base-sepolia.json
```

Bridge ETH to Base Sepolia: https://bridge.base.org/

---

## 4. Set Worker secrets + vars

```bash
cd apps/demo-a2a

# Secrets (set once per environment)
echo -n "prodkid:$(openssl rand -hex 32)" | wrangler secret put SESSION_JWT_SECRETS
echo -n "0x$(openssl rand -hex 32)"        | wrangler secret put CSRF_SECRET
echo -n "0x$(openssl rand -hex 32)"        | wrangler secret put A2A_SESSION_SECRET
# Master signing key for the demo (generate a dedicated EOA for this)
echo -n "0x..."                            | wrangler secret put A2A_MASTER_PRIVATE_KEY

# Contract addresses + RPC override (vars, not secrets — they're not sensitive)
# Edit wrangler.toml under [env.production]:
#   [env.production.vars]
#   RPC_URL = "https://sepolia.base.org"
#   CHAIN_ID = "84532"
#   ENTRY_POINT = "0x..."
#   DELEGATION_MANAGER = "0x..."
#   ... etc from deployments-base-sepolia.json
```

Same for `demo-mcp`: only the contract addresses + RPC override + CHAIN_ID.

---

## 5. Deploy the Workers

```bash
cd apps/demo-a2a && wrangler deploy --env production
cd ../demo-mcp && wrangler deploy --env production
cd ../..
```

Each prints a `workers.dev` URL (e.g., `https://demo-a2a.<sub>.workers.dev`). Note both — you'll wire them into the Pages config.

---

## 6. Update Pages routing + deploy demo-web

Edit `apps/demo-web/public/_redirects`:
```
/a2a/*    https://demo-a2a.<your-subdomain>.workers.dev/:splat    200
```

Build + deploy:
```bash
cd apps/demo-web
pnpm build
wrangler pages deploy dist --project-name=agenticprimitives-demo
```

First deploy creates the project; subsequent deploys push new versions. Each deploy gets a preview URL; the latest becomes production.

---

## 7. Custom domains (optional)

In Cloudflare dashboard:
- Pages → demo project → Custom domains → add `demo.yourdomain.com`.
- Workers → demo-a2a → Triggers → add `a2a.yourdomain.com`.
- Workers → demo-mcp → Triggers → add `mcp.yourdomain.com`.

Then update `apps/demo-web/public/_redirects` to use the custom domain.

---

## 8. CI (GitHub Actions)

Add `.github/workflows/ci.yml` (deferred — not part of v0 commit). Recommended steps:

```yaml
- checkout
- setup pnpm + node 20
- pnpm install
- pnpm check:all
- pnpm -r typecheck
- pnpm -r --filter './packages/*' build
- pnpm test:unit
- pnpm test:integration:packages
# Forge tests:
- cd apps/contracts && forge test
# E2E (needs anvil + wrangler dev — slower, run on main only):
- if: github.ref == 'refs/heads/main'
  run: pnpm test:e2e
```

For deploys triggered by CI, add a job that calls `wrangler deploy` with `CLOUDFLARE_API_TOKEN` from secrets.

---

## 9. Cost model

| Item | Free tier | Demo idle |
| --- | --- | --- |
| Cloudflare Pages | unlimited deploys, 500 builds/mo | $0 |
| Cloudflare Workers (free) | 100k requests/day | $0 |
| Cloudflare Workers (paid) | $5/mo for 10M requests + Durable Objects | $5/mo if using DO |
| D1 | 5GB storage, 100k reads/day, 1k writes/day | $0 |
| Base Sepolia | free (testnet) | $0 |

Total demo cost: **$0–5/mo**. Production traffic scales linearly into Workers Paid.

---

## 10. Rollback

Pages keeps every deploy as an addressable preview URL. To rollback:
- Pages dashboard → Deployments → click an older successful deploy → "Rollback to this deployment".
- Workers: `wrangler deployments list` → `wrangler rollback <deployment-id>`.

D1 is durable. To roll the schema back, write a down-migration file (`migrations/0002_<name>.sql`) and apply.
