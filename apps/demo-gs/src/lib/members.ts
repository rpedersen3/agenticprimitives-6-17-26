// Member creation (the demo-jp Adopter/Facilitator analog). Lets the demo create NEW people:
//   • a KC Expert — an INDIVIDUAL person agent with skills (the supply side).
//   • a GCO Organization — a person who CREATES an org that takes the GCO role (the demand side);
//     the org holds the role, the person is its signatory.
//
// v1 derives stable addresses locally (Phase 1 swaps this for real demo-sso person/org SAs created
// via Connect, exactly like demo-jp). Seeded with the default members so the board is never empty.

import { keccak256, encodePacked, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address } from '@agenticprimitives/types';
import { GCO_ORG, GCO_PERSON_EOA, KC_EOA } from './personas';

/** A GCO Organization member: a signatory PERSON who created an ORG that holds the GCO role.
 *  Two-step (mirrors demo-jp Adopter): the person connects first (`org` pending = undefined),
 *  then creates the org from inside the intranet, which fills in `orgName` + `org`. */
export interface GcoMember {
  id: string;
  signatory: string; // the connected person (their Global.Church name) — the org's signatory
  orgName: string; // the org that takes the GCO role ('' until created)
  person: Address; // the signatory's agent
  org?: Address; // the GCO org agent (the role belongs here); undefined until org-create completes
}

/** A KC Expert member: an individual person agent with skills. */
export interface KcMember {
  id: string;
  name: string;
  person: Address;
}

interface MembersDb {
  gco: GcoMember[];
  kc: KcMember[];
  activeGcoId: string;
  activeKcId: string;
  counter: number;
  /** Whether the member has passed the onboarding landing into the intranet (per role). */
  enteredGco: boolean;
  enteredKc: boolean;
}

const SEED_GCO: GcoMember = { id: 'seed-gco', signatory: 'Maria', orgName: 'Hope Church Missions Team', person: GCO_PERSON_EOA, org: GCO_ORG };
const SEED_KC: KcMember = { id: 'seed-kc', name: 'Dana — Grant & Foundation Strategy', person: KC_EOA };

const KEY = 'agenticprimitives:demo-gs:members:v1';

function seed(): MembersDb {
  return { gco: [SEED_GCO], kc: [SEED_KC], activeGcoId: SEED_GCO.id, activeKcId: SEED_KC.id, counter: 0, enteredGco: false, enteredKc: false };
}

/** Has the member passed onboarding into the intranet (per role)? */
export const isEntered = (role: 'gco' | 'kc'): boolean => (role === 'gco' ? _db.enteredGco : _db.enteredKc);
export function setEntered(role: 'gco' | 'kc', v: boolean): void {
  if (role === 'gco') _db.enteredGco = v; else _db.enteredKc = v;
  commit();
}

function load(): MembersDb {
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(KEY);
    if (raw) { try { return JSON.parse(raw) as MembersDb; } catch { /* reseed */ } }
  }
  const s = seed();
  save(s);
  return s;
}
function save(db: MembersDb): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(db));
}

let _db: MembersDb = load();
let _version = 0;
const _subs = new Set<() => void>();
function commit(): void { save(_db); _version += 1; for (const s of _subs) s(); }

export function subscribeMembers(fn: () => void): () => void { _subs.add(fn); return () => _subs.delete(fn); }
export function membersVersion(): number { return _version; }

// derive a stable, unique agent address from a creation seed
function deriveAddr(seed: string): Address {
  return privateKeyToAccount(keccak256(toBytes(seed))).address;
}
function predictOrg(custodian: Address, name: string): Address {
  return `0x${keccak256(encodePacked(['string', 'address', 'string'], ['demo-gs/org-sa/v1', custodian, name])).slice(-40)}` as Address;
}

// ── Reads ──
export const gcoMembers = (): GcoMember[] => _db.gco;
export const kcMembers = (): KcMember[] => _db.kc;
export const activeGco = (): GcoMember => _db.gco.find((m) => m.id === _db.activeGcoId) ?? _db.gco[0]!;
export const activeKc = (): KcMember => _db.kc.find((m) => m.id === _db.activeKcId) ?? _db.kc[0]!;

/** Friendly name for a created member's person/org address (directory fallback). */
export function memberName(addr?: string): string | undefined {
  if (!addr) return undefined;
  const lc = addr.toLowerCase();
  for (const m of _db.gco) {
    if (m.org && m.org.toLowerCase() === lc) return `${m.orgName} (GCO)`;
    if (m.person.toLowerCase() === lc) return `${m.signatory} (GCO signatory)`;
  }
  for (const m of _db.kc) if (m.person.toLowerCase() === lc) return `${m.name} (KC)`;
  return undefined;
}

// ── Writes ──
/** Create a GCO Organization: a signatory PERSON + the ORG they create (which holds the GCO role). */
export function createGco(signatory: string, orgName: string): GcoMember {
  const n = (_db.counter += 1);
  const person = deriveAddr(`gco-person|${signatory}|${orgName}|${n}`);
  const org = predictOrg(person, `${orgName}|${n}`);
  const m: GcoMember = { id: `gco-${n}`, signatory: signatory.trim(), orgName: orgName.trim(), person, org };
  _db.gco.unshift(m);
  _db.activeGcoId = m.id;
  commit();
  return m;
}

/** Create a KC Expert: an individual person agent with skills. */
export function createKc(name: string): KcMember {
  const n = (_db.counter += 1);
  const person = deriveAddr(`kc-person|${name}|${n}`);
  const m: KcMember = { id: `kc-${n}`, name: name.trim(), person };
  _db.kc.unshift(m);
  _db.activeKcId = m.id;
  commit();
  return m;
}

export function setActiveGco(id: string): void { _db.activeGcoId = id; commit(); }
export function setActiveKc(id: string): void { _db.activeKcId = id; commit(); }

// ── Connect-backed members (Phase 1 — real demo-sso person/org SAs) ──
// A KC connects as an INDIVIDUAL (their person SA); a GCO signatory connects + creates an ORG
// (the home deploys the org SA custodied by their ROOT credential). Deduped by SA address.

/** A KC Expert backed by a real connected person SA. */
export function createConnectedKc(name: string, person: Address): KcMember {
  _db.enteredKc = true;
  const existing = _db.kc.find((m) => m.person.toLowerCase() === person.toLowerCase());
  if (existing) { _db.activeKcId = existing.id; commit(); return existing; }
  const n = (_db.counter += 1);
  const m: KcMember = { id: `kc-c-${n}`, name, person };
  _db.kc.unshift(m);
  _db.activeKcId = m.id;
  commit();
  return m;
}

/** Step 1 of the GCO flow: the connected signatory PERSON (org still pending). The org is created
 *  in a second ceremony from inside the intranet (org-create needs an existing person), then
 *  `attachGcoOrg` fills it in — exactly like demo-jp's Adopter (connect person → create org later).
 *  `signatory` is the person's Global.Church name (used to resolve their home for org-create). */
export function createConnectedGcoPerson(signatory: string, person: Address): GcoMember {
  _db.enteredGco = true;
  const existing = _db.gco.find((m) => m.person.toLowerCase() === person.toLowerCase());
  if (existing) { _db.activeGcoId = existing.id; commit(); return existing; }
  const n = (_db.counter += 1);
  const m: GcoMember = { id: `gco-c-${n}`, signatory, orgName: '', person };
  _db.gco.unshift(m);
  _db.activeGcoId = m.id;
  commit();
  return m;
}

/** Step 2 of the GCO flow: the org-create ceremony returned the deployed org SA — attach it to the
 *  active GCO member (the person who just created it), giving the org the GCO role. */
export function attachGcoOrg(orgName: string, org: Address): GcoMember {
  const m = activeGco();
  m.orgName = orgName;
  m.org = org;
  commit();
  return m;
}
