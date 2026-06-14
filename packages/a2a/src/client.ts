// The A2aWireAdapter client (spec 269 §8). Submits tasks to a target agent + collects results by poll /
// stream / cancel. Transport-agnostic: a `A2aTransport` (fetch/SSE) is injected, so the package never
// hardcodes HTTP. Messages are built + signed by the caller (use `hashA2aMessage` + your signer) and
// passed in — the client doesn't hold keys.
import type { Address, Hex } from '@agenticprimitives/types';
import type { Delegation } from '@agenticprimitives/delegation';
import type { Task, TaskEvent, A2aMessage } from './types.js';
import type { JsonRpcRequest, JsonRpcResponse } from './jsonrpc.js';

export interface A2aTransport {
  /** POST a JSON-RPC request to `targetAgent`'s /api/a2a and return the parsed response. */
  rpc(targetAgent: Address, request: JsonRpcRequest): Promise<JsonRpcResponse>;
  /** Open the message/stream SSE for a task; yields events until terminal. Optional until W4. */
  stream?(targetAgent: Address, taskId: Hex): AsyncIterable<TaskEvent>;
}

function unwrap<T>(res: JsonRpcResponse): T {
  if ('error' in res) throw new Error(`a2a rpc error ${res.error.code}: ${res.error.message}`);
  return res.result as T;
}

export class A2aWireAdapter {
  private seq = 0;
  constructor(private readonly transport: A2aTransport) {}

  private id(): number {
    return ++this.seq;
  }

  /** Submit an async task. The `message` must already be signed by `requester` (see `hashA2aMessage`). */
  async submitTask(
    targetAgent: Address,
    args: { message: A2aMessage; delegation: Delegation; requester: Address; input: unknown; pushConfig?: { url: string; token?: string } },
  ): Promise<{ taskId: Hex; state: Task['state'] }> {
    const res = await this.transport.rpc(targetAgent, {
      jsonrpc: '2.0', id: this.id(), method: 'message/send',
      params: { delegation: args.delegation, requester: args.requester, message: args.message, input: args.input, pushConfig: args.pushConfig },
    });
    return unwrap(res);
  }

  /** Poll a task's current state + artifact refs. AUDIT NEW-A2A-2: `caller` must sign
   *  `hashA2aTaskRequest({ method:'tasks/get', taskId, agentSA: targetAgent, chainId })` and pass the
   *  `signature` (the client holds no keys — sign externally, like `submitTask`'s message). */
  async getTask(targetAgent: Address, taskId: Hex, caller: Address, signature: Hex): Promise<Task & { error?: string }> {
    const res = await this.transport.rpc(targetAgent, {
      jsonrpc: '2.0', id: this.id(), method: 'tasks/get', params: { taskId, caller, signature },
    });
    return unwrap(res);
  }

  /** Cancel a task. `caller` must sign `hashA2aTaskRequest({ method:'tasks/cancel', ... })` (NEW-A2A-2). */
  async cancelTask(targetAgent: Address, taskId: Hex, caller: Address, signature: Hex): Promise<{ taskId: Hex; state: Task['state'] }> {
    const res = await this.transport.rpc(targetAgent, {
      jsonrpc: '2.0', id: this.id(), method: 'tasks/cancel', params: { taskId, caller, signature },
    });
    return unwrap(res);
  }

  /** Subscribe to a task's status/artifact events (SSE). Requires a transport that supports streaming. */
  subscribeTaskUpdates(targetAgent: Address, taskId: Hex): AsyncIterable<TaskEvent> {
    if (!this.transport.stream) throw new Error('transport does not support streaming (message/stream)');
    return this.transport.stream(targetAgent, taskId);
  }
}
