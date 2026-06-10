// JSON-RPC 2.0 envelope dispatch (spec 269 §2). Maps a parsed request to the agent's method handlers and
// shapes the JSON-RPC result/error. Transport-free: the caller (the ./cloudflare adapter / a worker)
// resolves the agent from Host, reads the HTTP body, and writes the Response. `message/stream` (SSE) is
// handled by the transport layer, not here, because it returns a stream rather than a single result.
import type { Address, Hex } from '@agenticprimitives/types';
import type { A2aAgent, MessageSendParams, ResubmitParams } from './agent.js';

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}
export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } };

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;

const err = (id: string | number | null, code: number, message: string): JsonRpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } });
const ok = (id: string | number | null, result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result });

/** Dispatch a single JSON-RPC request to the agent. `message/stream` is rejected here (handled by the
 *  SSE transport). The `caller` for tasks/get|cancel is taken from `params.caller`. */
export async function dispatchA2aRpc(agent: A2aAgent, req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const id = req.id ?? null;
  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return err(id, INVALID_REQUEST, 'not a JSON-RPC 2.0 request');
  }
  const p = (req.params ?? {}) as Record<string, unknown>;

  switch (req.method) {
    case 'message/send': {
      const r = await agent.messageSend(p as unknown as MessageSendParams);
      return r.ok ? ok(id, r.result) : err(id, r.code, r.message);
    }
    case 'tasks/resubmit': {
      const r = await agent.resubmit(p as unknown as ResubmitParams);
      return r.ok ? ok(id, r.result) : err(id, r.code, r.message);
    }
    case 'tasks/get': {
      const r = await agent.tasksGet({ taskId: p.taskId as Hex, caller: p.caller as Address });
      return r.ok ? ok(id, r.result) : err(id, r.code, r.message);
    }
    case 'tasks/cancel': {
      const r = await agent.tasksCancel({ taskId: p.taskId as Hex, caller: p.caller as Address });
      return r.ok ? ok(id, r.result) : err(id, r.code, r.message);
    }
    case 'tasks/pushNotificationConfig/set': {
      const r = await agent.pushConfigSet({ taskId: p.taskId as Hex, caller: p.caller as Address, url: p.url as string, token: p.token as string | undefined });
      return r.ok ? ok(id, r.result) : err(id, r.code, r.message);
    }
    case 'message/stream':
      return err(id, INVALID_REQUEST, 'message/stream must use the SSE transport, not the JSON-RPC body');
    default:
      return err(id, METHOD_NOT_FOUND, `unknown method: ${req.method}`);
  }
}

/** Parse a raw JSON body + dispatch. Used by the HTTP/Cloudflare transport. */
export async function handleA2aRpcBody(agent: A2aAgent, rawBody: string): Promise<JsonRpcResponse> {
  let req: JsonRpcRequest;
  try { req = JSON.parse(rawBody); } catch { return err(null, PARSE_ERROR, 'invalid JSON'); }
  return dispatchA2aRpc(agent, req);
}
