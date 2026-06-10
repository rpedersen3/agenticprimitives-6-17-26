// The embeddable agent (spec 269 §8) — wires the W1 runtime + the W2 auth gate into the method handlers
// an agent worker exposes at /api/a2a, plus the alarm() body (`processDue`) and the agent-card. Storage,
// HTTP, and the DurableObject are the caller's (the JSON-RPC layer + the ./cloudflare adapter); this stays
// transport-agnostic. message/send NEVER runs the skill inline (FR-2.3) — it persists + returns submitted;
// processDue does the work.
import { hashDelegation } from '@agenticprimitives/delegation';
import type { HandoffPolicy } from '@agenticprimitives/fulfillment';
import type { Address, Hex } from '@agenticprimitives/types';
import type { Delegation } from '@agenticprimitives/delegation';
import type { Task, TaskRecord, TaskEvent, A2aMessage, A2aArtifact, VaultRef, PushConfig } from './types.js';
import { isTerminal } from './types.js';
import type { TaskStore } from './task-store.js';
import { newTaskRecord, applyTransition, dispatchTask } from './runtime.js';
import { buildSkillRegistry, type SkillHandler, type VaultClient, type McpClient } from './skill-handler.js';
import { authorizeA2aMessage, type OnChainChecks } from './auth.js';
import type { A2aEnforcers } from './grant.js';
import { deliverPush, type TerminalSigner, type PushSender } from './push.js';

export interface A2aAgentConfig {
  /** This agent's Smart Account — the assignee + the allowedTargets the gate requires. */
  agentSA: Address;
  /** Network identifiers used to derive `permissionGrantRef = hashDelegation(...)`. */
  chainId: number;
  delegationManager: Address;
  enforcers: A2aEnforcers;
  taskStore: TaskStore;
  checks: OnChainChecks;
  handlers: SkillHandler[];
  vault: VaultClient;
  mcp: McpClient;
  /** Clock + id generators — injected for determinism in tests. */
  now?: () => number;
  newTaskId?: () => Hex;
  newArtifactId?: () => Hex;
  /** Hash of an arbitrary body (default keccak256 via the consumer; here a required injection). */
  hashBody: (data: unknown) => Hex;
  /** Terminal push delivery (FR-5.2) — both required to enable push; omit to disable. The signer MUST
   *  be a KMS/session signer for the assignee SA (SR-8). */
  signTerminal?: TerminalSigner;
  pushSender?: PushSender;
  /** FR-3.6 — the policy gating skill-handler hand-offs (`requestHandoff`). Omit ⇒ hand-offs are
   *  rejected (fail-closed). */
  handoffPolicy?: HandoffPolicy;
}

export type RpcOk<T> = { ok: true; result: T };
export type RpcErr = { ok: false; code: number; message: string };
export type RpcResult<T> = RpcOk<T> | RpcErr;

export interface MessageSendParams {
  delegation: Delegation;
  requester: Address;
  message: A2aMessage;
  /** The input body (persisted to the assignee's vault → bodyRef; FR-2.2). */
  input: unknown;
  pushConfig?: { url: string; token?: string };
}

/** Resubmit an auth-required task with a fresh grant (FR-3.5). Carries a NEW signed message (new
 *  messageId → no replay) + the input the suspended handler asked for. Only the original sender may. */
export interface ResubmitParams extends MessageSendParams {
  taskId: Hex;
}

export interface A2aAgent {
  messageSend(params: MessageSendParams): Promise<RpcResult<{ taskId: Hex; state: Task['state'] }>>;
  /** Resume an auth-required task (auth-required → submitted) with a fresh grant + message (FR-3.5). */
  resubmit(params: ResubmitParams): Promise<RpcResult<{ taskId: Hex; state: Task['state'] }>>;
  tasksGet(params: { taskId: Hex; caller: Address }): Promise<RpcResult<Task & { error?: string; artifactRefs: VaultRef[] }>>;
  tasksCancel(params: { taskId: Hex; caller: Address }): Promise<RpcResult<{ taskId: Hex; state: Task['state'] }>>;
  /** Register the push webhook for a task (FR-5.2). Party-authed. */
  pushConfigSet(params: { taskId: Hex; caller: Address; url: string; token?: string }): Promise<RpcResult<{ taskId: Hex; registered: true }>>;
  /** The alarm() body — process every due task to a next state. Returns the events to fan out (W4 delivery). */
  processDue(): Promise<TaskEvent[]>;
  agentCard(): AgentCard;
}

export interface AgentCard {
  name: string;
  url: string;
  version: string;
  capabilities: { streaming: boolean; pushNotifications: boolean; stateTransitionHistory: boolean };
  skills: { id: string }[];
}

const RPC_INVALID_REQUEST = -32600;
const RPC_UNAUTHORIZED = -32001;
const RPC_NOT_FOUND = -32004;
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function createA2aAgent(config: A2aAgentConfig): A2aAgent {
  const registry = buildSkillRegistry(config.handlers);
  const now = () => (config.now ? config.now() : Date.now());
  let artCounter = 0;
  const newArtifactId = () =>
    config.newArtifactId ? config.newArtifactId() : (`0x${(++artCounter).toString(16).padStart(64, '0')}`) as Hex;

  return {
    async messageSend(params) {
      const auth = await authorizeA2aMessage({
        delegation: params.delegation,
        requester: params.requester,
        message: params.message,
        thisAgentSA: config.agentSA,
        skill: params.message.skill,
        enforcers: config.enforcers,
        checks: config.checks,
        store: config.taskStore,
        now: now(),
      });
      if (!auth.ok) return { ok: false, code: RPC_UNAUTHORIZED, message: auth.reason };

      // FR-2.2 — body integrity + vault residency: the signed bodyHash must match the input; persist the
      // input to THIS agent's vault namespace; the message keeps only the ref + hash.
      if (!eq(config.hashBody(params.input), params.message.bodyHash)) {
        return { ok: false, code: RPC_INVALID_REQUEST, message: 'input does not match signed bodyHash' };
      }
      const bodyRef = await config.vault.write({
        owner: config.agentSA,
        recordType: `a2a:msg:${params.message.messageId}`,
        data: params.input,
      });
      const message: A2aMessage = { ...params.message, bodyRef };

      const taskId = config.newTaskId ? config.newTaskId() : (`0x${'00'.repeat(31)}01`) as Hex;
      const record = newTaskRecord({
        taskId,
        principal: auth.principal,
        assignee: config.agentSA,
        sender: params.requester,
        skill: message.skill,
        delegation: params.delegation,
        inbound: message,
        permissionGrantRef: hashDelegation(params.delegation, config.chainId, config.delegationManager),
        inputHash: message.bodyHash,
        now: now(),
      });
      const withPush: TaskRecord = params.pushConfig ? { ...record, pushConfig: params.pushConfig } : record;
      await config.taskStore.put(withPush); // FR-2.4 — schedule processing (listDue → alarm)
      return { ok: true, result: { taskId, state: 'submitted' } }; // FR-2.3 — return immediately
    },

    async resubmit(params) {
      const rec = await config.taskStore.get(params.taskId);
      if (!rec) return { ok: false, code: RPC_NOT_FOUND, message: 'unknown task' };
      // FR-3.5 — only a task the agent itself parked in auth-required may be resumed, by its sender.
      if (rec.task.state !== 'auth-required') return { ok: false, code: RPC_INVALID_REQUEST, message: 'task is not awaiting auth' };
      if (!eq(params.requester, rec.sender)) return { ok: false, code: RPC_UNAUTHORIZED, message: 'only the original sender may resubmit' };
      if (!eq(params.message.skill, rec.skill)) return { ok: false, code: RPC_INVALID_REQUEST, message: 'skill mismatch on resubmit' };
      // Re-run the full auth gate on the fresh grant + new message (single-use messageId → no replay).
      const auth = await authorizeA2aMessage({
        delegation: params.delegation, requester: params.requester, message: params.message,
        thisAgentSA: config.agentSA, skill: rec.skill, enforcers: config.enforcers,
        checks: config.checks, store: config.taskStore, now: now(),
      });
      if (!auth.ok) return { ok: false, code: RPC_UNAUTHORIZED, message: auth.reason };
      if (!eq(config.hashBody(params.input), params.message.bodyHash)) {
        return { ok: false, code: RPC_INVALID_REQUEST, message: 'input does not match signed bodyHash' };
      }
      const bodyRef = await config.vault.write({
        owner: config.agentSA, recordType: `a2a:msg:${params.message.messageId}`, data: params.input,
      });
      const t = applyTransition(rec, 'submitted', { now: now() });
      if (!t.ok) return { ok: false, code: RPC_INVALID_REQUEST, message: t.reason };
      // Replace the grant + append the fresh message (processDue reads the LATEST inbound body).
      const updated: TaskRecord = {
        ...t.record, delegation: params.delegation,
        task: { ...t.record.task, inputHash: params.message.bodyHash },
        inbound: [...t.record.inbound, { ...params.message, bodyRef }],
      };
      await config.taskStore.put(updated);
      return { ok: true, result: { taskId: params.taskId, state: 'submitted' } };
    },

    async tasksGet({ taskId, caller }) {
      const rec = await config.taskStore.get(taskId);
      if (!rec) return { ok: false, code: RPC_NOT_FOUND, message: 'unknown task' };
      // Caller must be the sender or the assignee (FR-2 tasks/get auth).
      if (!eq(caller, rec.sender) && !eq(caller, rec.task.assignee)) {
        return { ok: false, code: RPC_UNAUTHORIZED, message: 'not a party to this task' };
      }
      return { ok: true, result: { ...rec.task, error: rec.error, artifactRefs: rec.artifacts.map((a) => a.bodyRef) } };
    },

    async tasksCancel({ taskId, caller }) {
      const rec = await config.taskStore.get(taskId);
      if (!rec) return { ok: false, code: RPC_NOT_FOUND, message: 'unknown task' };
      if (!eq(caller, rec.sender) && !eq(caller, rec.task.assignee)) {
        return { ok: false, code: RPC_UNAUTHORIZED, message: 'not a party to this task' };
      }
      const t = applyTransition(rec, 'canceled', { now: now() });
      if (!t.ok) return { ok: false, code: RPC_INVALID_REQUEST, message: t.reason };
      await config.taskStore.put(t.record);
      return { ok: true, result: { taskId, state: 'canceled' } };
    },

    async pushConfigSet({ taskId, caller, url, token }) {
      const rec = await config.taskStore.get(taskId);
      if (!rec) return { ok: false, code: RPC_NOT_FOUND, message: 'unknown task' };
      if (!eq(caller, rec.sender) && !eq(caller, rec.task.assignee)) {
        return { ok: false, code: RPC_UNAUTHORIZED, message: 'not a party to this task' };
      }
      const pushConfig: PushConfig = token ? { url, token } : { url };
      await config.taskStore.put({ ...rec, pushConfig });
      return { ok: true, result: { taskId, registered: true } };
    },

    async processDue() {
      const events: TaskEvent[] = [];
      const due = await config.taskStore.listDue(now());
      for (const taskId of due) {
        const rec = await config.taskStore.get(taskId);
        if (!rec || rec.task.state !== 'submitted') continue;

        // Per-task context: read the input from the vault, persist emitted artifact bodies to the
        // assignee's vault (A2A-INV-04), expose vault/mcp.
        const captured: A2aArtifact[] = [];
        const makeContext = (r: TaskRecord) => ({
          input: undefined as unknown, // filled below (async read) before dispatch
          delegation: r.delegation,
          vault: config.vault,
          mcp: config.mcp,
          emitArtifact: async (a: { artifactKind: string; body: unknown; bodyContentType?: string; disclosurePolicy?: string; caseId?: Hex }): Promise<Hex> => {
            const artifactId = newArtifactId();
            const bodyRef = await config.vault.write({ owner: config.agentSA, recordType: `a2a:artifact:${artifactId}`, data: a.body });
            captured.push({
              artifactId,
              caseId: a.caseId ?? (`0x${'00'.repeat(32)}`) as Hex,
              producer: config.agentSA,
              artifactKind: a.artifactKind,
              bodyHash: config.hashBody(a.body),
              bodyContentType: a.bodyContentType ?? 'application/json',
              disclosurePolicy: a.disclosurePolicy ?? 'private',
              bodyRef,
              createdAt: now(),
            });
            return artifactId;
          },
        });
        const input = await config.vault.read(rec.inbound[rec.inbound.length - 1]!.bodyRef);
        const ctxBase = makeContext(rec);
        const { record: processed, events: evs } = await dispatchTask(
          rec, registry, () => ({ ...ctxBase, input }), now(),
          config.handoffPolicy ? { handoffPolicy: config.handoffPolicy } : undefined,
        );
        const merged: TaskRecord = { ...processed, artifacts: [...processed.artifacts, ...captured] };
        await config.taskStore.put(merged);
        events.push(...evs);

        // FR-5.2 — on a terminal state, deliver a signed push to the registered webhook (best-effort).
        if (isTerminal(merged.task.state) && merged.pushConfig && config.pushSender && config.signTerminal) {
          await deliverPush(merged, config.signTerminal, config.pushSender, now());
        }
      }
      return events;
    },

    agentCard() {
      return {
        name: config.agentSA,
        url: `/api/a2a`,
        version: '0.1.0',
        capabilities: { streaming: true, pushNotifications: true, stateTransitionHistory: true },
        skills: config.handlers.map((h) => ({ id: h.skill })),
      };
    },
  };
}
