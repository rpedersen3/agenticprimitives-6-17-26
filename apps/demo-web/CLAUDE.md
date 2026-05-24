# demo-web — Claude guide

## What this app is

The simple browser demo: EOA/SIWE-style user flow that issues delegations to
`demo-a2a` and calls the delegated MCP path. Use this for the fast baseline
experience, not the full Treasury Service Agent story.

## What this app owns

- Vite/React UI for the simple delegation path.
- Browser-side wallet connection and demo state.
- Calls into `@agenticprimitives/identity-auth`, `agent-account`, and
  `delegation` as a consumer.

## What this app does not own

- Treasury/Organization/Service Agent story → `apps/demo-web-pro`.
- Recovery story → `apps/demo-web-recovery`.
- A2A session/token minting → `apps/demo-a2a`.
- MCP tool authorization → `apps/demo-mcp`.
- Package primitives → `packages/*`.

## Read These First

1. `package.json` — scripts and package deps.
2. `src/App.tsx` — top-level flow.
3. `src/lib/` — local demo helpers.
4. `../demo-a2a/CLAUDE.md` and `../demo-mcp/CLAUDE.md` if changing calls.

## Validate

```bash
pnpm --filter @agenticprimitives-demo/web typecheck
pnpm --filter @agenticprimitives-demo/web build
```

## Generated Files

`dist/`, `node_modules/`, `.vite/`.
