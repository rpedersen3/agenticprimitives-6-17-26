// POST /connect/with-delegation { name, aud, delegation, credentialIdDigest, challenge, signature }
// → sign in as the PERSON via a scoped delegation (ADR-0019). The relying site is a DELEGATE
// of the person SA, never a custodian. We verify, fail-closed:
//   1. name resolves on-chain to the person agent, and delegation.delegator == that agent;
//   2. the PERSON SA signed the delegation (ERC-1271 over hashDelegation);
//   3. the delegation is NOT revoked (DelegationManager.isRevoked);
//   4. the caller controls the DELEGATE SA (its ERC-1271 verifies the site passkey over the
//      single-use challenge), and delegate == delegation.delegate.
// On success → a SCOPED (login-grade) AgentSession whose `sub` is the person.
import { mintAgentSession } from '@agenticprimitives/connect';
import { AgentAccountClient } from '@agenticprimitives/agent-account';
import { AgentNamingClient } from '@agenticprimitives/agent-naming';
import { hashDelegation } from '@agenticprimitives/delegation';
import { toCanonicalAgentId } from '@agenticprimitives/identity-directory-adapters';
import type { Address, CredentialPrincipal, Hex } from '@agenticprimitives/types';
import { createPublicClient, http } from 'viem';
import { getServer, json, type FnContext } from '../_lib/server-broker';
import { fromWire, type DelegationWire } from '../../src/lib/delegation';
import { CHAIN_ID, CONTRACTS, DEFAULT_RPC_URL } from '../../src/lib/chain';

function fullName(name: string): string {
  const n = name.trim().toLowerCase();
  return n.endsWith('.demo.agent') ? n : `${n.replace(/\.+$/, '')}.demo.agent`;
}

const IS_REVOKED_ABI = [
  { type: 'function', name: 'isRevoked', stateMutability: 'view', inputs: [{ name: 'hash', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
] as const;

export const onRequestPost = async ({ request, env }: FnContext): Promise<Response> => {
  const body = (await request.json().catch(() => null)) as
    | { name?: string; aud?: string; delegation?: DelegationWire; credentialIdDigest?: string; challenge?: string; signature?: string }
    | null;
  if (!body?.name || !body.aud || !body.delegation || !body.challenge || !body.signature) {
    return json({ error: 'name, aud, delegation, challenge, signature required' }, 400);
  }
  const iss = new URL(request.url).origin;
  const rpcUrl = env.RPC_URL ?? DEFAULT_RPC_URL;

  // Single-use challenge.
  const cKey = `pkchallenge:${body.challenge}`;
  if (!(await env.AUTH_CODES.get(cKey))) return json({ error: 'unknown or expired challenge' }, 400);
  await env.AUTH_CODES.delete(cKey);

  const name = fullName(body.name);
  const naming = new AgentNamingClient({
    rpcUrl,
    chainId: CHAIN_ID,
    registry: CONTRACTS.agentNameRegistry,
    universalResolver: CONTRACTS.agentNameUniversalResolver,
  });
  const person = await naming.resolveName(name);
  if (!person) return json({ error: `no workspace named "${name}"` }, 404);

  const d = fromWire(body.delegation);
  if (d.delegator.toLowerCase() !== person.toLowerCase()) {
    return json({ error: 'delegation is not from this agent' }, 403);
  }

  const accounts = new AgentAccountClient({
    rpcUrl,
    chainId: CHAIN_ID,
    entryPoint: CONTRACTS.entryPoint,
    factory: CONTRACTS.agentAccountFactory,
  });

  // (2) the PERSON SA signed the delegation (ERC-1271 over the EIP-712 delegation hash).
  const dHash = hashDelegation(d, CHAIN_ID, CONTRACTS.delegationManager);
  if (!(await accounts.isValidSignature(person, dHash, d.signature))) {
    return json({ error: 'delegation signature invalid (not signed by this agent)' }, 403);
  }

  // (3) not revoked.
  try {
    const pub = createPublicClient({ transport: http(rpcUrl) });
    const revoked = (await pub.readContract({
      address: CONTRACTS.delegationManager,
      abi: IS_REVOKED_ABI,
      functionName: 'isRevoked',
      args: [dHash],
    })) as boolean;
    if (revoked) return json({ error: 'delegation has been revoked' }, 403);
  } catch (e) {
    return json({ error: 'could not check revocation', detail: String(e) }, 502); // fail-closed
  }

  // (4) the caller controls the DELEGATE SA (its ERC-1271 verifies the site passkey over the
  //     single-use challenge), and that SA is exactly the delegation's delegate.
  const delegate = d.delegate;
  if (!(await accounts.isValidSignature(delegate, body.challenge as Hex, body.signature as Hex))) {
    return json({ error: 'you do not control the delegate account for this site' }, 403);
  }

  // Scoped (login-grade) session for the PERSON. NOT custody-grade: a delegated session can
  // act within caveats but never rotate credentials / change custody (ADR-0017 / ADR-0019).
  const principal: CredentialPrincipal = {
    kind: 'passkey',
    id: delegate as Address,
    assurance: 'asserted',
    role: 'login-grade',
  };
  const sub = toCanonicalAgentId(CHAIN_ID, person);
  const { signer } = await getServer(env);
  const token = await mintAgentSession(
    { sub, principal, assurance: 'asserted', aud: body.aud, iss, ttlSeconds: 3600 },
    signer,
  );
  return json({ status: 'issued', token, name });
};
