// GET /oidc/google/callback?code=...&state=...  (Google's redirect_uri target)
//
// The real OIDC callback: retrieve the stashed PKCE/state context, exchange the
// code for tokens + verify the id_token (connect-auth — RS256/JWKS, alg-pinned,
// email_verified, nonce), then treat the verified (iss, sub) as a LOGIN-GRADE
// credential facet, resolve it to a canonical agent via the directory, issue an
// aud-bound AgentSession, and deliver it via the §4a single-use code.
//
// NOTE: the OIDC subject is keyed on (iss, sub) — never email (CN-3). The agent
// is RESOLVED via the directory; it is not derived from the email.
import { completeLogin, oidcFacetId } from '@agenticprimitives/connect-auth/google';
import { newAuthCode, validateRedirectUri } from '@agenticprimitives/connect';
import type { CredentialPrincipal } from '@agenticprimitives/types';
import { issueForRelyingSite } from '../../../src/lib/broker-core';
import { getServer, json, type FnContext } from '../../_lib/server-broker';

export const onRequestGet = async ({ request, env }: FnContext): Promise<Response> => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    return json({ error: 'Google OIDC not configured. See OIDC-SETUP.md.' }, 503);
  }
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return json({ error: 'code + state required' }, 400);

  // Retrieve + consume the stashed PKCE/state context (single-use).
  const stashKey = `oidc:${state}`;
  const stashRaw = await env.AUTH_CODES.get(stashKey);
  await env.AUTH_CODES.delete(stashKey);
  if (!stashRaw) return json({ error: 'unknown or expired state' }, 400);
  const stash = JSON.parse(stashRaw) as { codeVerifier: string; nonce: string; aud: string; rpRedirect?: string };

  // Token exchange (client_secret server-side) + id_token verification.
  const result = await completeLogin({
    code,
    returnedState: state,
    expectedState: state,
    expectedNonce: stash.nonce,
    codeVerifier: stash.codeVerifier,
    redirectUri: env.GOOGLE_REDIRECT_URI,
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  });
  if (!result.ok) return json({ error: `OIDC verification failed: ${result.reason}` }, 401);

  const principal: CredentialPrincipal = {
    kind: 'oidc',
    id: oidcFacetId(result.principal.iss, result.principal.sub),
    assurance: 'asserted',
    role: 'login-grade',
  };

  const { signer, directory } = await getServer(env);
  const outcome = await issueForRelyingSite(directory, signer, principal, stash.aud);
  if (outcome.status !== 'issued') {
    // 0 → bootstrap a new SA (spec 220); many → disambiguate. Demo: report.
    return json({
      status: outcome.status,
      reason: outcome.status === 'rejected' ? outcome.reason : undefined,
      oidcSubject: principal.id,
      email: result.principal.email,
    });
  }

  // §4a / CN-9: stash under a single-use code; deliver the CODE, not the token.
  const authCode = newAuthCode();
  await env.AUTH_CODES.put(`code:${authCode}`, JSON.stringify({ token: outcome.token, aud: stash.aud }), { expirationTtl: 120 });

  if (stash.rpRedirect) {
    const allow = (env.REDIRECT_URI_ALLOWLIST ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (allow.length && !validateRedirectUri(allow, stash.rpRedirect)) {
      return json({ error: 'redirect_uri not allowed (CN-1)' }, 400);
    }
    const dest = new URL(stash.rpRedirect);
    dest.searchParams.set('code', authCode);
    return new Response(null, { status: 302, headers: { location: dest.toString() } });
  }
  return json({ status: 'issued', code: authCode });
};
