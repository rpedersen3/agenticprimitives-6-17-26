# apps/demo-web

Vite + React demo web app. EOA user (mnemonic in localStorage), SIWE login, issues a delegation to the a2a agent, calls MCP tools through the agent.

## Dev

```bash
pnpm dev:web    # starts at http://127.0.0.1:5173
```

Forwards `/a2a/*` to `http://127.0.0.1:8787` so the browser can call the a2a agent without CORS pain.

## Status

UI scaffold present; all three step handlers are TODOs that wire up as the @agenticprimitives/* packages get implemented (per spec 101 priority order):

1. SIWE flow — unblocks once `@agenticprimitives/identity-auth/siwe` + `@agenticprimitives/agent-account` are real
2. Delegation issuance — unblocks once `@agenticprimitives/delegation` is real
3. MCP tool call via agent — unblocks once `@agenticprimitives/mcp-runtime` is real
