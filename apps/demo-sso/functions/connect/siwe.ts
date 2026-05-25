// POST /connect/siwe { message, signature, aud } → resolve the EOA to its
// canonical agent and issue an AgentSession, or signal bootstrap.
//
// SIWE is verified IN THIS FUNCTION (connect-auth ECDSA path) — no demo-a2a
// round-trip needed for login. The nonce is single-use (KV), the domain must be
// this Connect origin, and the recovered EOA becomes a `siwe-eoa` credential
// (custody-grade — an EOA custodian). Resolution + on-chain `isCustodian` confirm
// (real-directory) decide issued-vs-bootstrap. The session is custody-grade only
// when the on-chain custody check passes.
import { verify as verifySiwe, parseMessage } from '@agenticprimitives/connect-auth/siwe';
import type { CredentialPrincipal, Hex } from '@agenticprimitives/types';
import { getServer, json, type FnContext } from '../_lib/server-broker';
import { issueForRelyingSite } from '../../src/lib/broker-core';

export const onRequestPost = async ({ request, env }: FnContext): Promise<Response> => {
  const body = (await request.json().catch(() => null)) as
    | { message?: string; signature?: string; aud?: string }
    | null;
  if (!body?.message || !body.signature || !body.aud) {
    return json({ error: 'message, signature, aud required' }, 400);
  }
  const url = new URL(request.url);
  const iss = url.origin;

  // Single-use nonce (consume before verifying signature).
  let parsedNonce: string;
  try {
    parsedNonce = parseMessage(body.message).nonce;
  } catch {
    return json({ error: 'malformed SIWE message' }, 400);
  }
  const nonceKey = `nonce:${parsedNonce}`;
  if (!(await env.AUTH_CODES.get(nonceKey))) return json({ error: 'unknown or expired nonce' }, 400);
  await env.AUTH_CODES.delete(nonceKey);

  const v = verifySiwe(body.message, body.signature as Hex, {
    allowedDomains: [url.host],
    expectedNonce: parsedNonce,
  });
  if (!v.ok) return json({ error: `SIWE verify failed: ${v.reason}` }, 401);

  const principal: CredentialPrincipal = {
    kind: 'siwe-eoa',
    id: v.address,
    assurance: 'onchain-confirmed',
    role: 'custody-grade',
  };
  const { signer, directory } = await getServer(env);
  const outcome = await issueForRelyingSite(directory, signer, principal, body.aud, iss);
  if (outcome.status === 'issued') return json({ status: 'issued', token: outcome.token });
  // 0 agents -> bootstrap (deploy a person SA); many -> disambiguate.
  return json({
    status: outcome.status,
    address: v.address,
    reason: outcome.status === 'rejected' ? outcome.reason : undefined,
  });
};
