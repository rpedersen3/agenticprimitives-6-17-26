// Signed push delivery (spec 269 FR-5.2 / SR-5). On a terminal state the assignee SA signs a canonical
// envelope and POSTs it to the sender-registered webhook; the receiver independently verifies the
// assignee's signature + dedupes on (taskId, state). Signing + the HTTP POST are INJECTED (the package
// holds no keys + no transport); the assignee signer MUST be a KMS/session signer (SR-8), never a raw key.
import { keccak256, encodeAbiParameters, toBytes, type Address, type Hex } from 'viem';
import type { TaskState, TaskRecord } from './types.js';

export interface PushPayload {
  taskId: Hex;
  state: TaskState;
  artifactIds: Hex[];
  /** Unix seconds — also the idempotency input; receiver dedupes on (taskId, state). */
  ts: number;
}

export interface PushEnvelope {
  payload: PushPayload;
  /** Assignee SA signature over `hashPushPayload(payload)` (ERC-1271 / session key). */
  signature: Hex;
  /** The token the sender registered with `tasks/pushNotificationConfig/set`. */
  token?: string;
}

/** Canonical digest the assignee signs (binds task, state, artifact set, timestamp). */
export function hashPushPayload(p: PushPayload): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32[]' }, { type: 'uint256' }],
      [p.taskId, keccak256(toBytes(p.state)), p.artifactIds, BigInt(p.ts)],
    ),
  );
}

/** Sign a terminal digest as the assignee SA (KMS/session signer — never a raw key). */
export type TerminalSigner = (digest: Hex) => Promise<Hex>;
/** POST a push envelope to `url`. Throws on transport failure so `deliverPush` can retry. */
export type PushSender = (url: string, envelope: PushEnvelope) => Promise<void>;

/** Build + sign + best-effort-POST the terminal push, with bounded retry. Returns whether it was
 *  delivered. A no-op (false) when the task has no `pushConfig`. */
export async function deliverPush(
  record: TaskRecord,
  sign: TerminalSigner,
  send: PushSender,
  now: number,
  retries = 2,
): Promise<boolean> {
  if (!record.pushConfig?.url) return false;
  const payload: PushPayload = {
    taskId: record.task.taskId,
    state: record.task.state,
    artifactIds: record.task.artifactIds,
    ts: Math.floor(now / 1000),
  };
  const signature = await sign(hashPushPayload(payload));
  const envelope: PushEnvelope = { payload, signature, token: record.pushConfig.token };
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await send(record.pushConfig.url, envelope);
      return true;
    } catch {
      if (attempt === retries) return false;
    }
  }
  return false;
}

/** Receiver-side verification: the assignee SA signed this envelope over the recomputed digest. */
export async function verifyPushEnvelope(
  envelope: PushEnvelope,
  assigneeSA: Address,
  verify: (account: Address, digest: Hex, signature: Hex) => Promise<boolean>,
): Promise<boolean> {
  return verify(assigneeSA, hashPushPayload(envelope.payload), envelope.signature);
}
