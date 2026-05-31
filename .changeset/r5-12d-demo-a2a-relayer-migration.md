---
'@agenticprimitives-demo/a2a': patch
---

R5.12d — Migrate demo-a2a's 4 `privateKeyToAccount(DEPLOYER_PRIVATE_KEY)`
callsites onto the relayer-pattern package primitives (R5.12a+b+c).

### What changed in demo-a2a

- New `apps/demo-a2a/src/relayer.ts` factory module:
  - `getRelayerAccount(env, role, sink)` → KMS-backed viem `LocalAccount`
    via `createRelayerAccount` from `@agenticprimitives/key-custody`.
    `A2A_KMS_BACKEND` env var picks the backend (same as the UserOp
    relayer already uses).
  - `getPaymasterTopupAccount(env, sink)` → spend-capped variant
    composing `createRelayerAccount({ role: 'paymaster-topup' })` with
    `createSpendCappedAccount({ capWei: PAYMASTER_TOPUP_CAP_WEI })`
    (default 0.002 ETH). The cap rejects oversize tx values BEFORE the
    HSM round-trip.

- 4 callsites migrated:
  1. `POST /session/direct-deploy` — uses
     `getRelayerAccount(env, 'direct-deploy')` AND gates the
     client-supplied `body.smartAccountAddress` with
     `assertSaMatchesCustodianDerivation` (R5.12c).
  2. `POST /session/register-name` —
     `getRelayerAccount(env, 'register-name')`.
  3. `POST /session/custody-{schedule,apply}` —
     `getRelayerAccount(env, 'custody-relay')` via a refactored
     `relayDeployer(env, sink)` helper.
  4. `POST /admin/topup-paymaster` — `getPaymasterTopupAccount(env)`.

- `DEPLOYER_PRIVATE_KEY` field REMOVED from the `Env` interface. The
  env var is no longer read anywhere.

- New `PAYMASTER_TOPUP_CAP_WEI` field on `Env` for the per-tx ETH cap
  (default 0.002 ETH when unset).

- Bonus cleanup: line 986's pre-existing `verifyUserSignature` typecheck
  drift fixed — the callback maps the typed result to `boolean` for
  `siweVerifyOnchain`.

### Operational impact

- **`pnpm check:no-app-private-keys` is GREEN.** The chronic CI red
  that's been on master since the check was promoted is finally closed
  — with a real fix, not a doctrine suppression.
- **Testnet:** keeps running on `local-aes` backend (the same path the
  UserOp relayer uses). `A2A_MASTER_PRIVATE_KEY` is the funded address
  — set it to your old `DEPLOYER_PRIVATE_KEY` value if you want the
  same on-chain address to keep paying gas, or fund a new address.
- **Production:** set `A2A_KMS_BACKEND=gcp-kms` + the standard GCP KMS
  env. No raw key material in process memory.
- **Drain protection:** the paymaster top-up signer is now wrapped in
  `createSpendCappedAccount`. A compromised app process holding the
  account cannot exceed `PAYMASTER_TOPUP_CAP_WEI` per tx. The cap
  rejection happens BEFORE the HSM is asked to sign — proven by the
  R5.12b tests.

### Identity-vs-relayer

None of the 4 routes use the relayer as the IDENTITY-BEARING signer:

| Route | Authority | Relayer role |
|---|---|---|
| `/session/direct-deploy` | SIWE-verified wallet (gated via `assertSaMatchesCustodianDerivation`) | gas-only |
| `/session/register-name` | PermissionlessSubregistry's anyone-can-call `register(label, owner)` | gas-only |
| `/session/custody-{schedule,apply}` | Custody-quorum sigs over EIP-712 hash (`msg.sender` unchecked) | gas-only |
| `/admin/topup-paymaster` | Paymaster owner (the relayer's KMS-backed address) | spend-capped sender |

### Tests

No new tests in this PR — the 13 R5.12a + 22 R5.12b + 8 R5.12c
package-level tests already cover the primitive contracts. demo-a2a's
existing typecheck + `pnpm check:no-app-private-keys` cover the
migration.

### Audit doc

PKG-KEY-CUSTODY-009's "Companion follow-ups" footer updated to mark
R5.12d closed.
