// POST /token — single-use code exchange (CN-9; the token never appears in a URL).
//
// Two grants share this endpoint (the demo's two relying flows):
//
//   1. OIDC authorization_code + PKCE (spec 230 §4.3) — the relying app (demo-org) sends
//      { grant_type, code, code_verifier, client_id, redirect_uri }. We verify the PKCE
//      binding + the client/redirect bound at grant time, then return
//      { id_token, token_type, expires_in, delegation, org? }. Identity in the id_token;
//      authority in the delegation sidecar (ADR-0019). Cross-origin → CORS for the client.
//
//   2. Legacy code-exchange — the demo-sso self-login (Google / simulated /authorize) sends
//      { code, aud } and gets { agentSession }.
import { verifyPkceS256 } from '@agenticprimitives/connect';
import { jsonCors, preflight, type FnContext } from './_lib/server-broker';

const ID_TOKEN_TTL = 3600;

interface TokenBody {
  grant_type?: string;
  code?: string;
  code_verifier?: string;
  client_id?: string;
  redirect_uri?: string;
  aud?: string;
}

export const onRequestOptions = ({ request }: FnContext): Response => preflight(request);

export const onRequestPost = async ({ request, env }: FnContext): Promise<Response> => {
  const body = (await request.json().catch(() => ({}))) as TokenBody;

  // ── OIDC authorization_code grant (spec 230) ──
  if (body.grant_type === 'authorization_code' || body.code_verifier) {
    if (!body.code || !body.code_verifier || !body.client_id || !body.redirect_uri) {
      return jsonCors({ error: 'code, code_verifier, client_id, redirect_uri required' }, request, 400);
    }
    const key = `oidc:${body.code}`;
    const raw = await env.AUTH_CODES.get(key);
    await env.AUTH_CODES.delete(key); // single-use, regardless of outcome
    if (!raw) return jsonCors({ error: 'invalid or already-used code' }, request, 400);
    const grant = JSON.parse(raw) as {
      id_token: string;
      delegation: unknown;
      org: unknown;
      code_challenge: string;
      client_id: string;
      redirect_uri: string;
    };
    if (grant.client_id !== body.client_id) return jsonCors({ error: 'client_id mismatch' }, request, 400);
    if (grant.redirect_uri !== body.redirect_uri) return jsonCors({ error: 'redirect_uri mismatch' }, request, 400);
    if (!(await verifyPkceS256(body.code_verifier, grant.code_challenge))) {
      return jsonCors({ error: 'PKCE verification failed' }, request, 400);
    }
    return jsonCors(
      {
        id_token: grant.id_token,
        token_type: 'Bearer',
        expires_in: ID_TOKEN_TTL,
        delegation: grant.delegation ?? undefined,
        ...(grant.org ? { org: grant.org } : {}),
      },
      request,
    );
  }

  // ── Legacy code-exchange (demo-sso self-login: Google / simulated) ──
  if (!body.code || !body.aud) return jsonCors({ error: 'code + aud are required' }, request, 400);
  const key = `code:${body.code}`;
  const raw = await env.AUTH_CODES.get(key);
  await env.AUTH_CODES.delete(key);
  if (!raw) return jsonCors({ error: 'invalid or already-used code' }, request, 400);
  const { token, aud } = JSON.parse(raw) as { token: string; aud: string };
  if (aud !== body.aud) return jsonCors({ error: 'aud mismatch' }, request, 400);
  return jsonCors({ agentSession: token }, request);
};
