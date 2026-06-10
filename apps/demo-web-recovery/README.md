# demo-web-recovery

**Lose the passkey, keep the identity. Watch the address survive the worst day.**

Every identity system gets judged on its worst day — the day the credential is gone. This demo runs that day end to end on the [agenticprimitives](../../README.md) substrate and proves the doctrine that separates it from key-equals-identity stacks ([ADR-0011](../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md)):

> **Canonical identity persists. Credentials rotate.** The Smart Agent address is the identity; passkeys, EOAs, and hardware wallets are replaceable control facets. Recovery is a custody-policy operation — never a delegation.

## The chain it proves

> Sam loses his passkey → Alice and Bob, his recovery trustees, co-authorize a 2-of-2 custody-policy `RecoverAccount` ceremony → a new credential is bound to Sam's **unchanged** Smart Agent → every name, relationship, and delegation Sam ever issued still resolves and still verifies.

The trustee-quorum mode of [spec 221](../../specs/221-credential-recovery.md), staged as a six-act ladder:

1. **Act 0 — Prerequisites** — reads completed [`demo-web-pro`](../demo-web-pro) state (run that story first)
2. **Act 1 — Sam onboards** as a recovery-capable Person Smart Agent
3. **Act 2 — Declare loss** — the passkey is gone
4. **Act 3 — Replace passkey** — a new WebAuthn credential is created
5. **Act 4 — Recovery** — Alice + Bob co-sign the custody-policy `RecoverAccount` action through the multi-signer ceremony
6. **Act 5 — Verify** — same address, same names, same delegations, new credential

The UI also separates **Person recovery** from **Organization access recovery** — recovering a person's credential and restoring a custodian's access to an org are distinct custody operations, and the copy treats them that way.

What you will not see: a delegation, a third-party multi-sig, or a migration to a new address. Recovery here is enforced by the substrate's own custody-policy module ([spec 207](../../specs/207-smart-account-threshold-policy.md)), which is the third pillar of the system — custody is not authority.

## Packages composed

- [`@agenticprimitives/account-custody`](../../packages/account-custody) — custody-action encoding, quorum helpers, the recovery ceremony
- [`@agenticprimitives/connect-auth`](../../packages/connect-auth) — passkey registration and ceremonies
- [`@agenticprimitives/agent-account`](../../packages/agent-account) — account client against the unchanged Smart Agent
- [`@agenticprimitives/agent-naming`](../../packages/agent-naming) — proof that names still resolve post-recovery
- [`@agenticprimitives/delegation`](../../packages/delegation) — proof that issued delegations survive rotation
- [`@agenticprimitives/types`](../../packages/types) — shared primitives

## Run it

```bash
# Everything (Anvil + contracts + workers + apps), from the repo root:
pnpm dev

# Or just this app:
pnpm --filter @agenticprimitives-demo/web-recovery dev
```

Run the [`demo-web-pro`](../demo-web-pro) acts first — this app reads their completed local state as its prerequisite.

## Status

Reference implementation, not a product. Runs against the deployed custody contracts on Base Sepolia and local Anvil. Production launch of the substrate is gated on the public checklist in the [root README](../../README.md); every security finding is tracked live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).

Validate: `pnpm check:demo-web-recovery`.
