// The Task runtime (spec 269 §3). Pure lifecycle logic over the fulfillment Task state machine: create a
// submitted task, validate every transition via canTaskTransition (fail-closed), and dispatch a working
// task to its skill handler — mapping the handler result (or AuthRequired / unknown-skill / throw) onto
// the next state. Storage + delivery are the caller's job (the TaskStore port + the JSON-RPC layer); this
// module never blocks on I/O beyond the handler it's given, and emits the events the stream/push paths use.
import { canTaskTransition, isHandoffAllowed, type HandoffPolicy } from '@agenticprimitives/fulfillment';
import type { Address, Hex } from '@agenticprimitives/types';
import type { Delegation } from '@agenticprimitives/delegation';
import type { TaskRecord, TaskState, TaskEvent, A2aMessage } from './types.js';
import { isTerminal } from './types.js';
import { AuthRequired, HandoffRequested, type SkillContext, type SkillHandler, type SkillResult } from './skill-handler.js';

/** Build a fresh `submitted` task record from a verified inbound message + grant. */
export function newTaskRecord(args: {
  taskId: Hex;
  principal: Address;
  assignee: Address;
  sender: Address;
  skill: string;
  delegation: Delegation;
  inbound: A2aMessage;
  permissionGrantRef: Hex;
  inputHash: Hex;
  now: number;
  deadline?: number;
  maxRetries?: number;
  parentCaseId?: Hex;
}): TaskRecord {
  return {
    task: {
      taskId: args.taskId,
      parentCaseId: args.parentCaseId,
      state: 'submitted',
      assignee: args.assignee,
      assigneeKind: 'agent',
      inputHash: args.inputHash,
      artifactIds: [],
      deadline: args.deadline,
      maxRetries: args.maxRetries ?? 0,
      permissionGrantRef: args.permissionGrantRef,
    },
    principal: args.principal,
    sender: args.sender,
    skill: args.skill,
    delegation: args.delegation,
    inbound: [args.inbound],
    artifacts: [],
    rev: 1,
    updatedAt: args.now,
  };
}

export type TransitionResult =
  | { ok: true; record: TaskRecord; event: TaskEvent }
  | { ok: false; reason: string };

/** Apply a state transition, fail-closed via the fulfillment transition table. Bumps `rev` + emits the
 *  status event. Does NOT persist — the caller writes the returned record to the TaskStore. */
export function applyTransition(
  record: TaskRecord,
  to: TaskState,
  opts: { now: number; error?: string } = { now: 0 },
): TransitionResult {
  const from = record.task.state;
  if (from === to) return { ok: false, reason: `already in ${to}` };
  if (!canTaskTransition(from, to)) return { ok: false, reason: `illegal transition ${from} -> ${to}` };
  const rev = record.rev + 1;
  const next: TaskRecord = {
    ...record,
    task: { ...record.task, state: to },
    error: to === 'failed' ? opts.error : record.error,
    rev,
    updatedAt: opts.now,
  };
  return { ok: true, record: next, event: { kind: 'task.status', taskId: record.task.taskId, state: to, rev } };
}

/**
 * Dispatch a `submitted` task: reject if the skill is unknown; otherwise move it to `working`, run the
 * handler, and map the outcome to the next state. Returns the final record + the ordered events. The
 * caller (alarm loop) persists the record and fans the events to streams/push. `makeContext` wires the
 * per-task vault / mcp / emitArtifact (W4) — the runtime stays transport-agnostic.
 */
export async function dispatchTask(
  record: TaskRecord,
  registry: Map<string, SkillHandler>,
  makeContext: (record: TaskRecord) => Omit<SkillContext, 'requestAuth' | 'requestHandoff' | 'principal' | 'sender' | 'taskId' | 'skill'> & { input: unknown; delegation: Delegation },
  now: number,
  opts?: { handoffPolicy?: HandoffPolicy },
): Promise<{ record: TaskRecord; events: TaskEvent[] }> {
  const events: TaskEvent[] = [];
  if (record.task.state !== 'submitted') {
    return { record, events };
  }

  const handler = registry.get(record.skill);
  if (!handler) {
    const rejected = applyTransition(record, 'rejected', { now, error: `unknown skill: ${record.skill}` });
    if (rejected.ok) {
      events.push(rejected.event);
      return { record: { ...rejected.record, error: `unknown skill: ${record.skill}` }, events };
    }
    return { record, events };
  }

  const working = applyTransition(record, 'working', { now });
  if (!working.ok) return { record, events };
  let cur = working.record;
  events.push(working.event);

  const base = makeContext(cur);
  const ctx: SkillContext = {
    ...base,
    taskId: cur.task.taskId,
    principal: cur.principal,
    sender: cur.sender,
    requestAuth: (reason: string): never => {
      throw new AuthRequired(reason);
    },
    requestHandoff: (req): never => {
      throw new HandoffRequested(req);
    },
  };

  let result: SkillResult;
  try {
    result = await handler.handle(ctx);
  } catch (e) {
    if (e instanceof AuthRequired) {
      const auth = applyTransition(cur, 'auth-required', { now });
      if (auth.ok) { events.push(auth.event); return { record: auth.record, events }; }
      return { record: cur, events };
    }
    if (e instanceof HandoffRequested) {
      // FR-3.6 / FLF-INV-09 — gate the reassignment on the agent's HandoffPolicy + the hop budget;
      // fail-closed: no policy, a disallowed target, or an exhausted hop budget rejects the task.
      const req = e.request;
      const hops = (cur.hopCount ?? 0) + 1;
      const ok = opts?.handoffPolicy
        && isHandoffAllowed(opts.handoffPolicy, req.target, req.targetClass)
        && hops <= opts.handoffPolicy.maxHopCount;
      if (!ok) {
        // The handler is mid-processing (`working`), so the illegal handoff fails the task (working→failed;
        // working→rejected is not a legal transition). Fail-closed.
        const reason = `handoff not permitted: ${req.target}${req.targetClass ? ` (${req.targetClass})` : ''}`;
        const fail = applyTransition(cur, 'failed', { now, error: reason });
        if (fail.ok) { events.push(fail.event); return { record: { ...fail.record, error: reason }, events }; }
        return { record: cur, events };
      }
      // The local agent's part is done; record the handoff for the transport to deliver to the target,
      // which re-verifies the (possibly re-scoped) delegation on receipt.
      const done = applyTransition(cur, 'completed', { now });
      if (done.ok) { events.push(done.event); return { record: { ...done.record, handoff: req, hopCount: hops }, events }; }
      return { record: cur, events };
    }
    const failed = applyTransition(cur, 'failed', { now, error: e instanceof Error ? e.message : String(e) });
    if (failed.ok) { events.push(failed.event); return { record: failed.record, events }; }
    return { record: cur, events };
  }

  const t = applyTransition(cur, result.state, { now, error: result.error });
  if (!t.ok) {
    const failed = applyTransition(cur, 'failed', { now, error: `handler returned illegal state ${result.state}` });
    if (failed.ok) { events.push(failed.event); return { record: failed.record, events }; }
    return { record: cur, events };
  }
  cur = result.state === 'completed' && result.artifactIds
    ? { ...t.record, task: { ...t.record.task, artifactIds: result.artifactIds } }
    : t.record;
  events.push(t.event);
  return { record: cur, events };
}

export { isTerminal };
