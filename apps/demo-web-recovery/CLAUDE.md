# demo-web-recovery — Claude guide

## What this app is

The recovery demo: assumes `demo-web-pro` has already created Alice, Bob, Acme,
and Treasury state. It adds Sam, simulates passkey loss, and demonstrates
custody-level recovery.

## What this app owns

- Recovery-specific Vite/React act ladder.
- Reading completed `demo-web-pro` local state as prerequisites.
- Sam Person Smart Agent recovery flow.
- Acme Organization custodian recovery flow.
- UI copy that separates Person recovery from Organization access recovery.

## What this app does not own

- Treasury onboarding story → `apps/demo-web-pro`.
- Contract custody semantics → `apps/contracts` + `specs/207` / `specs/213`.
- Passkey ceremony primitives → `packages/identity-auth`.
- Custody encoding and quorum helpers → `packages/custody`.

## Read These First

1. `package.json` — scripts and package deps.
2. `src/App.tsx` — top-level recovery shell.
3. `src/acts/` — act ladder.
4. `src/lib/custody-ceremony.ts` — multi-signer ceremony helper.
5. `../../specs/207-smart-account-threshold-policy.md`.

## Validate

```bash
pnpm --filter @agenticprimitives-demo/web-recovery typecheck
pnpm --filter @agenticprimitives-demo/web-recovery build
```

## Generated Files

`dist/`, `node_modules/`, `.vite/`.
