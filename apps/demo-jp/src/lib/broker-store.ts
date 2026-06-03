// Broker + issuer working state (Wave 8.12) — the off-chain vault rows the
// Jill (broker) and Pete (issuer) dashboards operate on. Per D-28 the intent +
// match layers are vault-only in W1; only the commitment-and-onward path
// crosses on-chain. This module is that vault.
//
// Shapes mirror IA §5.9 (JP broker vault) + §5.8 (intent vault), trimmed to the
// Direct-Lane W1 subset (D-27).

import type { Address, Hex } from '@agenticprimitives/types';
import { vaultRead, vaultWrite, type VaultOwner } from './vault-client.js';
import { orgChainState } from './onchain.js';
import { loadOrMintOrgPersona } from './org-personas.js';

export type IntentDirection = 'receive' | 'give';

/** A board intent — the demo's tangible Intent row (IA §5.8). */
export interface BoardIntent {
  id: string;
  direction: IntentDirection;
  /** 'facilitator' need/offer (Direct Lane only in W1). */
  object: 'facilitator';
  fpgId: string;
  adopterType?: string;
  expressedBy: Address;
  label: string;
  createdAt: string;
  state: 'expressed' | 'acknowledged' | 'matched';
}

/** A JP-brokered match between a receive + give intent (IA §3b.4 IntentMatch). */
export interface BoardMatch {
  id: string;
  receiveIntentId: string;
  giveIntentId: string;
  matchScore: number;
  rationale: string;
  brokeredAt: string;
  /** Party SAs the resulting agreement is between. */
  adopterParty: Address;
  facilitatorParty: Address;
  fpgId: string;
  /** Set once Pete registers the agreement on chain. */
  committed?: boolean;
}

/** A pending agreement draft handed from JP (broker) to Global Church (issuer)
 *  — D-8: JP DOES see drafts; routes them to the issuer (holding cell). */
export interface AgreementDraft {
  id: string;
  matchId: string;
  adopterParty: Address;
  facilitatorParty: Address;
  fpgId: string;
  termsText: string;
  capabilityList: string[];
  draftedAt: string;
}

/** A registered on-chain agreement (issuance log row, IA §5.2). */
export interface IssuanceRow {
  agreementCommitment: Hex;
  adopterParty: Address;
  facilitatorParty: Address;
  fpgId: string;
  registeredAt: string;
  registerTxHash?: Hex;
  /** Set once the joint assertion is published. */
  jointAssertionTxHash?: Hex;
  jointAssertionUid?: Hex;
}

/** A published Association (JP → org), IA §5.3. */
export interface AssociationRow {
  uid: Hex;
  subjectOrg: Address;
  associationKind: 'facilitator' | 'adopter';
  fpgIds: string[];
  issuedAt: string;
  txHash?: Hex;
}

// All broker working state lives in JP Org's own MCP vault (spec 247) — JP is the
// data custodian (spec 236), so these are JP's records, keyed by record_type and
// written/read with Jill's custodian key. The vault is the single source; React
// state in the dashboards is just the rendered view.
const RT = {
  intents: 'jp:broker:intents',
  matches: 'jp:broker:matches',
  drafts: 'jp:broker:drafts',
  issuance: 'jp:broker:issuance',
  associations: 'jp:broker:associations',
} as const;

/** The JP Org vault owner (Jill custodian) — null until JP is deployed (the broker
 *  dashboard auto-provisions it on mount, so it's cached by the time of any read). */
function brokerVault(): VaultOwner | null {
  const s = orgChainState('jp');
  if (!s?.deployed) return null;
  return { owner: s.saAddress, custodian: loadOrMintOrgPersona('jp').custodian };
}

async function loadRows<T>(rt: string): Promise<T[]> {
  const jp = brokerVault();
  if (!jp) return [];
  return (await vaultRead<T[]>(jp, rt)) ?? [];
}
async function saveRows<T>(rt: string, rows: T[]): Promise<void> {
  const jp = brokerVault();
  if (!jp) throw new Error('JP org not deployed — cannot write broker vault');
  await vaultWrite(jp, rt, rows);
}

export const loadIntents = () => loadRows<BoardIntent>(RT.intents);
export const saveIntents = (r: BoardIntent[]) => saveRows(RT.intents, r);
export const loadMatches = () => loadRows<BoardMatch>(RT.matches);
export const saveMatches = (r: BoardMatch[]) => saveRows(RT.matches, r);
export const loadDrafts = () => loadRows<AgreementDraft>(RT.drafts);
export const saveDrafts = (r: AgreementDraft[]) => saveRows(RT.drafts, r);
export const loadIssuance = () => loadRows<IssuanceRow>(RT.issuance);
export const saveIssuance = (r: IssuanceRow[]) => saveRows(RT.issuance, r);
export const loadAssociations = () => loadRows<AssociationRow>(RT.associations);
export const saveAssociations = (r: AssociationRow[]) => saveRows(RT.associations, r);

export async function resetBrokerStore(): Promise<void> {
  await Promise.all(Object.values(RT).map((rt) => saveRows(rt, [])));
}

/** Stable-ish id helper that avoids Math.random (kept deterministic per call site
 *  by mixing a caller seed + the current store length). */
export function nextId(prefix: string, n: number): string {
  return `${prefix}_${n}_${Date.now().toString(36)}`;
}
