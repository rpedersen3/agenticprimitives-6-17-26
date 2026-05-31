---
'@agenticprimitives/key-custody': minor
---

R5.12a — Add `createRelayerAccount` for funded relayer chain calls
(PKG-KEY-CUSTODY-009 closure).

### New API

```ts
import {
  buildSignerBackend,
  createRelayerAccount,
} from '@agenticprimitives/key-custody';

const backend = buildSignerBackend({ backend: 'gcp-kms' });
const relayer = await createRelayerAccount(backend, {
  role: 'direct-deploy',
  auditSink,
});

await walletClient.writeContract({ account: relayer, ... });
// emits: key-custody.relay.sign { role: 'direct-deploy', opType: 'transaction', to, value, ... }
```

`createRelayerAccount(backend, opts: CreateRelayerAccountOpts)` returns
a viem `LocalAccount` (drop-in for `privateKeyToAccount(...)`). The
inner KMS account (via `createKmsViemAccount`) handles digest signing
— no key material leaves the HSM. The wrapper additionally emits a
`key-custody.relay.sign` audit row on every sign op tagged with the
caller-supplied `role`.

### Audit event shape

```ts
{
  action:  'key-custody.relay.sign',
  outcome: 'success',
  actor:   { type: 'system', id: '<role>' },
  subject: { type: 'message' | 'transaction' | 'typed-data', id: '<digestFingerprint>' },
  context: {
    role:              '<role>',
    signerAddress:     '<0x... KMS-backed addr>',
    opType:            'message' | 'transaction' | 'typed-data',
    to:                '<tx target>' | null,
    value:             '<wei as decimal string>' | null,
    digestFingerprint: '0x + 16 hex chars (9 bytes of keccak)',
  },
}
```

Fail-soft: audit sink throws don't break the relay flow. Wrap with
`composeFailHardSinks` from `@agenticprimitives/audit` for
fail-hard semantics.

### Why

External P0-style finding from the demo-a2a doctrine review: there
was no documented "use me for funded relayer ops" entry point in
`key-custody`. Apps reached for `privateKeyToAccount(env.X_PRIVATE_KEY)`,
tripping `check:no-app-private-keys` and emitting zero audit
context tagged by operator role. `createRelayerAccount` IS the
convention.

### New exports

- `createRelayerAccount` (main + `/relayer` subpath)
- `CreateRelayerAccountOpts` type
- Also re-exposes `createKmsViemAccount` from the main index for
  discoverability (previously available only via `/kms-viem`
  subpath)

### Docs

- New `docs/relayer.md` explains when to reach for
  `createRelayerAccount` vs `createKmsViemAccount`, the role
  taxonomy convention, and the migration path.

### Tests

13 new R5.12a tests in `test/unit/relayer-account.test.ts`:
- address + source tag (`'kms-relayer'`)
- delegates signMessage / signTransaction / signTypedData to inner
- audit emit shape per op-type (`message` / `transaction` / `typed-data`)
- audit context: role, signerAddress, to, value, digestFingerprint
- value `bigint` → decimal string (JSON-safe)
- digestFingerprint is 18-char hashed prefix (never raw digest)
- fail-soft (throwing audit sink doesn't propagate)
- no-sink path works
- role in BOTH actor.id and context.role
- deterministic signing (audit emission is additive)
- transaction value omitted → recorded as `'0'`

94/94 key-custody tests pass (was 81; +13 R5.12a).

### Companion work (separate PRs)

- **R5.12b** — `createSpendCappedAccount` for funding-only signers
  (rejects `value > capWei` BEFORE the KMS round-trip)
- **R5.12c** — `assertSaMatchesCustodianDerivation` in `agent-account`
  for sponsored-deploy gates
- **R5.12d** — demo-a2a migrates 4 `privateKeyToAccount(DEPLOYER_PRIVATE_KEY)`
  callsites onto the new pattern
