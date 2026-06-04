// Wave 2 (spec 252 §7): member-owned data lives in each MEMBER's own per-agent vault; the broker
// (Switchboard / Jane) reads it ONLY through a delegation the member granted at Connect. Ports
// demo-jp's vault.ts pattern (storeMemberGrant/loadMemberGrants + *WithDelegation member records).
//
// Least-privilege: a connected member touches only its OWN vault; Jane sees a member's data only
// because that member delegated read access to the Switchboard delegate. No operational blob.

import type { Address } from '@agenticprimitives/types';
import type { ExpertOffering, GcoNeedIntent } from '../domain/gs-types';
import type { DelegationWire } from './delegation';
import { vaultList, vaultRead, vaultReadWithDelegation, vaultWrite, vaultWriteWithDelegation } from './vault-client';
import { switchboardVaultOwner } from './onchain';

// ── Member registry — in JANE's broker vault (the cross-browser single source of who's connected) ──
export type MemberKind = 'kc' | 'gco';

/** A connected member + the grant Jane reads their vault through. Lives at `gs:member:<sa>` in Jane's vault. */
export interface MemberEntry {
  kind: MemberKind;
  /** The member's SA whose vault holds their data (KC person SA, or GCO org SA). */
  sa: Address;
  name: string;
  /** GCO only: the org display name + the signatory person. */
  orgName?: string;
  signatory?: string;
  /** member SA → Switchboard delegate, signed by the member at their home. Jane reads via this. */
  delegation: DelegationWire;
}

const MEMBER_PREFIX = 'gs:member:';
const memberKey = (sa: Address) => `${MEMBER_PREFIX}${sa.toLowerCase()}`;

/** Register (or update) a connected member in Jane's broker vault. */
export async function registerMember(e: MemberEntry): Promise<void> {
  const owner = await switchboardVaultOwner();
  await vaultWrite(owner, memberKey(e.sa), e);
}

/** All connected members Jane knows about (with the grant to read each one's vault). */
export async function loadMembers(): Promise<MemberEntry[]> {
  const owner = await switchboardVaultOwner();
  const recs = await vaultList(owner);
  const out: MemberEntry[] = [];
  for (const r of recs) {
    if (!r.record_type.startsWith(MEMBER_PREFIX)) continue;
    const e = await vaultRead<MemberEntry>(owner, r.record_type);
    if (e) out.push(e);
  }
  return out;
}

// ── Member-owned data — in the MEMBER's OWN vault, read/written via the member's grant ──
const REC_OFFERING = 'gs:offering'; // KC person's vault
const REC_NEEDS = 'gs:needs'; // GCO org's vault

/** A KC reads/writes its own expertise offering (its own vault). */
export async function loadKcOffering(grant: DelegationWire): Promise<ExpertOffering | null> {
  return vaultReadWithDelegation<ExpertOffering>(grant, REC_OFFERING);
}
export async function saveKcOffering(grant: DelegationWire, o: ExpertOffering): Promise<void> {
  await vaultWriteWithDelegation(grant, REC_OFFERING, o);
}

/** A GCO reads/writes its own posted needs (its org vault). */
export async function loadGcoNeeds(grant: DelegationWire): Promise<GcoNeedIntent[]> {
  return (await vaultReadWithDelegation<GcoNeedIntent[]>(grant, REC_NEEDS)) ?? [];
}
export async function saveGcoNeeds(grant: DelegationWire, needs: GcoNeedIntent[]): Promise<void> {
  await vaultWriteWithDelegation(grant, REC_NEEDS, needs);
}

/** Jane's ENTITLED broker view: every connected member's data, each read through that member's grant. */
export async function loadBrokerView(): Promise<{ needs: GcoNeedIntent[]; offerings: ExpertOffering[] }> {
  const members = await loadMembers();
  const needs: GcoNeedIntent[] = [];
  const offerings: ExpertOffering[] = [];
  for (const m of members) {
    try {
      if (m.kind === 'gco') needs.push(...(await loadGcoNeeds(m.delegation)));
      else { const o = await loadKcOffering(m.delegation); if (o) offerings.push(o); }
    } catch { /* a revoked/expired grant simply drops that member from the view */ }
  }
  return { needs, offerings };
}
