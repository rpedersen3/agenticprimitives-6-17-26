# Spec 120 — Deploy (all-Cloudflare)

**Status:** v0.2 · 2026-05-19 (automated via `pnpm deploy:cloudflare`)
**Purpose:** how to take the demo from local Anvil to a public Cloudflare deploy.

The demo runs on **Cloudflare end-to-end**: Pages for `demo-web`, Workers for `demo-a2a` and `demo-mcp`, Durable Object for sessions, D1 for PII + JTI tracking. Contracts deploy to **Base Sepolia** (or any L2 you prefer).

After one-time setup (§2), every subsequent deploy is one command:

```bash
pnpm deploy:cloudflare
```

This drives the rest of the document: §3 deploys contracts, §4 sets secrets, §5–6 are automated.

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
# Create the production D1 database for demo-mcp.
cd apps/demo-mcp
wrangler d1 create demo-mcp
# Copy the printed database_id into wrangler.toml under
#   [[env.production.d1_databases]]  (replace REPLACE_WITH_PROD_D1_ID).
cd ../..
```

Migrations are applied on every deploy by `pnpm deploy:cloudflare` (idempotent), so no separate step is needed.

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

Bridge ETH to Base Sepolia: [https://bridge.base.org/](https://bridge.base.org/)

---

## 4. Set Worker secrets (one-time per environment)

Secrets are non-inheritable per Cloudflare env, so each call needs `--env production`. Run the helper script:

```bash
bash scripts/set-cloudflare-secrets.sh           # local-aes backend (default; generates a fresh EOA)
A2A_KMS_BACKEND=gcp-kms bash scripts/set-cloudflare-secrets.sh   # GCP KMS backend (see §4.5)
```

For local-aes, this generates and sets:

- `SESSION_JWT_SECRETS` — `kid:hex` HS256 signing secrets
- `CSRF_SECRET` — HMAC for CSRF tokens
- `A2A_SESSION_SECRET` — envelope-encryption master for session-key wrapping
- `A2A_MASTER_PRIVATE_KEY` — fresh secp256k1 EOA (the agent's master identity in the local-dev signer)

For GCP KMS, the first three are the same; `A2A_MASTER_PRIVATE_KEY` is replaced by `GCP_SERVICE_ACCOUNT_JSON` (the service-account credentials for the KMS API). See §4.5 for setup.

Contract addresses + RPC overrides + dynamic URLs (`MCP_URL`, `ALLOWED_ORIGINS`) are **not** secrets — `pnpm deploy:cloudflare` passes them per deploy via `--var` (read from `deployments-base-sepolia.json` and captured Worker URLs). Static prod defaults like `RPC_URL` / `CHAIN_ID` live in `wrangler.toml` under `[env.production.vars]`.

---

## 4.5 Production signer: GCP KMS (optional, recommended for production)

The local-aes signer bypasses its own `NODE_ENV=production` guard via a shim in `apps/demo-a2a/src/index.ts`. That's fine for a demo, not for production. To use Cloud KMS instead:

### One-time GCP setup

1. Enable Cloud KMS API in your GCP project.
2. Create a keyring + the secp256k1 signing key:
   ```bash
   gcloud kms keyrings create agenticprimitives-demo --location=us-central1
   gcloud kms keys create agent-master \
     --keyring=agenticprimitives-demo \
     --location=us-central1 \
     --purpose=asymmetric-signing \
     --default-algorithm=ec-sign-secp256k1-sha256 \
     --protection-level=software   # or `hsm` for HSM-backed (~$1/mo)
   ```
3. **(Optional)** Create a SECOND key for envelope encryption (replaces `LocalAesProvider` on the signer side; the demo's per-session AES-GCM payload encryption is still done in-Worker — Cloud KMS only wraps the session data key):
   ```bash
   gcloud kms keys create agent-envelope \
     --keyring=agenticprimitives-demo \
     --location=us-central1 \
     --purpose=encryption \
     --protection-level=software
   ```
   GCP picks the active version internally — the env var (`GCP_KMS_ENCRYPT_KEY_NAME`) points at the **key**, not a specific version.
4. Create a service account, grant it `roles/cloudkms.signer` + `roles/cloudkms.publicKeyViewer` on `agent-master`. If you also created `agent-envelope`, grant `roles/cloudkms.cryptoKeyEncrypterDecrypter` on that key. Download a JSON key.
5. Save the JSON at `.gcp-service-account.local.json` at the repo root (already gitignored).

### Deploy with GCP KMS

```bash
A2A_KMS_BACKEND=gcp-kms bash scripts/set-cloudflare-secrets.sh

A2A_KMS_BACKEND=gcp-kms \
GCP_KMS_KEY_NAME=projects/<P>/locations/<L>/keyRings/agenticprimitives-demo/cryptoKeys/agent-master/cryptoKeyVersions/1 \
  pnpm deploy:cloudflare

shred -u .gcp-service-account.local.json   # optional cleanup
```

### Validate

```bash
curl https://demo-a2a-production.<sub>.workers.dev/agent/identity
# → { "backend": "gcp-kms", "address": "0x..." }
```

`/agent/identity` exercises the full GCP code path: service-account JWT → OAuth token exchange → Cloud KMS `cryptoKeyVersions/.../publicKey` → SPKI parse → keccak256 → Ethereum address. If you see an address back, the migration is working. The private key never leaves KMS (no `:export` capability is granted to the service account).

### Cost


| Protection | Storage      | Signing         |
| ---------- | ------------ | --------------- |
| Software   | $0.06/key/mo | $0.03 / 10k ops |
| HSM        | $1.00/key/mo | $0.30 / 10k ops |


Demo idle: **<$0.10/mo software** or **<$1.10/mo HSM**.

### Lazy smart-account deploy (optional)

By default the demo uses **counterfactual** smart-account addresses — they're computed deterministically via CREATE2 but never deployed on-chain. That's why `apps/demo-mcp/src/index.ts` sets `requireDeployed: false` on the verifier config: there's nothing on-chain to run ERC-1271 against.

To remove that shim, enable **lazy deploy**:

1. Generate a dedicated bootstrap EOA (separate from the agent's master signer, which lives in KMS):
   ```bash
   cast wallet new
   # Prints address + private key. Save both somewhere safe.
   ```
2. **Fund it** with a small amount of Base Sepolia ETH (~0.01 ETH covers ~50 account deploys):
   ```
   https://www.alchemy.com/faucets/base-sepolia
   ```
3. Set it as a Cloudflare secret on demo-a2a:
   ```bash
   echo -n "0xYOUR_BOOTSTRAP_PRIVATE_KEY" | \
     (cd apps/demo-a2a && wrangler secret put A2A_BOOTSTRAP_PRIVATE_KEY --env production)
   ```
4. Redeploy: `A2A_KMS_BACKEND=gcp-kms GCP_KMS_KEY_NAME=... pnpm deploy:cloudflare`
5. Once the bootstrap key is funded + set, demo-a2a will deploy each user's smart account on their first SIWE login.

When lazy deploy is working end-to-end you can then drop `requireDeployed: false` from `apps/demo-mcp/src/index.ts` (`baseConfig`) and redeploy. ERC-1271 will now be checked on every delegation against the live on-chain account.

The bootstrap key is *only* a relayer: it pays gas for `factory.createAccount(owner, salt)` but the deployed smart account is owned by the user's wallet (`owner` is the SIWE-authenticated walletAddress). The bootstrap key never has owner authority over any agent account.

### Why REST, not the @google-cloud/kms SDK?

The official Node SDK uses gRPC, which won't run on Cloudflare Workers even with `nodejs_compat`. `GcpKmsSigner` drives the REST API via `fetch` and signs the auth JWT with `crypto.subtle` (Web Crypto), so the entire path is Workers-native. See `packages/key-custody/src/providers/gcp.ts`.

---

## 5. One-command deploy

```bash
pnpm deploy:cloudflare
```

`scripts/deploy-cloudflare.ts` runs:

1. Pre-flight (`wrangler whoami`, deployments file exists) + `pnpm -r --filter './packages/*' build` so Workers bundle the latest `dist/`.
2. `wrangler d1 migrations apply demo-mcp --remote --env production`.
3. `wrangler deploy --env production` for `demo-mcp` — captures its URL.
4. `wrangler deploy --env production` for `demo-a2a` — injects `MCP_URL` + `ALLOWED_ORIGINS` via `--var`, captures its URL.
5. Writes `cloudflare-urls.json` (gitignored deploy state).
6. `pnpm --filter @agenticprimitives-demo/web build`; ensures the Pages project exists; pipes the demo-a2a URL into `wrangler pages secret put DEMO_A2A_URL` (read by the `functions/a2a/[[path]].ts` proxy at runtime).
7. `wrangler pages deploy dist --project-name=agenticprimitives-demo --branch=master`.

**Why a Pages Function, not `_redirects`?** Cloudflare Pages silently drops `_redirects` 200-rewrites that target an external origin (e.g. `*.workers.dev`). Only same-origin rewrites work there. So `/a2a/`* proxying lives in a Pages Function (`apps/demo-web/functions/a2a/[[path]].ts`) that reads `env.DEMO_A2A_URL` and forwards the request.

Override defaults via env:

```bash
DEPLOY_NETWORK=base-sepolia \
PAGES_PROJECT=agenticprimitives-demo \
DEMO_WEB_URL=https://custom.example.com \
  pnpm deploy:cloudflare
```

If anything fails mid-deploy, fix it and re-run — every step is idempotent. The previous deploy stays live until the new one succeeds.

---

## 6. Custom domains (optional)

In Cloudflare dashboard:

- Pages → demo project → Custom domains → add `demo.yourdomain.com`.
- Workers → demo-a2a → Triggers → add `a2a.yourdomain.com`.
- Workers → demo-mcp → Triggers → add `mcp.yourdomain.com`.

Then re-deploy with `DEMO_WEB_URL=https://demo.yourdomain.com pnpm deploy:cloudflare` so `ALLOWED_ORIGINS` (set on the demo-a2a Worker via `--var`) matches the new Pages hostname. The `_redirects` injection will still point at the demo-a2a workers.dev URL; if you want it to point at `a2a.yourdomain.com` instead, edit `scripts/deploy-cloudflare.ts` to pass the custom domain to `inject-redirects` (or change the marker in `public/_redirects`).

---

## 7. CI (GitHub Actions)

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

## 8. Cost model


| Item                      | Free tier                                  | Demo idle         |
| ------------------------- | ------------------------------------------ | ----------------- |
| Cloudflare Pages          | unlimited deploys, 500 builds/mo           | $0                |
| Cloudflare Workers (free) | 100k requests/day                          | $0                |
| Cloudflare Workers (paid) | $5/mo for 10M requests + Durable Objects   | $5/mo if using DO |
| D1                        | 5GB storage, 100k reads/day, 1k writes/day | $0                |
| Base Sepolia              | free (testnet)                             | $0                |


Total demo cost: **$0–5/mo**. Production traffic scales linearly into Workers Paid.

---

## 9. Rollback

Pages keeps every deploy as an addressable preview URL. To rollback:

- Pages dashboard → Deployments → click an older successful deploy → "Rollback to this deployment".
- Workers: `wrangler deployments list` → `wrangler rollback <deployment-id>`.

D1 is durable. To roll the schema back, write a down-migration file (`migrations/0002_<name>.sql`) and apply.