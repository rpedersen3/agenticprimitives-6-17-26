# demo-web-recovery — Claude guide

## What this app is

The **credential recovery** demo. It demonstrates [ADR-0011](../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md) end-to-end via the trustee-quorum recovery mode of [spec 221](../../specs/221-credential-recovery.md): Sam loses a passkey credential, Alice + Bob (recovery trustees) co-authorize a custody-policy-governed `CustodyAction.RecoverAccount`, and the new credential is bound to Sam's UNCHANGED canonical Smart Agent.

Headline doctrine the UI must teach:

> **Canonical identity persists. Credentials rotate.**
> Smart Agent address is the identity; passkeys / EOAs / hardware wallets are control credential facets. Recovery is a custody-policy operation, not a delegation.

## What this app owns

- Recovery-specific Vite/React act ladder.
- Reading completed `demo-web-pro` local state as prerequisites.
- Sam Person Smart Agent recovery flow.
- Acme Organization custodian recovery flow.
- UI copy that separates Person recovery from Organization access recovery.

## What this app does not own

- Treasury onboarding story → `apps/demo-web-pro`.
- Contract custody semantics → `packages/contracts` + `specs/207` / `specs/213`.
- Passkey ceremony primitives → `packages/connect-auth`.
- Custody encoding and quorum helpers → `packages/account-custody`.

## Read These First

1. [ADR-0011](../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md) + [spec 221](../../specs/221-credential-recovery.md) — the doctrine the demo embodies.
2. `package.json` — scripts and package deps.
3. `src/App.tsx` — top-level recovery shell + `DoctrineBanner`.
4. `src/acts/` — act ladder.
5. `src/lib/custody-ceremony.ts` — multi-signer ceremony helper.
6. `../../specs/207-smart-account-threshold-policy.md`.

## Validate

```bash
pnpm --filter @agenticprimitives-demo/web-recovery typecheck
pnpm --filter @agenticprimitives-demo/web-recovery build
```

## Generated Files

`dist/`, `node_modules/`, `.vite/`.
