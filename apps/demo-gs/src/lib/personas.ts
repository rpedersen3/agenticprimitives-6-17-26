// Personas for demo-gs (spec 250). Mirrors demo-jp's deterministic operator model so the demo
// survives a cleared browser. v1 is chain-decoupled, so the org "SA" addresses are derived
// deterministically (the same predict-from-custodian shape demo-jp used pre-factory) rather than
// from a live AgentAccount factory.
//
//   • Pete  → Global Church (a GCO, the demand side) — REUSES demo-jp's Pete EOA seed ('a11ce').
//   • Jane  → Global Switchboard (the broker) — mirrors Jill/JP, new seed.
//   • Expert→ a KC member (the supply side) — connected member, picks a fixture KC identity.

import { keccak256, encodePacked } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address } from '@agenticprimitives/types';
import type { AgentId } from '../domain/gs-types';

export type Persona = 'pete' | 'jane' | 'expert';

export const OPERATOR_PERSONAS: Persona[] = ['pete', 'jane'];

export interface PersonaMeta {
  persona: Persona;
  label: string;
  org: string;
  blurb: string;
  glyph: string;
}

export const PERSONA_META: Record<Persona, PersonaMeta> = {
  pete: {
    persona: 'pete',
    label: 'Pete',
    org: 'Global Church (GCO)',
    blurb: 'Signatory for a Global Christian Org. Posts skill Needs, reviews matches, requests connections.',
    glyph: '⛪',
  },
  jane: {
    persona: 'jane',
    label: 'Jane',
    org: 'Global Switchboard (broker)',
    blurb: 'Custodian of the broker org. Sees all needs + offerings, runs matching, manages connections, sees the public signal.',
    glyph: '🎛️',
  },
  expert: {
    persona: 'expert',
    label: 'Expert',
    org: 'KC member',
    blurb: 'A Kingdom Consultant. Publishes an expertise Offering and accepts / declines connection requests.',
    glyph: '🧰',
  },
};

const SEEDS: Record<'pete' | 'jane', string> = {
  pete: 'a11ce', // same as demo-jp's Pete
  jane: 'face1', // new broker custodian
};

function eoa(seed: string): Address {
  const pk = `0x${seed.padStart(64, '0')}` as `0x${string}`;
  return privateKeyToAccount(pk).address;
}

/** The deterministic custodian EOA for an operator persona. */
export const PETE_EOA: Address = eoa(SEEDS.pete);
export const JANE_EOA: Address = eoa(SEEDS.jane);

const ORG_NS = 'demo-gs/org-sa/v1';

/** Predict a stable org SA address from the custodian EOA (mirrors demo-jp's pre-factory shape). */
function predictOrg(custodian: Address, name: string): Address {
  const digest = keccak256(encodePacked(['string', 'address', 'string'], [ORG_NS, custodian, name]));
  return `0x${digest.slice(-40)}` as Address;
}

/** The GCO org agent (Global Church), custodied by Pete. */
export const GCO_ORG: Address = predictOrg(PETE_EOA, 'global-church');
/** The broker org agent (Global Switchboard), custodied by Jane. */
export const SWITCHBOARD_ORG: Address = predictOrg(JANE_EOA, 'global-switchboard');

export const CHAIN_ID = 84532;
export const caip10 = (addr: Address): AgentId => `eip155:${CHAIN_ID}:${addr}` as AgentId;

/** The agent the active persona acts as / for (for store filtering + provenance). */
export function actingAgents(p: Persona): { person: Address; org?: Address } {
  switch (p) {
    case 'pete':
      return { person: PETE_EOA, org: GCO_ORG };
    case 'jane':
      return { person: JANE_EOA, org: SWITCHBOARD_ORG };
    case 'expert':
      // The connected KC member; in v1 the demo uses a single fixture KC identity (KC_EOA).
      return { person: KC_EOA };
  }
}

/** A single fixture KC person used by the "Expert" persona in v1 (Phase 1 swaps in demo-sso). */
export const KC_EOA: Address = eoa('c0ffee');

const KEY = 'agenticprimitives:demo-gs:persona';

export function loadPersona(): Persona | null {
  if (typeof localStorage === 'undefined') return null;
  const v = localStorage.getItem(KEY) as Persona | null;
  return v && v in PERSONA_META ? v : null;
}
export function savePersona(p: Persona): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, p);
}
