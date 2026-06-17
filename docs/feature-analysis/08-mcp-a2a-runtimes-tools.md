# 08 — MCP, A2A, agent runtimes & tool authorization

**Focus area:** agent ↔ tool ↔ agent protocols (MCP, A2A), agent runtimes/frameworks, skills distribution, and authorization of tool access.
**AP packages in scope:** `mcp-runtime`, `tool-policy`, `identity-auth`, `delegation` (token verification), apps `demo-mcp`, `demo-a2a`.
**AP capability today:** MCP server runtime with delegation-token-gated tools (JTI replay protection, leaf binding, caveat checks); A2A agent with HSM-backed signing; tool-policy as transport-agnostic policy core; audit evidence per tool call (demo-mcp audit guide).
**This is AP's differentiation layer** — the place where on-chain authority becomes enforceable tool access. Almost nothing in the market does this.

> Gap layers: `[Contracts]` Solidity surface · `[SDK]` TS packages/backends · `[UX]` product surface (**deferred**). See [index](index.md#gap-layers-every-gap-is-classified-into-exactly-one).

---

## Category verdict at a glance

| Product | Type | Tags | Verdict |
| --- | --- | --- | --- |
| MCP spec + Authorization (OAuth 2.1) + MCP Registry | Open standard (Anthropic-led) | MCP AUTH POLICY | **Conform + extend** (table stakes) |
| Google A2A protocol (Agent2Agent, Linux Foundation) | Open standard | DIR MCP AUTH | **Conform** (agent cards, task lifecycle) |
| **Agent skills ecosystem** (Anthropic skills, Vercel `skills.sh`, MetaMask agent-skills) | OSS distribution channel | MCP SDK | **Adopt immediately** (distribution) |
| OpenAI Agents SDK / AgentKit | Commercial + OSS | MCP POLICY | Track + interop |
| LangChain / LangGraph | OSS + commercial | MCP POLICY AUDIT | Integrate (adapter) |
| Vercel AI SDK | OSS | MCP SDK | Integrate (adapter) |
| Cloudflare Agents SDK / Durable Objects | Commercial + OSS | MCP VAULT | Integrate option (hosting substrate) |
| Composio | Commercial | MCP AUTH POLICY | **Compete-adjacent** (tool-auth platform) |
| Arcade.dev | Commercial | MCP AUTH POLICY | **Compete-adjacent** (tool-auth + token vault) |
| OpenClaw / open-source agent wave | OSS | MCP SDK | Track + target (skills consumers) |
| E2B / Daytona sandboxes | Commercial + OSS | MCP VAULT | Track (execution isolation) |

---

## Deep dives — primary overlap products

### MCP spec + Authorization + Registry — conform + extend

- **Feature inventory:** tools/resources/prompts; OAuth 2.1-based authorization spec (resource servers, protected-resource metadata, dynamic client registration); official MCP Registry for server discovery; SDKs in every major language; elicitation, sampling, structured output.
- **Overlap with AP:** `mcp-runtime` is an MCP server runtime; AP layers delegation tokens on top of MCP transport.
- **AP lacks:**
  - `[SDK]` full MCP Authorization-spec conformance (OAuth protected-resource metadata + token validation) so standard MCP clients can reach AP servers without custom glue; MCP Registry publication of AP servers; sampling/elicitation support in the runtime.
- **MCP spec lacks:** any notion of *delegated, caveat-scoped, cryptographically-verifiable* authority — its auth model is OAuth scopes. No identity anchor, no on-chain redemption, no field-level vault/key-release audit binding. The vault-first extension is in [doc 13](13-agentic-delegated-vault.md) and [spec 277](../../specs/277-mcp-delegated-vault-authorization.md).
- **Verdict:** conform on public HTTP MCP ingress. Do not let OAuth become the sensitive-data authority model; it should resolve into Agentic delegation/entitlement/vault authorization.

### Google A2A protocol — conform

- **Feature inventory:** agent cards (`/.well-known/agent-card.json`), task lifecycle, server-sent streaming, push notifications, multiple auth schemes; Linux Foundation governance; adopted by major vendors.
- **Overlap with AP:** `demo-a2a` already speaks A2A with HSM-signed messages; agent cards ≈ AP profile facets.
- **AP lacks:**
  - `[SDK]` published AP agent-card extension schema (declaring delegation/custody/attestation capabilities in the card); A2A task-lifecycle conformance tests; signed agent-card verification path (card ↔ SA address binding, see doc 12).
- **A2A lacks:** verifiable identity behind cards (anyone can host a card); delegation semantics; payment/treasury hooks.
- **Verdict:** conform on transport, extend with identity-bound cards (ties into ERC-8004/ANS — doc 12).

### Agent skills ecosystem — adopt immediately

- **Identity:** SKILL.md-format capability packs installable into Claude Code, Cursor, Codex, OpenClaw, etc.; Vercel's `skills.sh` registry (`npx skills add owner/repo`); Anthropic's skills spec; MetaMask `agent-skills` as the wallet-category exemplar (see doc 02).
- **Why it matters:** skills are the new zero-integration distribution channel — a GitHub repo IS the integration. The open-source agentic wave (OpenClaw and peers) consumes capabilities this way.
- **AP lacks:**
  - `[SDK]` an `agenticprimitives/agent-skills` repo: skills that teach any framework agent to drive AP — deploy a Smart Agent, resolve `.agent` names, request/redeem delegations, call AP MCP tools, query attestations; an AP CLI with structured-JSON output for the skills to call (shared gap with doc 02 FG-SDK-1).
- **Verdict:** adopt immediately — highest-leverage, lowest-cost distribution move in the whole analysis.

### Composio / Arcade.dev — compete-adjacent

- **Feature inventory:** managed tool catalogs (hundreds of SaaS integrations), per-user OAuth token vaults, tool-level permission scoping, agent-framework adapters, audit logs of tool calls.
- **Overlap with AP:** this is the closest *commercial* analog to `mcp-runtime` + `tool-policy` — they authorize agent tool access; AP authorizes it cryptographically.
- **AP lacks:**
  - `[SDK]` breadth of tool catalog + managed OAuth token vault for third-party SaaS (AP gates its own tools; it has no story for "agent needs scoped access to Gmail/GitHub/Slack"); per-user connected-account management.
- **They lack:** cryptographic delegation (grants are DB rows + OAuth tokens); identity anchor; on-chain redemption; consent provenance.
- **Verdict:** compete-adjacent. Consider a `tool-policy` adapter that wraps external OAuth-vault providers while AP supplies the authority layer.

### LangChain/LangGraph, Vercel AI SDK, OpenAI Agents SDK — integrate (adapters)

- **Overlap with AP:** these are where agents are *built*; AP must be consumable from them. `tool-policy` is transport-agnostic by design (no framework imports) — the adapter layer is app-side.
- **AP lacks:**
  - `[SDK]` framework adapter packages (`@agenticprimitives/langchain`, `/ai-sdk`, `/openai-agents`) exposing AP-gated tools as native tool objects; guardrail/middleware integration (LangGraph interrupts, AI SDK middleware) that surfaces AP policy denials as structured agent feedback.
- **Verdict:** integrate via thin adapters; do not absorb framework semantics into core packages (boundary doctrine).

---

## Compact entries

| Product | Overlap with AP | AP lacks (layer) | Verdict |
| --- | --- | --- | --- |
| Cloudflare Agents SDK / DO | Agent hosting + state | `[SDK]` first-class deploy target docs/templates for AP agents | Integrate option |
| OpenAI AgentKit | Agent builder + connector registry | `[SDK]` connector-registry presence | Track |
| OpenClaw + OSS agent wave | Skills consumers | `[SDK]` skills packs targeting them (see above) | Target |
| E2B / Daytona | Sandboxed execution | `[SDK]` sandboxed tool-execution recipe | Track |

---

## Focus-area gap rollup — by layer

### `[Contracts]` gaps — active

*None.* This layer is deliberately off-chain; on-chain hooks (delegation redemption, attestation) already exist.

### `[SDK]` / package gaps — active

| Gap | Evidence | Roadmap ID | Priority |
| --- | --- | --- | --- |
| **AP agent-skills repo + AP CLI (structured JSON)** | MetaMask agent-skills, skills.sh | FG-SDK-1 | **P1 (elevated)** |
| MCP Authorization-spec (OAuth 2.1) conformance + Registry publication | MCP spec | FG-MCP-1 | P2 (after delegated vault P1; see doc 13) |
| Delegated-authority profile for MCP (spec + reference impl) | MCP spec gap | FG-MCP-2 | P2 (vault authority is P1 in doc 13) |
| A2A agent-card extension schema + card↔SA binding verification | A2A, ERC-8004 | FG-MCP-3 | P1 |
| Framework adapters (LangChain/LangGraph, AI SDK, OpenAI Agents) | LangChain, Vercel | FG-MCP-4 | P2 |
| External OAuth token-vault adapter for third-party SaaS tools | Composio, Arcade | FG-MCP-5 | P2 |

### `[UX]` gaps — **deferred (recorded, not current focus)**

| Gap | Evidence |
| --- | --- |
| Tool-connection management console (connected accounts, grants) | Composio, Arcade |

**Substrate advantages to preserve:** delegation-token-gated MCP tools with JTI replay + leaf binding (unique in market); HSM-signed A2A; transport-agnostic `tool-policy`; per-call audit evidence. The market authorizes tools with OAuth rows; AP authorizes them with verifiable, caveat-scoped, identity-anchored grants.
