// The TaskStore PORT (spec 269 / ADR-0034). The runtime persists + retrieves task records through this
// interface so the core stays transport-agnostic: the Cloudflare TaskStoreDO (`./cloudflare`), an
// in-memory store (tests / non-Worker consumers), or sqlite/pg all implement it identically.
import type { Hex } from '@agenticprimitives/types';
import type { TaskRecord } from './types.js';

export interface TaskStore {
  /** Persist (insert or replace) a task record. */
  put(record: TaskRecord): Promise<void>;
  /** Load a task record, or null if unknown. */
  get(taskId: Hex): Promise<TaskRecord | null>;
  /** Task ids in a non-terminal state that are due for processing (drives the alarm loop). */
  listDue(now: number): Promise<Hex[]>;
  /** Single-use message-id reservation (FR-4.3 inbound replay guard). Returns false if already seen. */
  reserveMessageId(messageId: Hex, ttlSec: number): Promise<boolean>;
}

/** Reference in-memory TaskStore — used by the test harness + non-Worker consumers. NOT for production
 *  (no cross-isolate durability); the Cloudflare DO adapter is the durable implementation. */
export function createInMemoryTaskStore(): TaskStore {
  const tasks = new Map<string, TaskRecord>();
  const seen = new Map<string, number>(); // messageId -> expiry (sec)
  const due = new Set<string>();
  return {
    async put(record) {
      tasks.set(record.task.taskId.toLowerCase(), record);
      const key = record.task.taskId.toLowerCase();
      if (record.task.state === 'submitted' || record.task.state === 'working') due.add(key);
      else due.delete(key);
    },
    async get(taskId) {
      return tasks.get(taskId.toLowerCase()) ?? null;
    },
    async listDue() {
      return [...due] as Hex[];
    },
    async reserveMessageId(messageId, ttlSec) {
      const key = messageId.toLowerCase();
      const exp = seen.get(key);
      // `now` is injected by callers in tests; here we approximate with a monotonic-free check: a present
      // entry means used. (The durable adapter uses KV TTL.)
      if (exp !== undefined) return false;
      seen.set(key, ttlSec);
      return true;
    },
  };
}
