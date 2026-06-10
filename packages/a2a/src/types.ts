// A2A wire types (spec 269). Built on the @agenticprimitives/fulfillment Task/Artifact substrate; this
// package adds the message/thread, the vault-residency ref, the skill-handler contract, and the events
// the poll/push/stream delivery paths emit. Bodies live in the vault — only hashes/refs travel in state.
import type { Address, Hex } from '@agenticprimitives/types';
import type { Delegation } from '@agenticprimitives/delegation';
import type { Task, TaskState, Artifact } from '@agenticprimitives/fulfillment';

export type { Task, TaskState, Artifact };

/** A2A-INV-04 — message/artifact bodies are vault records, never inline. A ref names where to read the
 *  body (the assignee's per-agent demo-mcp vault namespace). The hash binds the content. */
export interface VaultRef {
  /** SA whose vault namespace holds the record (the assignee). */
  owner: Address;
  /** demo-mcp record type, e.g. `a2a:msg:<taskId>` / `a2a:artifact:<artifactId>`. */
  recordType: string;
}

/** An inbound A2A message (the request that creates a task, or a follow-up on a thread). Signed by the
 *  sender; the body is a VaultRef, the hash binds it. */
export interface A2aMessage {
  messageId: Hex;
  threadId?: string;
  /** The SA that sent it (the delegation's delegate / requester). */
  sender: Address;
  /** The requested skill (dispatched by name; unknown → task rejected). */
  skill: string;
  /** Where the input body lives + its hash. */
  bodyRef: VaultRef;
  bodyHash: Hex;
  /** Sender signature over the canonical message (A2A-INV-01). */
  signature: Hex;
  createdAt: number;
}

/** An A2A artifact = a fulfillment Artifact plus the vault ref to its body. */
export interface A2aArtifact extends Artifact {
  bodyRef: VaultRef;
}

/** The full per-task record the runtime persists (answers tasks/get + resumes after eviction). */
export interface TaskRecord {
  task: Task;
  /** The principal the sender acts FOR (the delegation's delegator) — what withDelegation keys on. */
  principal: Address;
  /** The SA that submitted the task (the delegate). */
  sender: Address;
  skill: string;
  /** The verified, captured grant — handed to the skill handler + re-checked on revocation (FR-3.3/FR-4.6). */
  delegation: Delegation;
  inbound: A2aMessage[];
  artifacts: A2aArtifact[];
  /** Webhook registered via tasks/pushNotificationConfig/set; signed push fires here on terminal state. */
  pushConfig?: PushConfig;
  /** Last error on a `failed` transition, surfaced to tasks/get. */
  error?: string;
  /** Monotonic version, bumped on every mutation — drives stream/idempotency. */
  rev: number;
  updatedAt: number;
}

/** Push webhook config (FR-5.2). */
export interface PushConfig {
  url: string;
  token?: string;
}

/** Stream/push event emitted on each task mutation. */
export type TaskEvent =
  | { kind: 'task.status'; taskId: Hex; state: TaskState; rev: number; error?: string }
  | { kind: 'task.artifact'; taskId: Hex; artifactId: Hex; rev: number };

/** Terminal states — no further transitions; delivery (push) fires here. */
export const TERMINAL_STATES: ReadonlySet<TaskState> = new Set<TaskState>([
  'completed',
  'failed',
  'canceled',
  'rejected',
]);

export function isTerminal(state: TaskState): boolean {
  return TERMINAL_STATES.has(state);
}
