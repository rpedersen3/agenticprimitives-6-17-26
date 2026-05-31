// createRelayerAccount — KMS-backed viem LocalAccount with built-in audit
// emission for funded relayer/operator chain calls.
//
// R5.12a / PKG-KEY-CUSTODY-005 (relayer-pattern package gap).
//
// Why a separate factory from `createKmsViemAccount`:
//
//   `createKmsViemAccount(backend)` returns a general-purpose viem
//   LocalAccount. App-level relayers that pay gas for sponsored deploys,
//   name registrations, custody-policy applies, paymaster top-ups, etc.
//   need ONE more thing: a forensic trail. Every relayed sign op must
//   emit an audit row tagged with the operator ROLE so the on-chain
//   action stitches back to the off-chain `(role, target, value)` tuple
//   in audit logs.
//
//   The `createRelayerAccount(backend, { role, auditSink })` factory
//   composes the existing `createKmsViemAccount` + audit emission so
//   app code reaches for THIS when migrating off raw private keys.
//
//   Why this matters: pre-R5.12a, app authors reached for
//   `privateKeyToAccount(DEPLOYER_PRIVATE_KEY)` because there was no
//   obvious "use me for funded relayer ops" entry point. The packages
//   had all the primitives (`buildSignerBackend` + `createKmsViemAccount`),
//   but no convention. This factory IS the convention.
//
// Audit event emitted on every sign op:
//   action:   `key-custody.relay.sign`
//   actor:    { type: 'system', id: <role> }
//   subject:  { type: <opType>, id: <digestFingerprint> }
//   context:
//     role:           caller-supplied role tag
//     signerAddress:  the relayer EOA
//     opType:         'message' | 'transaction' | 'typed-data'
//     to:             tx target address (transaction only)
//     value:          tx value in wei (transaction only)
//     digestFingerprint: keccak256(digest).slice(0, 18) — 9 bytes of
//                        the digest, never the digest itself
//
// Fail-soft: audit emission errors are caught and silently dropped so
// a logging outage cannot break the relay flow. Consumers who need
// fail-hard semantics should wrap the supplied sink with
// `composeFailHardSinks` from @agenticprimitives/audit.

import {
  hashMessage,
  hashTypedData,
  keccak256,
  serializeTransaction,
  type Hex,
  type LocalAccount,
  type SignableMessage,
} from 'viem';
import { buildEvent, type AuditSink } from '@agenticprimitives/audit';
import { createKmsViemAccount } from './kms-viem-account';
import type { KmsAccountBackend } from './types';

/**
 * Caller-supplied options for `createRelayerAccount`.
 *
 * @param role        Operator role tag emitted into every audit row.
 *                    Conventional values: 'direct-deploy', 'register-name',
 *                    'custody-relay', 'paymaster-topup'. Apps document
 *                    their role taxonomy in their `RELAYER.md`.
 * @param auditSink   Where to write `key-custody.relay.sign` events.
 *                    Omit only for tests; production deploys MUST wire
 *                    a durable sink so a sponsored chain call stitches
 *                    back to the operator role.
 */
export interface CreateRelayerAccountOpts {
  role: string;
  auditSink?: AuditSink;
}

function digestFingerprint(digest: Hex): string {
  // 18 chars = 9 bytes of the keccak hash. Enough to disambiguate in
  // logs; far too short to be a preimage. Same redaction shape used by
  // LocalSecp256k1Signer / GcpKmsSigner for digests in audit rows.
  return keccak256(digest).slice(0, 18);
}

async function emitRelaySign(
  auditSink: AuditSink | undefined,
  role: string,
  signerAddress: Hex,
  opType: 'message' | 'transaction' | 'typed-data',
  digest: Hex,
  txContext?: { to?: Hex | null; value?: bigint },
): Promise<void> {
  if (!auditSink) return;
  try {
    await auditSink.write(
      buildEvent({
        action: 'key-custody.relay.sign',
        outcome: 'success',
        actor: { type: 'system', id: role },
        subject: { type: opType, id: digestFingerprint(digest) },
        context: {
          role,
          signerAddress,
          opType,
          to: txContext?.to ?? null,
          // Audit context values must be JSON-serialisable; emit value as
          // a decimal string (bigint loses precision on JSON.stringify).
          value:
            txContext?.value !== undefined ? txContext.value.toString() : null,
          digestFingerprint: digestFingerprint(digest),
        },
      }),
    );
  } catch {
    // Fail-soft: an audit sink outage cannot break the relay flow.
    // Consumers who want fail-hard semantics wrap with
    // composeFailHardSinks from @agenticprimitives/audit.
  }
}

/**
 * Wrap a {@link KmsAccountBackend} as a viem {@link LocalAccount} suitable
 * for funded relayer / operator chain calls.
 *
 * The returned account delegates signing to `createKmsViemAccount(backend)`
 * (same HSM-backed digest signing, no key material leaves KMS) and
 * additionally emits a `key-custody.relay.sign` audit row on every
 * sign op tagged with the supplied `role`.
 *
 * Migration target for app code that previously used
 * `privateKeyToAccount(env.X_PRIVATE_KEY)` for funded ops.
 *
 * @example
 * ```ts
 * const backend = buildSignerBackend({ backend: 'gcp-kms' });
 * const relayer = await createRelayerAccount(backend, {
 *   role: 'direct-deploy',
 *   auditSink,
 * });
 * await walletClient.writeContract({ account: relayer, ... });
 * // emits: key-custody.relay.sign { role: 'direct-deploy', opType: 'transaction', to, value, ... }
 * ```
 */
export async function createRelayerAccount(
  backend: KmsAccountBackend,
  opts: CreateRelayerAccountOpts,
): Promise<LocalAccount> {
  const inner = await createKmsViemAccount(backend);
  const { role, auditSink } = opts;

  return {
    address: inner.address,
    type: 'local',
    source: 'kms-relayer',
    publicKey: inner.publicKey,

    async signMessage({ message }: { message: SignableMessage }) {
      const digest = hashMessage(message);
      const signed = await inner.signMessage({ message });
      await emitRelaySign(auditSink, role, inner.address, 'message', digest);
      return signed;
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async signTransaction(transaction: any, options?: any): Promise<Hex> {
      // Compute the digest for audit emission BEFORE handing off to
      // the inner account (which recomputes it internally; viem doesn't
      // expose the precomputed digest from privateKeyToAccount-style
      // accounts, so we re-do it here for the audit subject).
      const serializer = options?.serializer ?? serializeTransaction;
      const unsigned = serializer(transaction);
      const digest = keccak256(unsigned);
      const signed = await inner.signTransaction(transaction, options);
      await emitRelaySign(auditSink, role, inner.address, 'transaction', digest, {
        to: (transaction.to as Hex | null | undefined) ?? null,
        // viem transactions use bigint for value; default to 0n when omitted.
        value:
          typeof transaction.value === 'bigint'
            ? transaction.value
            : transaction.value !== undefined
              ? BigInt(transaction.value as string | number)
              : 0n,
      });
      return signed;
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async signTypedData(args: any): Promise<Hex> {
      const digest = hashTypedData(args);
      const signed = await inner.signTypedData(args);
      await emitRelaySign(auditSink, role, inner.address, 'typed-data', digest);
      return signed;
    },
  } satisfies LocalAccount;
}
