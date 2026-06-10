// @agenticprimitives/a2a/cloudflare — the Cloudflare adapter (ADR-0034). The ONLY module that touches
// @cloudflare/workers-types, keeping the core transport-agnostic. Provides a TaskStore backed by Durable
// Object storage; a per-agent DO worker wires `createA2aAgent({ taskStore: createDurableObjectTaskStore(state.storage), ... })`,
// sets an alarm, and calls `agent.processDue()` from `alarm()`. The DO class itself lives in the agent
// worker (it imports the consumer's skill handlers), so the package ships the storage adapter, not the class.
/// <reference types="@cloudflare/workers-types" />
import type { Hex } from '@agenticprimitives/types';
import type { TaskRecord } from '../types.js';
import type { TaskStore } from '../task-store.js';

const TASK = (id: string) => `task:${id.toLowerCase()}`;
const DUE = (id: string) => `due:${id.toLowerCase()}`;
const MSG = (id: string) => `msg:${id.toLowerCase()}`;

/** A durable, cross-isolate TaskStore over a Durable Object's storage. One DO per agent
 *  (shard `idFromName(agentSA.toLowerCase())`). `reserveMessageId` is durable + one-shot (the id key is
 *  permanent — a message id is single-use by construction; `ttlSec` is advisory). */
export function createDurableObjectTaskStore(storage: DurableObjectStorage): TaskStore {
  return {
    async put(record: TaskRecord) {
      const id = record.task.taskId.toLowerCase();
      await storage.put(TASK(id), record);
      if (record.task.state === 'submitted' || record.task.state === 'working') {
        await storage.put(DUE(id), 1);
      } else {
        await storage.delete(DUE(id));
      }
    },
    async get(taskId: Hex) {
      return (await storage.get<TaskRecord>(TASK(taskId))) ?? null;
    },
    async listDue() {
      const map = await storage.list<number>({ prefix: 'due:' });
      const out: Hex[] = [];
      for (const key of map.keys()) out.push(key.slice('due:'.length) as Hex);
      return out;
    },
    async reserveMessageId(messageId: Hex) {
      const k = MSG(messageId);
      if ((await storage.get(k)) !== undefined) return false;
      await storage.put(k, 1);
      return true;
    },
  };
}

export const A2A_CLOUDFLARE_ADAPTER_STATUS = 'w3' as const;
