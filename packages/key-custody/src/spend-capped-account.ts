// createSpendCappedAccount — wrap any viem LocalAccount with a per-tx
// ETH-value cap that fails CLOSED before any signing round-trip.
//
// R5.12b / PKG-KEY-CUSTODY-010 (relayer-pattern gap, follow-on to R5.12a).
//
// Use case:
//   You're running a funded operator key — say the paymaster top-up key
//   — that legitimately needs to send ETH on chain. The key is meant
//   to send AT MOST `capWei` per transaction. A compromised app
//   process holding this account should not be able to drain funds in
//   one shot.
//
//   Pre-R5.12b, the only way to enforce this was operationally:
//   monitor the on-chain balance, hope the operator catches a drain
//   in time, rotate keys after the fact. The cap was unenforceable
//   at signing time.
//
//   Post-R5.12b, `createSpendCappedAccount(inner, { capWei })`
//   wraps any viem LocalAccount and inspects `transaction.value` in
//   `signTransaction`. If `value > capWei`, throws a
//   `SpendCapExceededError` BEFORE the KMS round-trip — the HSM
//   never even sees the digest.
//
// What it does NOT do:
//   - Track cumulative spend across calls (the cap is per-tx, not a
//     rolling budget). A cumulative tracker is operational state
//     (sticky across processes / restarts), which belongs at the
//     app or substrate layer, not in a stateless signer wrapper.
//   - Inspect calldata (no introspection of internal ETH transfers
//     a contract call might perform). The cap is on the value the
//     account itself sends; downstream contract behavior is the
//     contract's contract.
//
// Composition:
//   Designed to compose with `createRelayerAccount` (R5.12a):
//
//     const inner = await createRelayerAccount(backend, {
//       role: 'paymaster-topup',
//       auditSink,
//     });
//     const capped = createSpendCappedAccount(inner, {
//       capWei: 10n ** 17n, // 0.1 ETH per tx
//       auditSink,
//     });
//
//   When a tx is rejected, the cap wrapper emits its own
//   `key-custody.relay.spend-cap.reject` event so the relayer's
//   `key-custody.relay.sign.success` and the cap's reject are both
//   in the audit trail with matching `signerAddress`.

import {
  type Hex,
  type LocalAccount,
  type SignableMessage,
} from 'viem';
import { buildEvent, type AuditSink } from '@agenticprimitives/audit';

export interface CreateSpendCappedAccountOpts {
  /**
   * Maximum ETH value (in wei) this account is allowed to send PER
   * TRANSACTION. A `signTransaction` request with `value > capWei`
   * is rejected with {@link SpendCapExceededError} before any signing
   * round-trip.
   *
   * `0n` is permitted and meaningful — it blocks ALL value-transferring
   * txs while still allowing contract writes that don't send ETH.
   * Useful for a signer that can call `register(...)` but cannot
   * `transfer(...)` natively.
   */
  capWei: bigint;
  /**
   * Where to write `key-custody.relay.spend-cap.reject` events. Omit
   * only for tests; production deploys SHOULD wire a durable sink so
   * cap rejections leave a forensic trail (operators will want to
   * detect the request pattern that triggered the reject).
   */
  auditSink?: AuditSink;
}

/**
 * Thrown by a spend-capped account's `signTransaction` when the
 * requested `value` exceeds the configured `capWei`. The HSM is
 * never asked to sign — this is a pre-signing fail-closed gate.
 */
export class SpendCapExceededError extends Error {
  readonly capWei: bigint;
  readonly requestedValue: bigint;
  readonly to: Hex | null;
  readonly signerAddress: Hex;

  constructor(opts: {
    capWei: bigint;
    requestedValue: bigint;
    to: Hex | null;
    signerAddress: Hex;
  }) {
    super(
      `[key-custody] spend cap exceeded: requested ${opts.requestedValue.toString()} wei to ${
        opts.to ?? '<no target>'
      }, cap is ${opts.capWei.toString()} wei (signer ${opts.signerAddress})`,
    );
    this.name = 'SpendCapExceededError';
    this.capWei = opts.capWei;
    this.requestedValue = opts.requestedValue;
    this.to = opts.to;
    this.signerAddress = opts.signerAddress;
  }
}

function readTxValue(tx: { value?: unknown }): bigint {
  // viem accepts bigint (canonical), number, string. Normalise to bigint;
  // undefined / null → 0n.
  const v = tx.value;
  if (v === undefined || v === null) return 0n;
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(v);
  if (typeof v === 'string') return BigInt(v);
  // Defensive: any other shape is treated as "we don't know, fail closed
  // by reporting as MAX_UINT256". A signer that can't reason about value
  // shouldn't be allowed to send arbitrary amounts.
  return (1n << 256n) - 1n;
}

async function emitCapReject(
  auditSink: AuditSink | undefined,
  opts: {
    capWei: bigint;
    requestedValue: bigint;
    to: Hex | null;
    signerAddress: Hex;
  },
): Promise<void> {
  if (!auditSink) return;
  try {
    await auditSink.write(
      buildEvent({
        action: 'key-custody.relay.spend-cap.reject',
        outcome: 'denied',
        actor: { type: 'system', id: opts.signerAddress },
        subject: { type: 'transaction', id: opts.to ?? '<no-target>' },
        context: {
          signerAddress: opts.signerAddress,
          to: opts.to,
          capWei: opts.capWei.toString(),
          requestedValue: opts.requestedValue.toString(),
        },
      }),
    );
  } catch {
    // Fail-soft: a sink outage does not affect the rejection itself
    // (the throw still happens; the audit row is just missing).
  }
}

/**
 * Wrap any viem {@link LocalAccount} with a per-transaction ETH-value
 * cap. The cap is enforced BEFORE signing: a `signTransaction` call
 * with `value > capWei` throws {@link SpendCapExceededError} and the
 * HSM / KMS never sees the digest.
 *
 * `signMessage` and `signTypedData` are forwarded verbatim — they
 * don't carry an on-chain ETH value, so the cap doesn't apply.
 *
 * Composes with `createRelayerAccount`: wrap the relayer with the
 * cap to get role-tagged audit emission AND a per-tx spend limit.
 *
 * Synchronous factory — the wrapper holds no async state. The inner
 * account must already be resolved (it carries the address).
 *
 * @example
 * ```ts
 * const inner = await createRelayerAccount(backend, {
 *   role: 'paymaster-topup',
 *   auditSink,
 * });
 * const capped = createSpendCappedAccount(inner, {
 *   capWei: 10n ** 17n, // 0.1 ETH
 *   auditSink,
 * });
 * await walletClient.sendTransaction({ account: capped, to, value: 5n * 10n ** 16n }); // 0.05 ETH — OK
 * await walletClient.sendTransaction({ account: capped, to, value: 10n ** 18n });      // throws SpendCapExceededError
 * ```
 */
export function createSpendCappedAccount(
  inner: LocalAccount,
  opts: CreateSpendCappedAccountOpts,
): LocalAccount {
  if (opts.capWei < 0n) {
    throw new Error(
      `[key-custody] createSpendCappedAccount: capWei must be >= 0; got ${opts.capWei.toString()}`,
    );
  }
  const { capWei, auditSink } = opts;

  return {
    address: inner.address,
    type: 'local',
    source: 'kms-spend-capped',
    publicKey: inner.publicKey,

    async signMessage({ message }: { message: SignableMessage }) {
      // Messages carry no on-chain value; forward verbatim.
      return inner.signMessage({ message });
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async signTransaction(transaction: any, options?: any): Promise<Hex> {
      const requestedValue = readTxValue(transaction);
      if (requestedValue > capWei) {
        const to = (transaction.to as Hex | null | undefined) ?? null;
        await emitCapReject(auditSink, {
          capWei,
          requestedValue,
          to,
          signerAddress: inner.address,
        });
        throw new SpendCapExceededError({
          capWei,
          requestedValue,
          to,
          signerAddress: inner.address,
        });
      }
      // Under or at cap → delegate. (At-cap is intentionally permitted;
      // `cap == requested` is the boundary, not a violation.)
      return inner.signTransaction(transaction, options);
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async signTypedData(args: any): Promise<Hex> {
      // Typed data carries no on-chain value; forward verbatim.
      return inner.signTypedData(args);
    },
  } satisfies LocalAccount;
}
