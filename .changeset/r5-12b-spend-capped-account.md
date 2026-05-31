---
'@agenticprimitives/key-custody': minor
---

R5.12b — Add `createSpendCappedAccount` for per-tx ETH-capped relayers
(PKG-KEY-CUSTODY-010 closure).

### New API

```ts
import {
  createRelayerAccount,
  createSpendCappedAccount,
  SpendCapExceededError,
} from '@agenticprimitives/key-custody';

const inner = await createRelayerAccount(backend, {
  role: 'paymaster-topup',
  auditSink,
});
const capped = createSpendCappedAccount(inner, {
  capWei: 10n ** 17n, // 0.1 ETH per tx
  auditSink,
});

// Under cap → signs normally; emits key-custody.relay.sign from inner
await walletClient.sendTransaction({ account: capped, to, value: 5n * 10n ** 16n });

// Over cap → throws SpendCapExceededError BEFORE any HSM call;
// emits key-custody.relay.spend-cap.reject from the cap wrapper
await walletClient.sendTransaction({ account: capped, to, value: 10n ** 18n });
```

### Why

External P0-style finding from the demo-a2a doctrine review: a funded
relayer / operator key (paymaster top-up) had no signing-time gate
against draining the worker balance in one tx. The cap was only
enforceable operationally: monitor balance, hope to catch a drain
in time, rotate keys after the fact. A compromised app process
holding the signer could drain the entire balance in one shot.

`createSpendCappedAccount` is a stateless pre-signing gate:
`value > capWei` → throws `SpendCapExceededError` BEFORE any HSM
round-trip. The HSM never even sees the digest.

### Behaviour

- `value < capWei` → pass
- `value === capWei` → pass (boundary, not violation)
- `value > capWei` → reject + audit `denied`
- `value === undefined / null` → treated as `0n` → pass
- `value` as `number` / `string` → normalised to `bigint`
- Unknown value shape → treated as `MAX_UINT256` → reject (fail-closed)
- `capWei === 0n` → blocks ALL positive-value txs while allowing
  zero-value contract writes
- `capWei < 0n` → throws at construction
- `signMessage` / `signTypedData` → forwarded verbatim (no on-chain
  value to cap)
- Audit emission ONLY on reject; success path stays silent (inner
  relayer's `key-custody.relay.sign` carries the success)
- Fail-soft audit: sink throws do NOT swallow the
  `SpendCapExceededError`

### Composition

`createSpendCappedAccount(createRelayerAccount(backend, ...), { capWei })`
is the canonical funding-signer pattern. The cap is the *outer* gate;
the relayer's KMS+audit is the *inner* signer.

### Audit event shape (reject only)

```ts
{
  action:  'key-custody.relay.spend-cap.reject',
  outcome: 'denied',
  actor:   { type: 'system', id: '<signerAddress>' },
  subject: { type: 'transaction', id: '<tx target>' },
  context: { signerAddress, to, capWei, requestedValue },
}
```

### New exports

- `createSpendCappedAccount` (main index + new `/spend-cap` subpath)
- `SpendCapExceededError` class
- `CreateSpendCappedAccountOpts` type

### What this is NOT

- Not a rolling spend budget (per-tx only; cumulative tracking
  belongs at substrate / operational layer)
- Not calldata-aware (a `transfer(...)` ERC-20 call has
  `transaction.value == 0`; ERC-20 balance limits belong on the
  contract)
- Not a rate limiter (HTTP layer / substrate concern)

### Docs

New `packages/key-custody/docs/spend-capped.md` covers composition,
boundary semantics, value normalisation, and the non-goals.

### Tests

22 new R5.12b tests in `test/unit/spend-capped-account.test.ts`:
- construction: negative cap rejected, cap=0 accepted, source tag
- value gate: under/at/over cap, off-by-one above cap
- error message identifies cap / requested / target / signer
- value normalisation: undefined / number / string / bigint
- cap=0 blocks positive value, passes zero value
- signMessage / signTypedData pass-through (no cap applies)
- audit emit only on reject; success path silent
- fail-soft (throwing sink doesn't swallow error)
- no-sink path works
- HSM never called on cap reject (vi.spyOn verification)
- HSM called once when under cap

103/103 key-custody tests pass (was 81; +22 R5.12b).

### Companion

This is the funding-signer companion to **R5.12a** (`createRelayerAccount`).
Together they're the package-level fix for the demo-a2a
`DEPLOYER_PRIVATE_KEY` doctrine red. **R5.12c** (`assertSaMatchesCustodianDerivation`)
and **R5.12d** (demo-a2a migration) complete the wave.
