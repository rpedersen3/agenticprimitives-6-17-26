// POST /connect/passkey { credentialIdDigest, challenge, signature, aud } →
// resolve the passkey to its canonical agent + verify proof-of-possession, then
// issue an AgentSession (or signal bootstrap).
//
// Two checks (both required): resolveByCredential confirms the passkey is a
// CURRENT custodian of the agent on-chain (hasPasskey, M2); isValidSignature
// proves the caller actually controls the passkey right now (it signed THIS
// single-use challenge). A passkey-resolved session is custody-grade.
import { AgentAccountClient } from '@agenticprimitives/agent-account';
import { addressOf } from '@agenticprimitives/identity-directory-adapters';
import type { CredentialPrincipal, Hex } from '@agenticprimitives/types';
import { getServer, json, type FnContext } from '../_lib/server-broker';
import { issueForRelyingSite } from '../../src/lib/broker-core';
import { CHAIN_ID, CONTRACTS, DEFAULT_RPC_URL } from '../../src/lib/chain';

export const onRequestPost = async ({ request, env }: FnContext): Promise<Response> => {
  const body = (await request.json().catch(() => null)) as
    | { credentialIdDigest?: string; challenge?: string; signature?: string; aud?: string }
    | null;
  if (!body?.credentialIdDigest || !body.challenge || !body.signature || !body.aud) {
    return json({ error: 'credentialIdDigest, challenge, signature, aud required' }, 400);
  }
  const iss = new URL(request.url).origin;

  // Single-use challenge.
  const key = `pkchallenge:${body.challenge}`;
  if (!(await env.AUTH_CODES.get(key))) return json({ error: 'unknown or expired challenge' }, 400);
  await env.AUTH_CODES.delete(key);

  const principal: CredentialPrincipal = {
    kind: 'passkey',
    id: body.credentialIdDigest,
    assurance: 'onchain-confirmed',
    role: 'custody-grade',
  };
  const { signer, directory } = await getServer(env);

  // Resolve (digest -> agent via KV indexer + on-chain hasPasskey confirm).
  const resolution = await directory.resolveByCredential(principal);
  if (resolution.agents.length === 0) return json({ status: 'bootstrap' });
  if (resolution.agents.length > 1) return json({ status: 'disambiguate' });
  const agent = resolution.agents[0]!.id;

  // Proof-of-possession: the registered passkey must have signed THIS challenge.
  const accounts = new AgentAccountClient({
    rpcUrl: env.RPC_URL ?? DEFAULT_RPC_URL,
    chainId: CHAIN_ID,
    entryPoint: CONTRACTS.entryPoint,
    factory: CONTRACTS.agentAccountFactory,
  });
  const valid = await accounts.isValidSignature(addressOf(agent), body.challenge as Hex, body.signature as Hex);
  if (!valid) return json({ error: 'passkey signature invalid (proof-of-possession failed)' }, 401);

  const outcome = await issueForRelyingSite(directory, signer, principal, body.aud, iss);
  if (outcome.status === 'issued') return json({ status: 'issued', token: outcome.token });
  return json({ status: outcome.status });
};
