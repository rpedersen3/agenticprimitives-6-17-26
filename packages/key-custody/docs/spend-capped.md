# Spend-capped relayer pattern (R5.12b / PKG-KEY-CUSTODY-010)

> **TL;DR — for a funded signer that should send AT MOST `capWei` per
> tx, wrap your relayer with `createSpendCappedAccount(inner, { capWei,
> auditSink })`. The cap fails CLOSED before any HSM round-trip.**

## When to use this

You have a relayer account (e.g. from `createRelayerAccount`) that
LEGITIMATELY needs to send ETH on chain — typically a paymaster
top-up signer that refills the EntryPoint deposit. The signer should
be able to send small operational amounts but **must not** be able
to drain the worker balance in one tx.

The cap is a defense against **a compromised app process** (worker
RCE, leaked KMS auth token, etc.) holding the wrapped account. Even
if the attacker controls the process, the wrapper rejects any
`signTransaction` request whose value exceeds the cap *before the
HSM is asked to sign*.

## What this is NOT

- **Not a rolling spend budget.** The cap is per-transaction. A
  compromised process could still issue many transactions at the
  cap, draining the balance over time. A rolling-budget tracker
  belongs at the substrate / operational layer (sticky state across
  process restarts, monitor with backstop), not in a stateless
  signer wrapper.
- **Not calldata-aware.** A `transfer(address, uint256)` call that
  moves ERC-20 tokens internally has `transaction.value == 0` — the
  cap doesn't see it. The cap is on the **ETH value the account
  itself sends**. Token-balance limits belong on the contract.
- **Not a rate limiter.** No per-second / per-minute throttle. The
  app's HTTP layer or substrate is the right place for that.

## Composition with `createRelayerAccount`

```ts
import {
  buildSignerBackend,
  createRelayerAccount,
  createSpendCappedAccount,
} from '@agenticprimitives/key-custody';

const backend = buildSignerBackend({
  backend: env.PAYMASTER_TOPUP_KMS_BACKEND,
});

// Layer 1: KMS-backed account + audit emit tagged by role
const inner = await createRelayerAccount(backend, {
  role: 'paymaster-topup',
  auditSink,
});

// Layer 2: per-tx ETH cap (0.1 ETH)
const capped = createSpendCappedAccount(inner, {
  capWei: 10n ** 17n,
  auditSink,
});

await walletClient.sendTransaction({
  account: capped,
  to: entryPointAddress,
  value: 5n * 10n ** 16n, // 0.05 ETH — OK
});

// This throws SpendCapExceededError BEFORE any HSM call:
await walletClient.sendTransaction({
  account: capped,
  to: entryPointAddress,
  value: 10n ** 18n, // 1 ETH — over cap
});
```

Order matters: `createSpendCappedAccount` wraps `createRelayerAccount`
(not the other way round). The cap is the *outer* gate; the relayer's
KMS+audit is the *inner* signer. A rejected tx never reaches the
relayer, so no `key-custody.relay.sign` event is emitted — only the
`key-custody.relay.spend-cap.reject` from the outer cap.

## Audit event shape (reject only)

```ts
{
  action:  'key-custody.relay.spend-cap.reject',
  outcome: 'denied',
  actor:   { type: 'system', id: '<signerAddress>' },
  subject: { type: 'transaction', id: '<tx target>' },
  context: {
    signerAddress:  '<inner.address>',
    to:             '<tx target>' | null,
    capWei:         '<decimal string>',
    requestedValue: '<decimal string>',
  },
}
```

The wrapper emits ONLY on reject. Successful signings produce no
audit row from the cap wrapper — that's the inner `createRelayerAccount`'s
job (`key-custody.relay.sign` event with the full op context). This
keeps the two events at distinct outcomes (`denied` vs `success`)
and doesn't duplicate the success path.

Fail-soft on audit emission: if the sink throws, the
`SpendCapExceededError` still propagates. Cap enforcement is the
load-bearing invariant; audit is the forensic trail.

## Cap of `0n` is meaningful

```ts
createSpendCappedAccount(inner, { capWei: 0n })
```

Blocks **all positive-value txs** while still permitting:
- contract writes that send no ETH (e.g. `register(label, owner)`)
- zero-value calls to any target

Useful for a signer that should be allowed to call contracts but
should never natively send ETH (e.g. an operator key with no
balance-funding duty).

## Boundary semantics

- `value < capWei` → pass
- `value === capWei` → pass (boundary is not a violation)
- `value > capWei` → reject

## Value normalisation

viem accepts `value` as `bigint` (canonical), `number`, or `string`.
The wrapper normalises all three to `bigint` before comparing.
`undefined` / `null` → `0n`. Any other shape (defensive) is treated
as `MAX_UINT256` (so the cap reliably rejects unknown shapes).

## Not for SIGNATURE-only KMS keys

`createKmsAccount` (NOT `createKmsViemAccount`) returns a `Signer`
interface, not a viem `LocalAccount`. The cap wrapper only applies
to `LocalAccount` — for the connect-auth `Signer` shape, there is no
on-chain value to cap.

## See also

- `docs/relayer.md` — the relayer pattern (R5.12a)
- Audit doc: `PKG-KEY-CUSTODY-010`
- Spec: `specs/203-key-custody.md` § Spend-capped accounts (R5.12b)
