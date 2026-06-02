// Member organization vault. The connected adopter / facilitator creates their
// own org via the Impact org-create ceremony (connect-client.startOrgCreation):
// the org Smart Agent is DEPLOYED + custodied by the user's ROOT credential at
// their Impact home — demo-jp is never a custodian, it only holds a scoped
// org→demo-jp delegation. This module persists the resulting org identity so the
// member can then act AS the org (express intent, be a party to agreements).
//
// One org per (connected person, kind). Keyed by the person's SA address so a
// different member on the same browser gets their own org.

import type { Address } from '@agenticprimitives/types';
import type { DelegationWire } from './delegation.js';

export type MemberOrgKind = 'adopter' | 'facilitator';

export interface MemberOrg {
  kind: MemberOrgKind;
  /** The connected person SA that custodies (via their ROOT credential) this org. */
  ownerPerson: Address;
  /** Org display name (the church/org label claimed in the ceremony). */
  orgName: string;
  /** The org Smart Agent address — the actor for intent/agreements. */
  orgAgent: Address;
  /** Scoped org→demo-jp delegation minted at creation (for delegated reads). */
  orgDelegation?: DelegationWire;
  createdAt: string;
}

const key = (owner: Address, kind: MemberOrgKind) =>
  `demo-jp/member-org/${kind}/${owner.toLowerCase()}`;

export function loadMemberOrg(owner: Address, kind: MemberOrgKind): MemberOrg | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(key(owner, kind));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MemberOrg;
  } catch {
    return null;
  }
}

export function saveMemberOrg(org: MemberOrg): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key(org.ownerPerson, org.kind), JSON.stringify(org));
}

export function clearMemberOrg(owner: Address, kind: MemberOrgKind): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(key(owner, kind));
}
