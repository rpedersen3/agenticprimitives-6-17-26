# Spec 232 — Migrate demo-sso to a Next.js app on Vercel (unbounded `*.impact-agent.io`)

Status: IN PROGRESS 2026-05-27 — **V1 + V2 DONE** (`apps/demo-sso-next`: Next App
Router scaffold + SPA mounted; broker ported as thin Route Handlers over the
verbatim `server/` bodies + `@upstash/redis` KV adapter; native a2a-agent surface;
builds clean + A2A/discovery verified locally). **V3/V4 = user-run** Vercel deploy
+ wildcard domain — runbook in [`apps/demo-sso-next/DEPLOY.md`](../apps/demo-sso-next/DEPLOY.md).
Supersedes spec 231's **Option 2** (the Cloudflare
wildcard-Worker + `X-Forwarded-Host`/`resolveOrigin`/`PROXY_SHARED_SECRET`
scaffolding) as the wildcard mechanism. Spec 231's A2A protocol surface
(`.well-known/agent-card.json` + `/api/a2a`, host-context) is UNCHANGED — only
where/how it's hosted moves.

## 1. Why

Per-person central auth needs **unbounded** subdomains: anyone who signs up gets
`<handle>.impact-agent.io` with no manual step (spec 229 P5). True wildcard on a
custom domain is a paid feature everywhere; the deciding factors:

- **Cloudflare free/Pro cannot proxy a wildcard** (`*.impact-agent.io` is forced
  DNS-only) → Pages wildcard custom domain blocked; a Worker route can't receive
  arbitrary-subdomain traffic. Unbounded wildcard on Cloudflare needs Enterprise
  or (likely-Enterprise-gated) for-SaaS wildcard custom hostnames.
- **Vercel Pro supports wildcard domains** AND — decisively — **functions see the
  real `Host`**. `alice.impact-agent.io` reaches the handler AS `alice.impact-agent.io`,
  so the per-person OP `iss` (spec 230) and `parseAgentSubdomain` are correct
  natively. This DELETES the entire Cloudflare workaround (router Worker,
  `X-Forwarded-Host`, the shared-secret issuer-spoofing surface).

`demo-sso` today = a **Vite SPA + Cloudflare Pages Functions** broker. We migrate
it to a **Next.js (App Router) app on Vercel Pro** — the **unified per-agent
endpoint** for `<handle>.impact-agent.io`: humans → SSO, machines → the A2A
agent. Because this app owns the wildcard, the **A2A agent surface runs NATIVELY
here** (not proxied to Cloudflare) — that's the whole point of putting the agent
on the wildcard route.

**A2A agent surface vs relayer (the boundary):**
- **Native in the Next app** (light, runtime-agnostic): host-context
  (Host→`<label>.demo.agent`→address via viem `readContract`), the A2A v1.0
  agent-card, `/api/a2a` message routing + (future) light skills. Ported from
  `demo-a2a/src/{host-context,origins}.ts` + the agent-card builder (spec 231).
- **Stays in `demo-a2a` on Cloudflare** (the execution backend): the ERC-4337
  bundler/relayer, KMS signer, **Durable Objects** (`SessionStoreDO`), delegation
  mint, the `demo-mcp` service binding, `/rpc`. These are Cloudflare-shaped (DOs
  have no Vercel equivalent) and serve the OTHER demos too. The Next app's broker
  + a2a-agent CALL this backend (cross-origin, CORS-cleared) for on-chain
  execution; moving it is a separate, larger migration (not in this spec).

## 2. Target architecture

- **Next.js App Router**, broker endpoints as **Route Handlers** (`app/**/route.ts`),
  **Node runtime** (for `@vercel/kv` + Web Crypto + the connect/broker-core deps).
- **SPA preserved, not rewritten**: keep `App.tsx` + `connect-client.ts` +
  `server-client.ts` + `src/lib/*` as a `'use client'` component mounted by
  `app/page.tsx`. Tooling changes Vite→Next; the React code is largely intact.
  Client host-awareness already works (`window.location` is the real subdomain).
- **`@vercel/kv`** (Upstash Redis) replaces the Cloudflare KV `AUTH_CODES` binding.
- **Wildcard domain** `*.impact-agent.io` on the Vercel project (+ apex).
- Issuer discovery unchanged: demo-org's `resolveAuthOrigin(name)` still derives
  `https://<label>.impact-agent.io` (now served by Vercel).

## 3. Route Handler port map (Pages Function → Next App Router)

All under `app/`. `[[path]]` catch-alls → `[...path]`. Node runtime; CORS via
the existing helpers ported into a shared `app/_lib/broker.ts`.

| Pages Function (method) | Next Route Handler |
| --- | --- |
| `jwks.ts` (GET, OPTIONS) | `app/jwks/route.ts` |
| `.well-known/openid-configuration.ts` (GET) | `app/.well-known/openid-configuration/route.ts` |
| `authorize.ts` (POST) | `app/authorize/route.ts` |
| `token.ts` (POST, OPTIONS) | `app/token/route.ts` |
| `oidc/grant.ts` (POST) | `app/oidc/grant/route.ts` |
| `oidc/google/start.ts` · `callback.ts` (GET) | `app/oidc/google/start/route.ts` · `callback/route.ts` |
| `connect/{nonce,name,name-info,passkey-challenge}.ts` (GET) | `app/connect/<name>/route.ts` |
| `connect/{passkey,siwe,with-name,stepup,enroll}.ts` (POST) | `app/connect/<name>/route.ts` |
| `me/[[path]].ts` (GET) | `app/me/[...path]/route.ts` |
| `.well-known/{agent-card.json,agent.json}.ts` — A2A discovery | `app/.well-known/agent-card.json/route.ts` (+ alias) — **NATIVE** (no proxy) |
| `api/a2a/[[path]].ts` — A2A message endpoint | `app/api/a2a/[...path]/route.ts` — **NATIVE** (no proxy) |
| `a2a/[[path]].ts` — RELAYER proxy (SA-deploy, siwe-verify, session…) | `app/a2a/[...path]/route.ts` — **stays a proxy to demo-a2a** |

`_lib/server-broker.ts` → `app/_lib/broker.ts` (same `getServer`, JSON/CORS
helpers; `env` reads become `process.env`). `_lib/verify-delegation.ts` ports as
a plain module. The `_lib/a2a-proxy.ts` helper is retained ONLY for the relayer
proxy (`/a2a/*`), not the A2A agent surface.

### 3.1 A2A agent surface runs natively in the Next app

The light a2a-agent code moves OUT of `demo-a2a` INTO the Next app (it must, to be
served on the wildcard the app owns):

- Port `demo-a2a/src/host-context.ts` (`parseAgentSubdomain`, `agentNameForLabel`,
  `resolveAgentHost`, `buildA2aAgentCard`) → `app/_lib/a2a-agent.ts`. On Vercel
  the route handler reads the **real** Host (no `X-Agent-Subdomain` injection
  needed — that header existed only for the Cloudflare proxy hop).
- `app/.well-known/agent-card.json/route.ts` + `app/api/a2a/[...path]/route.ts`
  resolve `Host → <label>.demo.agent → address` (viem `AgentNamingClient`
  `resolveName`, Node runtime) and serve the card / route messages directly.
- **Remove** the now-duplicated A2A agent routes + `host-context.ts` from
  `demo-a2a` (architecture purity — one owner). KEEP demo-a2a's wildcard
  `origins.ts` + `ALLOWED_ORIGINS` (`https://*.impact-agent.io`): the Next app's
  `/a2a/*` relayer proxy still forwards the subdomain Origin to demo-a2a.
- On-chain EXECUTION a skill needs (sessions, delegation redeem, UserOps) → the
  a2a-agent calls the demo-a2a relayer backend (cross-origin), same as the broker.

## 4. KV migration (`AUTH_CODES` → Vercel KV)

KV surface in use is tiny: `get(key) → string|null`, `put(key, value,
{expirationTtl})`, `delete(key)`, consumed by (a) the single-use auth-code store
(CN-9) and (b) `src/lib/kv-indexer.ts` `KvLike` (OIDC `facet:` + credential
index). Provide one `vercelKv` adapter implementing that interface over
`@vercel/kv` (`get`/`set(value,{ex})`/`del`). No call-site logic changes — the
broker + indexer already take an injected KV-like port.

## 5. What gets REVERTED (spec 231 Option-2 scaffolding, now dead)

- Delete the planned `apps/subdomain-router/` Worker (never finished).
- Revert `functions/_lib/origin.ts` (`resolveOrigin`) + `PROXY_SHARED_SECRET` on
  the broker `Env` + its uses in `oidc/grant`, `token`, `authorize`,
  `openid-configuration` → back to `new URL(request.url).origin` (real Host on
  Vercel is correct). No shared secret, no issuer-spoofing surface.
- The A2A proxy still injects `X-Agent-Subdomain` + `X-Public-Origin` to demo-a2a,
  but now parses the **real** Host (no forwarding needed).

## 6. Config / secrets (Vercel project)

`BROKER_PRIVATE_JWK`, `BROKER_KID`, `GOOGLE_CLIENT_ID/SECRET`,
`GOOGLE_REDIRECT_URI` (→ `https://<...>/oidc/google/callback`), `DEMO_A2A_URL`,
`RPC_URL`, `KV_*` (Vercel KV). Build-time `VITE_*` → `NEXT_PUBLIC_*` where the
client reads them. `REDIRECT_URI_ALLOWLIST` + demo-org relying-origin allowlists
unchanged (demo-org stays on Pages). Google console: add the Vercel callback +
the wildcard origins.

## 7. Caveats / risks

- **ES256 only** (P-256) — already the broker's alg; Web Crypto on Vercel Node
  supports it. (Same Ed25519-absence rationale as Cloudflare; no change.)
- **Split stack**: demo-a2a on Cloudflare, demo-sso on Vercel — intentional;
  cross-origin calls already CORS-gated (demo-a2a `ALLOWED_ORIGINS` already
  includes `https://*.impact-agent.io`).
- **Cost**: Vercel Pro (~$20/mo) — the price of unbounded wildcard anywhere.
- **Passkey RP** unaffected (host-relative; the browser is on the real subdomain).
- **The broker is IdP-class trust** (connect CLAUDE.md) — port verbatim; the
  alg-pinned, owner-free, code-exchange invariants (CN-1/4/9) MUST survive the
  runtime change. Re-verify after migration.

## 8. Phase plan

- **V1** — Scaffold Next.js App Router in `apps/demo-sso` (or `apps/demo-sso-next`
  during cutover); mount the existing SPA as a client component; Vite→Next build.
- **V2** — Port the broker: `app/_lib/broker.ts` + all Route Handlers (§3); the
  `@vercel/kv` adapter (§4). Port the **a2a-agent surface** native (§3.1:
  `app/_lib/a2a-agent.ts` + the discovery/`/api/a2a` handlers) and remove the
  duplicated A2A routes from demo-a2a. Revert the Option-2 scaffolding (§5).
- **V3** — Vercel project: env/secrets, Vercel KV, deploy to a preview; verify
  sign-in (passkey/SIWE/Google) + `/me` + `/a2a` proxy + the A2A agent-card on a
  preview subdomain.
- **V4** — Add the **wildcard domain** `*.impact-agent.io` (+ apex) on Vercel Pro;
  re-point DNS. **Cloudflare-side the wildcard is DNS-ONLY (grey-cloud)** — allowed
  on the free plan (only *proxied* wildcards need Enterprise); Vercel does the
  wildcard routing + TLS, sidestepping Cloudflare's limit. Verify
  `alice.impact-agent.io` end-to-end (SSO + A2A); retire the Cloudflare Pages
  demo-sso. Exact steps: [`apps/demo-sso-next/DEPLOY.md`](../apps/demo-sso-next/DEPLOY.md).

## 9. Out of scope

- demo-org, demo-web* hosting (stay on Cloudflare).
- The demo-a2a **relayer** (bundler/KMS/Durable Objects/MCP) stays on Cloudflare
  as the execution backend — only its light **A2A agent surface** moves to the
  Next app (§3.1). Migrating the relayer to Vercel is a separate future spec.
- Any change to the auth/authority model (ADR-0014/0016/0017/0019), the OIDC
  protocol (spec 230), or the A2A surface (spec 231) — hosting move only.
