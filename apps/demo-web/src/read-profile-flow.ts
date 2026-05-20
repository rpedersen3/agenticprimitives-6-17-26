// Step 3: call the agent's tool proxy, which calls the MCP server.
// Round trip: POST /a2a/tools/get_profile { sessionId } → mcp returns PII.

import type { Address } from '@agenticprimitives/types';
import { csrfHeaders } from './csrf';

export interface ReadProfileOk {
  ok: true;
  profile: {
    owner_address: Address;
    full_name: string;
    email: string;
    phone: string | null;
    notes: string | null;
    updated_at: string;
  };
}

export interface ReadProfileError {
  ok: false;
  error: string;
}

export async function readProfile(sessionId: string): Promise<ReadProfileOk | ReadProfileError> {
  const res = await fetch('/a2a/tools/get_profile', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ sessionId }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok || body.ok !== true) {
    return { ok: false, error: typeof body.error === 'string' ? body.error : `HTTP ${res.status}` };
  }
  return { ok: true, profile: body.profile as ReadProfileOk['profile'] };
}
