// Personas for demo-gs (spec 250) — a clean mirror of demo-jp's role model.
//
//   MEMBERS (the two parties — connected people in real life; v1 simulates them):
//     • GCO Organization (demand)  — the GCO role belongs to an ORGANIZATION, not a person: a connected
//       person CREATES an org (e.g. Hope Church Missions Team) that takes the "Great Commission
//       Organization" role and posts skill Needs; the person is its signatory.  [≈ demo-jp Adopter
//       creating + acting as their adopter org]
//     • KC Expert (supply)         — a Kingdom Consultant who publishes an expertise Offering.
//                                                                              [≈ demo-jp Facilitator]
//   OPERATORS (deterministic, swap-only — like demo-jp's Jill/Pete):
//     • Jane / Global Switchboard  — the BROKER (matches Needs ↔ Offerings).   [≈ demo-jp JP/Jill]
//     • Pete / Global Church       — the ISSUER (issues the connection agreement). UNCHANGED from
//                                    demo-jp; Global Church is an org, NOT a GCO.  [≈ demo-jp Global Church]
//
// v1 is chain-decoupled, so org "SA" addresses are derived deterministically from the custodian EOA.

import { keccak256, encodePacked } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address } from '@agenticprimitives/types';
import type { AgentId } from '../domain/gs-types';

export type Persona = 'gco' | 'kc' | 'jane' | 'pete';

/** The two member roles (the parties). */
export const MEMBER_PERSONAS: Persona[] = ['gco', 'kc'];
/** The two operator roles (broker + issuer). */
export const OPERATOR_PERSONAS: Persona[] = ['jane', 'pete'];

export interface PersonaMeta {
  persona: Persona;
  label: string;
  org: string;
  blurb: string;
  glyph: string;
}

export const PERSONA_META: Record<Persona, PersonaMeta> = {
  gco: {
    persona: 'gco',
    label: 'GCO Org',
    org: 'Hope Church Missions Team',
    blurb: 'An ORGANIZATION that holds the GCO (Great Commission Organization) role — the demand side. A connected person creates the org (e.g. Hope Church Missions Team) and acts as its signatory; the org posts the skill Needs.',
    glyph: '🙏',
  },
  kc: {
    persona: 'kc',
    label: 'KC Expert',
    org: 'Kingdom Consultant',
    blurb: 'A Kingdom Consultant (the supply side). Publishes an expertise Offering and accepts / declines connection requests.',
    glyph: '🧰',
  },
  jane: {
    persona: 'jane',
    label: 'Jane',
    org: 'Global Switchboard (broker)',
    blurb: 'Custodian of the broker org. Sees all Needs + Offerings, runs matching, manages connections, sees the public signal.',
    glyph: '🎛️',
  },
  pete: {
    persona: 'pete',
    label: 'Pete',
    org: 'Global Church (issuer)',
    blurb: 'Custodian of the issuer org (the same Global Church org as demo-jp — NOT a GCO). Issues the connection agreement once a match is confirmed.',
    glyph: '⛪',
  },
};

const SEEDS: Record<'pete' | 'jane' | 'gcoPerson' | 'kc', string> = {
  pete: 'a11ce', // Global Church custodian (same EOA as demo-jp's Pete)
  jane: 'face1', // Global Switchboard custodian
  gcoPerson: '5af3', // the GCO signatory ("Maria"), who custodies the GCO org
  kc: 'c0ffee', // the KC Expert person
};

function pkOf(seed: string): `0x${string}` {
  return `0x${seed.padStart(64, '0')}` as `0x${string}`;
}
function eoa(seed: string): Address {
  return privateKeyToAccount(pkOf(seed)).address;
}

/** A key-bearing custodian (the EOA that controls an SA + signs its vault delegation, spec 252 §3).
 *  demo-gs's operators are deterministic (like demo-jp's Jill/Pete), so the broker vault works with
 *  no Connect. Matches `chain.ts` `Signer`. The private key stays in the demo browser — testnet only. */
export interface Custodian { name: string; address: Address; privateKey: `0x${string}` }
function custodian(name: string, seed: string): Custodian {
  const privateKey = pkOf(seed);
  return { name, address: privateKeyToAccount(privateKey).address, privateKey };
}

/** Member people. */
export const GCO_PERSON_EOA: Address = eoa(SEEDS.gcoPerson); // the GCO signatory
export const KC_EOA: Address = eoa(SEEDS.kc); // the KC Expert
/** Operator custodians. */
export const PETE_EOA: Address = eoa(SEEDS.pete); // Global Church custodian
export const JANE_EOA: Address = eoa(SEEDS.jane); // Global Switchboard custodian

/** Key-bearing operator custodians (sign the broker / issuer vault delegations). */
export const JANE_CUSTODIAN: Custodian = custodian('jane', SEEDS.jane);
export const PETE_CUSTODIAN: Custodian = custodian('pete', SEEDS.pete);

const ORG_NS = 'demo-gs/org-sa/v1';
function predictOrg(custodian: Address, name: string): Address {
  const digest = keccak256(encodePacked(['string', 'address', 'string'], [ORG_NS, custodian, name]));
  return `0x${digest.slice(-40)}` as Address;
}

/** A GCO Organization instance (the demand side), custodied by its signatory. */
export const GCO_ORG: Address = predictOrg(GCO_PERSON_EOA, 'hope-church-missions-team');
/** The broker org (Global Switchboard), custodied by Jane. */
export const SWITCHBOARD_ORG: Address = predictOrg(JANE_EOA, 'global-switchboard');
/** The issuer org (Global Church — NOT a GCO), custodied by Pete. Same as demo-jp. */
export const GLOBAL_CHURCH_ORG: Address = predictOrg(PETE_EOA, 'global-church');

export const CHAIN_ID = 84532;
export const caip10 = (addr: Address): AgentId => `eip155:${CHAIN_ID}:${addr}` as AgentId;

/** The person + org the active persona acts as / for. */
export function actingAgents(p: Persona): { person: Address; org?: Address } {
  switch (p) {
    case 'gco':
      return { person: GCO_PERSON_EOA, org: GCO_ORG };
    case 'kc':
      return { person: KC_EOA };
    case 'jane':
      return { person: JANE_EOA, org: SWITCHBOARD_ORG };
    case 'pete':
      return { person: PETE_EOA, org: GLOBAL_CHURCH_ORG };
  }
}

const KEY = 'agenticprimitives:demo-gs:persona';

export function loadPersona(): Persona | null {
  if (typeof localStorage === 'undefined') return null;
  const v = localStorage.getItem(KEY) as Persona | null;
  return v && v in PERSONA_META ? v : null;
}
export function savePersona(p: Persona): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, p);
}
