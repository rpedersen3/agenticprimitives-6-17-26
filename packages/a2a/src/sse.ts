// SSE framing for message/stream (spec 269 FR-5.3). The package formats `TaskEvent`s as `text/event-stream`
// frames; holding open connections + fanning events to subscribers is the transport's job (the agent
// worker / ./cloudflare DO emits `processDue()`'s events to its open streams). Keeps the core transport-free.
import type { TaskEvent } from './types.js';

export const SSE_HEADERS: Record<string, string> = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache',
  connection: 'keep-alive',
};

/** Serialize a task event as an SSE frame: `event: <kind>` + `data: <json>`. */
export function formatSseEvent(event: TaskEvent): string {
  return `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** An SSE keep-alive comment frame. */
export function formatSseComment(text = 'keep-alive'): string {
  return `: ${text}\n\n`;
}

/** Whether a stream should close after this event (terminal task states end the stream). */
export function isStreamEnd(event: TaskEvent): boolean {
  return event.kind === 'task.status' && (event.state === 'completed' || event.state === 'failed' || event.state === 'canceled' || event.state === 'rejected');
}
