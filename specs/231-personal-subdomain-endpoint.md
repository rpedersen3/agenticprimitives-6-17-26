# Spec 231 — Personal subdomain as a unified SSO + A2A endpoint

Status: IN PROGRESS 2026-05-27 (demo-sso + demo-a2a). Builds on spec 229 (P5,
per-person `<handle>.impact-agent.io` central-auth homes) and spec 230 (the
person-scoped OIDC provider). No protocol change to either — this spec defines
the **A2A surface** that the same personal subdomain exposes.

## 1. Purpose

A person/agent's personal subdomain `<handle>.impact-agent.io` is **one canonical
endpoint** (ADR-0010: the address IS the agent; names/origins are facets pointing
at it) serving two audiences:

- **Humans (SSO)** — the Connect SPA + OIDC provider + ROOT-passkey home (spec
  229/230). RP ID = the subdomain (credential isolation).
- **Agents (A2A)** — `GET /.well-known/agent-card.json` discovery + `POST /api/a2a`
  JSON-RPC, scoped to the agent resolved from the Host subdomain.

The apex `impact-agent.io` is the platform landing + bootstrap origin and serves a
**generic** (non-agent-bound) agent card.

## 2. Reference: patterns to port (agentic-trust `apps/atp-agent`)

Ported from `agentictrustlabs/agentic-trust` `apps/atp-agent/src/worker.ts`
(the caller is `apps/admin`). Deliberate divergences:

| atp-agent | here | why |
| --- | --- | --- |
| `extractSubdomain(host, base)` | `parseAgentSubdomain(host, base)` | same shape; pure, fail-closed, single label only |
| subdomain → `<slug>.8004-agent.eth` via ENS | subdomain → `<label>.demo.agent` via `AgentNamingClient.resolveName` | we use our on-chain AgentNameRegistry, not ENS |
| single Worker does discovery + RPC + skills | demo-sso (Pages) owns the subdomain origin and **proxies** A2A paths to demo-a2a (the Worker) | reuse the existing relayer/session machinery; keep SSO + A2A logic in their owning apps |
| rich skill catalogue (feedback/validation/inbox) | `skills: []` (minimal) | discovery + routing is the substrate; skills are future work |

## 3. Resolution (one mechanism — ADR-0013)

`<label>.impact-agent.io` → name `<label>.demo.agent` → `resolveName` → canonical
Smart Agent address. The label source, in priority order (each a single
mechanism, no fallback chain):

1. `X-Agent-Subdomain` header — injected by the demo-sso Pages proxy after it
   parses its own Host. (`X-Public-Origin` carries the public
   `https://<label>.impact-agent.io` so the card advertises the public URL, not
   the workers.dev origin.)
2. Else the request `Host` parsed against `A2A_PUBLIC_BASE_DOMAIN`
   (default `impact-agent.io`) — for direct workers.dev / local access.

An unresolvable subdomain → `404 agent_not_found`. The apex (no subdomain) →
generic card / `400` on `/api/a2a`.

## 4. Endpoints

Served at `<handle>.impact-agent.io` (demo-sso Pages Functions proxy →
demo-a2a Worker):

- `GET /.well-known/agent-card.json` (+ `/.well-known/agent.json` alias) — an A2A
  v1.0 AgentCard: `{ protocolVersion:'1.0', name, description, version,
  agentAddress, agentName, supportedInterfaces:[{ url:'<origin>/api/a2a',
  protocolBinding:'JSONRPC' }], provider, capabilities, defaultInput/OutputModes,
  skills:[], chainId }`.
- `POST /api/a2a` — JSON-RPC 2.0, scoped to the host's agent. `message/send` →
  `{ agentName, agentAddress, status:'received', message }` ("live routing" —
  confirms the message reached the right agent). Unknown method → `-32601`.
  CSRF-exempt (machine-to-machine; not a browser double-submit flow).

## 5. CSRF / CORS (wildcard origins)

Per-person subdomains are each a distinct browser Origin, so demo-a2a's
exact-match CORS / CSRF / SIWE allowlists gain ONE controlled wildcard form,
`https://*.impact-agent.io`, matching any single-label subdomain (NOT the apex,
NOT nested labels) — `apps/demo-a2a/src/origins.ts` (`originAllowed` /
`hostnameAllowed`, fail-closed). The CSRF HMAC still binds each token to its mint
origin (`connect-auth` `csrfTokenFor`), so widening the allowlist does not enable
forgery. `/api/a2a` is CSRF-exempt (§4).

## 6. Deployment

- demo-sso Pages: wildcard custom domain `*.impact-agent.io`; Functions
  `functions/.well-known/agent-card.json.ts`, `agent.json.ts`,
  `api/a2a/[[path]].ts` (+ `_lib/a2a-proxy.ts`).
- demo-a2a Worker: `ALLOWED_ORIGINS` includes `https://impact-agent.io,
  https://*.impact-agent.io`; `A2A_PUBLIC_BASE_DOMAIN=impact-agent.io`
  (`scripts/deploy-cloudflare.ts`). New: `src/host-context.ts`, `src/origins.ts`,
  routes in `src/index.ts`.

## 7. Out of scope

- A2A skill catalogue + task lifecycle (states, artifacts, streaming).
- Agent-to-agent auth on `/api/a2a` (signatures / sessions) — discovery + routing
  only for now.
- Non-person agents on subdomains beyond what naming already supports.
