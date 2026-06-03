// Operator home wiring (spec 247) — make Pete + Jill real, connectable person agents.
//
// Each operator's EOA custodies a PERSON SA (salt 0, person-sa.ts) and an ORG SA
// (salt 1, onchain.ts) as siblings. `setupOperatorHome` deploys + names both, then
// registers the person→org link into the operator's Connect home vault so their
// `<handle>.impact-agent.me/you` portal lists the org. The operator then signs in at
// that home with the SAME key (deep-link + sign-in-at-home), no cross-origin handoff.

import { keccak256, toBytes } from 'viem';
import { buildMessage } from '@agenticprimitives/connect-auth/siwe';
import { loadOrMintPersona, type PersonaName } from './personas.js';
import { personaSignHash, personaSignMessage, CHAIN_ID } from './chain.js';
import { ensurePersonDeployed, type PersonChainState } from './person-sa.js';
import { ensureOrgDeployed } from './onchain.js';
import type { OrgName } from './org-personas.js';
import { registerRelatedOrg } from '../connect-client.js';
import { CONNECT_DOMAIN } from './domain.js';

/** The canonical Connect platform home (`www.<connect-domain>`) — the no-redirect,
 *  CORS-enabled host. The operator signs in HERE; the session is shared across
 *  `*.impact-agent.me` (and the related-org KV is one store), so `/you` shows their
 *  orgs + delegations regardless of whether a per-handle subdomain is provisioned. */
const CONNECT_HOME = `https://www.${CONNECT_DOMAIN}`;

/** Each operator governs one org (Pete → Global Church, Jill → Joshua Project). */
const OPERATOR_ORG: Record<PersonaName, { org: OrgName; orgName: string; purpose: string }> = {
  pete: { org: 'global-church', orgName: 'Global Church', purpose: 'global-church-org' },
  jill: { org: 'jp', orgName: 'Joshua Project', purpose: 'jp-broker-org' },
};

/** One-click SIWE handoff (spec 247): sign the operator in at the Connect platform
 *  home (`impact-agent.me`) with their demo-jp key, returning the `/you` URL carrying
 *  the minted session in the fragment. The home's session provider reads
 *  `#session=<token>` and signs them in, where the "Received by your organizations"
 *  panel shows their org's delegations. Requires the person SA deployed (setup first). */
export async function operatorSignInUrl(person: PersonChainState): Promise<string> {
  const persona = loadOrMintPersona(person.name);
  const origin = CONNECT_HOME;
  const host = new URL(origin).host;

  const nonceRes = await fetch(`${origin}/connect/nonce`);
  if (!nonceRes.ok) throw new Error(`could not reach your home (nonce ${nonceRes.status})`);
  const { nonce } = (await nonceRes.json()) as { nonce: string };

  const message = buildMessage({
    domain: host,
    address: persona.address,
    uri: origin,
    chainId: CHAIN_ID,
    nonce,
    statement: 'Sign in to your Impact home from JP Adopt — proving you control this agent.',
  });
  const signature = await personaSignMessage(persona)(message);

  const siweRes = await fetch(`${origin}/connect/siwe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, signature, aud: 'demo-sso' }),
  });
  const body = (await siweRes.json().catch(() => ({}))) as { status?: string; token?: string; reason?: string };
  if (body.status === 'issued' && body.token) return `${origin}/you#session=${body.token}`;
  if (body.status === 'bootstrap') throw new Error('Your home agent isn’t set up yet — run “Set up your home” first.');
  throw new Error(body.reason ?? `sign-in failed (${body.status ?? siweRes.status})`);
}

/** Deploy + name the operator's person SA, ensure their org SA, and register the
 *  person→org link at their home so /you lists it. Idempotent (each step short-circuits
 *  when already done). Returns the person chain state (address + name + home URL source). */
export async function setupOperatorHome(
  name: PersonaName,
  onStep?: (s: string) => void,
): Promise<PersonChainState> {
  const persona = loadOrMintPersona(name);
  const { org, orgName, purpose } = OPERATOR_ORG[name];

  onStep?.('Setting up your person agent…');
  const person = await ensurePersonDeployed(name);

  onStep?.('Setting up your organization…');
  const orgState = await ensureOrgDeployed(org);

  onStep?.('Linking your organization to your home…');
  // Control-of-person proof — sign the fixed challenge with the person SA's custodian.
  const challenge = keccak256(toBytes(`related-orgs:write:${person.saAddress.toLowerCase()}`));
  const sig = await personaSignHash(persona)(challenge);
  await registerRelatedOrg(
    CONNECT_HOME,
    { person: person.saAddress, orgAgent: orgState.saAddress, orgName, purpose, requestedBy: 'demo-jp' },
    sig,
  );

  return person;
}
