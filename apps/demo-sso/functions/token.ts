// POST /token — the relying site exchanges its single-use code for the
// AgentSession (server-to-server). The code is consumed atomically (deleted on
// read), so it works at most once (CN-9); the token never appears in a URL.
//
// Body: { code: string, aud: string }. Returns { agentSession: <jwt> }.
import { json, type FnContext } from './_lib/server-broker';

interface TokenBody {
  code?: string;
  aud?: string;
}

export const onRequestPost = async ({ request, env }: FnContext): Promise<Response> => {
  const body = (await request.json().catch(() => ({}))) as TokenBody;
  if (!body.code || !body.aud) return json({ error: 'code + aud are required' }, 400);

  const key = `code:${body.code}`;
  const raw = await env.AUTH_CODES.get(key);
  await env.AUTH_CODES.delete(key); // single-use: consumed regardless of outcome
  if (!raw) return json({ error: 'invalid or already-used code' }, 400);

  const { token, aud } = JSON.parse(raw) as { token: string; aud: string };
  if (aud !== body.aud) return json({ error: 'aud mismatch' }, 400);
  return json({ agentSession: token });
};
