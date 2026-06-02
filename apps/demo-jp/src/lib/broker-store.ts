// Broker + issuer working state (Wave 8.12) — the off-chain vault rows the
// Jill (broker) and Pete (issuer) dashboards operate on. Per D-28 the intent +
// match layers are vault-only in W1; only the commitment-and-onward path
// crosses on-chain. This module is that vault.
//
// Shapes mirror IA §5.9 (JP broker vault) + §5.8 (intent vault), trimmed to the
// Direct-Lane W1 subset (D-27).

import type { Address, Hex } from '@agenticprimitives/types';

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

const K = {
  intents: 'demo-jp/broker/intents',
  matches: 'demo-jp/broker/matches',
  drafts: 'demo-jp/broker/drafts',
  issuance: 'demo-jp/broker/issuance',
  associations: 'demo-jp/broker/associations',
} as const;

function load<T>(key: string): T[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as T[];
  } catch {
    return [];
  }
}
function save<T>(key: string, rows: T[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(rows));
}

export const loadIntents = () => load<BoardIntent>(K.intents);
export const saveIntents = (r: BoardIntent[]) => save(K.intents, r);
export const loadMatches = () => load<BoardMatch>(K.matches);
export const saveMatches = (r: BoardMatch[]) => save(K.matches, r);
export const loadDrafts = () => load<AgreementDraft>(K.drafts);
export const saveDrafts = (r: AgreementDraft[]) => save(K.drafts, r);
export const loadIssuance = () => load<IssuanceRow>(K.issuance);
export const saveIssuance = (r: IssuanceRow[]) => save(K.issuance, r);
export const loadAssociations = () => load<AssociationRow>(K.associations);
export const saveAssociations = (r: AssociationRow[]) => save(K.associations, r);

export function resetBrokerStore(): void {
  if (typeof localStorage === 'undefined') return;
  for (const key of Object.values(K)) localStorage.removeItem(key);
}

/** Stable-ish id helper that avoids Math.random (kept deterministic per call site
 *  by mixing a caller seed + the current store length). */
export function nextId(prefix: string, n: number): string {
  return `${prefix}_${n}_${Date.now().toString(36)}`;
}
