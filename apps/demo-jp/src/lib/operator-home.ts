// Operator home wiring (spec 247) — make Pete + Jill real, connectable person agents.
//
// Each operator's EOA custodies a PERSON SA (salt 0, person-sa.ts) and an ORG SA
// (salt 1, onchain.ts) as siblings. `setupOperatorHome` deploys + names both, then
// registers the person→org link into the operator's Connect home vault so their
// `<handle>.impact-agent.me/you` portal lists the org. The operator then signs in at
// that home with the SAME key (deep-link + sign-in-at-home), no cross-origin handoff.

import { keccak256, toBytes } from 'viem';
import { loadOrMintPersona, type PersonaName } from './personas.js';
import { personaSignHash } from './chain.js';
import { ensurePersonDeployed, type PersonChainState } from './person-sa.js';
import { ensureOrgDeployed } from './onchain.js';
import type { OrgName } from './org-personas.js';
import { registerRelatedOrg } from '../connect-client.js';
import { PLATFORM_AUTH_ORIGIN, personalAuthOrigin, nameLabel } from './domain.js';

/** Each operator governs one org (Pete → Global Church, Jill → Joshua Project). */
const OPERATOR_ORG: Record<PersonaName, { org: OrgName; orgName: string; purpose: string }> = {
  pete: { org: 'global-church', orgName: 'Global Church', purpose: 'global-church-org' },
  jill: { org: 'jp', orgName: 'Joshua Project', purpose: 'jp-broker-org' },
};

/** The operator's Connect home origin, derived from their claimed person name. */
function homeOrigin(person: PersonChainState): string {
  return person.agentName ? personalAuthOrigin(nameLabel(person.agentName)) : PLATFORM_AUTH_ORIGIN;
}

/** The `<handle>.impact-agent.me/you` portal URL the operator opens to connect. */
export function operatorHomeUrl(person: PersonChainState): string {
  return `${homeOrigin(person)}/you`;
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
    homeOrigin(person),
    { person: person.saAddress, orgAgent: orgState.saAddress, orgName, purpose, requestedBy: 'demo-jp' },
    sig,
  );

  return person;
}
