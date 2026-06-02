// Global Church + JP — the Organization Agent personas custodied by Pete + Jill.
//
// IA §0–§1: every org agent IS its ERC-4337 SA address per ADR-0010. For the
// demo we *derive* a deterministic SA address from the custodian EOA so the
// flow can simulate the full substrate path without a live AgentAccount
// factory deploy. Real deployments would call the factory's `getAddress(...)`
// CREATE2 prediction; we mirror that pattern locally.

import { keccak256, encodePacked } from 'viem';
import type { Address } from '@agenticprimitives/types';
import { loadOrMintPersona, type PersonaState, type PersonaName } from './personas.js';

export type OrgName = 'global-church' | 'jp';

const OWNER: Record<OrgName, PersonaName> = {
  'global-church': 'pete',
  jp: 'jill',
};

export interface OrgPersona {
  name: OrgName;
  /** The deterministic SA address (would come from the AgentAccount factory). */
  saAddress: Address;
  /** The EOA-backed custodian persona. */
  custodian: PersonaState;
}

const NAMESPACE = 'demo-jp/org-sa/v1';

/** Predict an SA address from the custodian EOA — mirrors CREATE2 prediction shape. */
function predictSaAddress(custodian: Address, name: OrgName): Address {
  const digest = keccak256(encodePacked(['string', 'address', 'string'], [NAMESPACE, custodian, name]));
  // Take the trailing 20 bytes as the predicted SA address
  return `0x${digest.slice(-40)}` as Address;
}

export function loadOrMintOrgPersona(name: OrgName): OrgPersona {
  const custodian = loadOrMintPersona(OWNER[name]);
  const saAddress = predictSaAddress(custodian.address, name);
  return { name, saAddress, custodian };
}

/** Convenience accessors used throughout the demo. */
export function getGlobalChurch(): OrgPersona {
  return loadOrMintOrgPersona('global-church');
}

export function getJP(): OrgPersona {
  return loadOrMintOrgPersona('jp');
}
