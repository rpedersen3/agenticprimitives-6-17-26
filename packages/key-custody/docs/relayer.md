# Relayer-account pattern (R5.12a / PKG-KEY-CUSTODY-005)

> **TL;DR — for funded chain calls in app code, use `createRelayerAccount(backend, { role, auditSink })`, not `privateKeyToAccount(env.X_PRIVATE_KEY)`.**

## When to use this

You're writing a Cloudflare Worker / Node service that pays gas for
on-chain operations on behalf of users. Common cases:

| Operation | Conventional `role` tag |
| --- | --- |
| Direct AgentAccount deploy from the factory | `direct-deploy` |
| Sponsored `register()` on a permissionless subregistry | `register-name` |
| Submitting `CustodyPolicy.{schedule,apply,cancel}` after quorum sigs | `custody-relay` |
| ERC-4337 EntryPoint paymaster top-up | `paymaster-topup` |
| Bundler signer for paymaster validation envelopes | `paymaster-verify` |

All of these are **gas-paying** ops, not **identity-bearing** ops.
The on-chain contracts authorize the operation via signatures + state
that ALREADY validate without trusting `msg.sender`. The relayer's
only job is to pay gas.

## What's wrong with `privateKeyToAccount`

```ts
// WRONG (pre-R5.12a)
const deployer = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY);
await walletClient.writeContract({ account: deployer, ... });
```

Two recurring problems:

1. **Raw key in app config.** `*_PRIVATE_KEY` env vars in apps trip
   the `check:no-app-private-keys` doctrine check, force operators to
   manage raw key material, and ALWAYS get worse than KMS. The
   `check:no-app-private-keys` script names the fix:
   `buildSignerBackend({ backend: 'gcp-kms' })`
   + `createKmsViemAccount(backend)`.
2. **No audit trail tagged by operator role.** Every relayed tx is
   forensically indistinguishable; you can't tell from logs whether a
   given chain call paid gas for a direct deploy or a paymaster
   top-up.

## The fix

```ts
// RIGHT (R5.12a)
import { buildSignerBackend, createRelayerAccount } from '@agenticprimitives/key-custody';

const backend = buildSignerBackend({ backend: env.RELAYER_KMS_BACKEND });
const relayer = await createRelayerAccount(backend, {
  role: 'direct-deploy',
  auditSink,
});
await walletClient.writeContract({ account: relayer, ... });
```

`createRelayerAccount` returns a viem `LocalAccount`
(drop-in for any place a `privateKeyToAccount(...)` account fit), but
every sign op also emits a `key-custody.relay.sign` audit row tagged
with the `role`. The HMAC/ECDSA digest is signed by the HSM; no key
material leaves KMS.

## Audit event shape

```ts
{
  action: 'key-custody.relay.sign',
  outcome: 'success',
  actor:   { type: 'system', id: '<role>' },
  subject: { type: 'message' | 'transaction' | 'typed-data', id: '<digestFingerprint>' },
  context: {
    role:              '<role>',
    signerAddress:     '<0x... KMS-backed address>',
    opType:            'message' | 'transaction' | 'typed-data',
    to:                '<0x... target>' | null,         // transaction only
    value:             '<wei as decimal string>' | null, // transaction only
    digestFingerprint: '<0x + 16 hex chars (9 bytes of keccak)>',
  },
}
```

The `digestFingerprint` is `keccak256(digest).slice(0, 18)` — never
the digest itself. That's enough to disambiguate two signing ops in
the same second without leaking the signed material.

## Role taxonomy

The package intentionally does NOT enumerate `role` values. Apps
choose their own taxonomy and document it in their own
`RELAYER.md` / `CLAUDE.md`. Recommended convention:
`<surface>-<operation>` (e.g. `direct-deploy`, `register-name`).

You can split roles across multiple KMS keys for blast-radius
containment:

```
RELAYER_KMS_KEY          # direct-deploy + register-name + custody-relay
PAYMASTER_TOPUP_KMS_KEY  # funding only (wrap in createSpendCappedAccount)
PAYMASTER_VERIFY_KMS_KEY # paymaster envelope signatures
```

`createSpendCappedAccount` (R5.12b) is the recommended companion for
funding-only signers — see `docs/spend-capped.md`.

## Fail-soft audit emission

If the supplied `auditSink.write` throws, the relayer's sign op still
succeeds. A logging outage cannot break the relay flow.

For fail-hard semantics (require the audit row to land OR refuse to
sign), wrap the supplied sink with `composeFailHardSinks` from
`@agenticprimitives/audit`. The relayer factory itself is
fail-soft by default — that's the appropriate posture for
"send this transaction or the user gets a 500" code paths.

## Not a replacement for `createKmsViemAccount`

`createKmsViemAccount(backend)` remains the right factory for:

- Bundler / UserOp signers (where the audit row is emitted by
  `agent-account.submitCallUserOp` already)
- One-off signing in test code where audit emission is noise
- Cases where the caller already controls the audit emission shape

The `createRelayerAccount` factory is the **app-level relayer**
idiom: app authors instantiate this once per role at startup, then
reach for the resulting `LocalAccount` for every funded chain call.

## Spec / migration index

- Spec: `specs/203-key-custody.md` § Relayer pattern (R5.12a)
- Migration: `docs/audits/2026-05-packages-contracts-production-readiness.md` — search `PKG-KEY-CUSTODY-005`
- Companion: `docs/spend-capped.md` (R5.12b — `createSpendCappedAccount`)
- App example: `apps/demo-a2a/CLAUDE.md` (when R5.12d migrates the 4 callsites)
