// Wave 2 (spec 252 §7): member-owned data lives in each MEMBER's own per-agent vault; the broker
// (Switchboard / Jane) reads it ONLY through a delegation the member granted at Connect. Ports
// demo-jp's vault.ts pattern (storeMemberGrant/loadMemberGrants + *WithDelegation member records).
//
// Least-privilege: a connected member touches only its OWN vault; Jane sees a member's data only
// because that member delegated read access to the Switchboard delegate. The MCP vault is the SOLE
// source of truth for the member registry + member-owned records — none of it lives in the browser
// (no localStorage operational blob); every read/write below flows through `vault-client.ts` to the
// demo-a2a `/a2a/mcp/vault/*` proxy.

import type { Address } from '@agenticprimitives/types';
import type { ExpertOffering, GcoNeedIntent } from '../domain/gs-types';
import type { DelegationWire } from './delegation';
import { vaultList, vaultRead, vaultReadWithDelegation, vaultWrite, vaultWriteWithDelegation } from './vault-client';
import { switchboardVaultOwner } from './onchain';
import { isContractDeployed } from './chain';

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

/** Soft-delete (tombstone) a member from Jane's registry. Used to self-heal a member whose stored
 *  grant can never validate again (see {@link loadBrokerView}). */
export async function unregisterMember(sa: Address): Promise<void> {
  const owner = await switchboardVaultOwner();
  await vaultWrite(owner, memberKey(sa), null);
}

/** A member read failed because the grant's signature no longer validates under the delegator SA's
 *  ERC-1271 — as opposed to a transient CSRF/network 403. demo-a2a surfaces this as `delegation_invalid`
 *  / "ERC-1271 returned 0xffffffff". Against a DEPLOYED SA this is PERMANENT: the WebAuthn/EOA signature
 *  is over an EIP-712 digest bound to a now-replaced delegationManager (a pre-redeploy grant) or an old
 *  custodian, and neither will ever change. */
function isPermanentDelegationFailure(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /delegation_invalid|ERC-1271|0xffffffff/i.test(msg);
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

/** A KC reads/writes its own expertise offering (its own vault). `maxAttempts` lets the broker survey
 *  (loadBrokerView) read with a single attempt so a stale/orphaned member grant drops without storming. */
export async function loadKcOffering(grant: DelegationWire, maxAttempts?: number): Promise<ExpertOffering | null> {
  return vaultReadWithDelegation<ExpertOffering>(grant, REC_OFFERING, maxAttempts);
}
export async function saveKcOffering(grant: DelegationWire, o: ExpertOffering): Promise<void> {
  await vaultWriteWithDelegation(grant, REC_OFFERING, o);
}

/** A GCO reads/writes its own posted needs (its org vault). `maxAttempts` lets the broker survey read
 *  with a single attempt (see loadKcOffering). */
export async function loadGcoNeeds(grant: DelegationWire, maxAttempts?: number): Promise<GcoNeedIntent[]> {
  return (await vaultReadWithDelegation<GcoNeedIntent[]>(grant, REC_NEEDS, maxAttempts)) ?? [];
}
export async function saveGcoNeeds(grant: DelegationWire, needs: GcoNeedIntent[]): Promise<void> {
  await vaultWriteWithDelegation(grant, REC_NEEDS, needs);
}

/** Jane's ENTITLED broker view: every connected member's data, each read through that member's grant. */
export async function loadBrokerView(): Promise<{ needs: GcoNeedIntent[]; offerings: ExpertOffering[] }> {
  const members = await loadMembers();
  const needs: GcoNeedIntent[] = [];
  const offerings: ExpertOffering[] = [];
  const prunes: Promise<void>[] = [];
  for (const m of members) {
    try {
      // SINGLE attempt (maxAttempts=1): this is a survey of OTHER members' established vaults, so a
      // failing grant is permanent (revoked/expired, or a grant bound to a replaced delegationManager
      // / old custodian → ERC-1271 0xffffffff). The default 4× retry would storm the discovery hydrate
      // with 403s before the catch drops the member. The user's OWN post-connect read keeps the retry.
      if (m.kind === 'gco') needs.push(...(await loadGcoNeeds(m.delegation, 1)));
      else { const o = await loadKcOffering(m.delegation, 1); if (o) offerings.push(o); }
    } catch (e) {
      // Self-heal the registry: a PERMANENT delegation failure against a DEPLOYED member SA can never
      // recover (the signature is over a now-wrong digest), so it would 403 on every hydrate forever.
      // Prune it. Guard on deployed-SA so a member whose SA is still confirming right after THEY connect
      // (transient) is left alone, and on the error CLASS so a CSRF/network 403 never deletes a member.
      if (isPermanentDelegationFailure(e)) {
        prunes.push(
          isContractDeployed(m.sa)
            .then((deployed) => (deployed ? unregisterMember(m.sa) : undefined))
            .catch(() => {/* best-effort prune; the next hydrate retries */}),
        );
      }
      /* dropped from this view regardless */
    }
  }
  // AWAIT the prunes before returning so a fast reload can't cancel an in-flight tombstone mid-write
  // (that left orphans alive across several reloads). The latency is paid only while orphans exist —
  // the registry converges to all-valid members and subsequent hydrates have nothing to prune.
  await Promise.allSettled(prunes);
  return { needs, offerings };
}
