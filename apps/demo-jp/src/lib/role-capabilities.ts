// Role capability resolver (production UX spec §7 "State Model"; §9 Role Hub). PURE — no network, no
// localStorage of its own: it derives what workspaces a connected person can open from the verified
// `MemberSession`, the Connect-returned related orgs, and the (already-loaded) JP adopter/facilitator
// records. The App owns the I/O (listRelatedOrgs + loadJp*Record); this file is only logic.
//
// Per spec §7 the full state vocabulary is { empty, record-absent, unauthorized, grant-missing,
// load-failed, ready, incomplete }. Wave 1 drives the SHELL routing (landing → connect → discovery →
// hub → workspace), so the resolver returns the subset the shell + hub branch on today:
//   • grant-missing — connected but no vault grant (can't read records at all; reconnect to refresh)
//   • load-failed   — the record read threw (vault unreachable; retry, never fall back — ADR-0013)
//   • not-started   — connected + grant, no record yet (the role can be set up)
//   • incomplete    — a record exists but onboarding setup remains
//   • ready         — onboarding complete; the workspace can open immediately
// Both adopter + facilitator are ALWAYS connectable for a connected person (role is a workspace, not a
// second account), so there is no per-role `empty`/`unauthorized` gate at the shell level — every
// connected person can enter and SET UP either role. The richer record-level states belong to the
// workspace bodies (preserved as-is in this wave).
//
// §7 resolver constraint: select a role's org by `RelatedOrgLink.purpose === orgPurpose(kind)` ONLY.
// Do NOT auto-select an unrelated stewarded org as the active JP role org (a generic stewarded org may
// be "available to link," but is never the resolved role org).

import type { RelatedOrgLink } from '../connect-client';
import { orgPurpose } from './member-org';
import type { ImpactProfile, JpAdopterRecord, JpFacilitatorRecord } from './vault';
import { isAdopterOnboardingComplete, isFacilitatorOnboardingComplete } from './vault';
import type { RoleKind } from './active-role';

export type { RoleKind } from './active-role';

/** Per-role workspace state the hub renders against. */
export type RoleState =
  | 'grant-missing' // connected but no vault grant — can't read any record (reconnect)
  | 'load-failed'   // the record read threw — vault unreachable (retry; no fallback — ADR-0013)
  | 'not-started'   // grant present, no record yet — the role can be set up
  | 'incomplete'    // a record exists but onboarding setup remains
  | 'ready';        // onboarding complete — the workspace can open now

export interface RoleCapability {
  kind: RoleKind;
  state: RoleState;
  /** The role org selected strictly by purpose tag (`orgPurpose(kind)`), or null. §7 constraint:
   *  never an unrelated stewarded org. */
  org: RelatedOrgLink | null;
  /** True once the workspace can be opened with no further setup (state `ready`). */
  ready: boolean;
}

export interface RoleCapabilities {
  /** The roles a connected person can open now with no setup (state `ready`). */
  roles: RoleKind[];
  /** Per-kind capability (always BOTH kinds, so the hub can render a setup card for the missing one). */
  byKind: Record<RoleKind, RoleCapability>;
  /** The role to land in by default, or null when nothing is ready (→ the hub chooser). */
  recommendedRole: RoleKind | null;
  /** True when more than one workspace is ready (a dual-role member can switch immediately). */
  canSwitch: boolean;
}

export interface ResolverInput {
  /** The connected member, or null (signed out → empty capabilities). */
  connected: boolean;
  /** Whether the member session carries a vault grant. */
  hasGrant: boolean;
  /** Connect-returned related orgs (purpose-tagged); [] while loading or on empty. */
  relatedOrgs: RelatedOrgLink[];
  /** The loaded Impact profile (drives onboarding-complete checks), or null if not yet loaded. */
  impact: ImpactProfile | null;
  /** The loaded JP adopter record, or null if absent / not yet loaded. */
  adopterRecord: JpAdopterRecord | null;
  /** The loaded JP facilitator record, or null if absent / not yet loaded. */
  facilitatorRecord: JpFacilitatorRecord | null;
  /** True if reading the adopter record threw (vault unreachable). */
  adopterLoadFailed?: boolean;
  /** True if reading the facilitator record threw (vault unreachable). */
  facilitatorLoadFailed?: boolean;
  /** Whether the records have finished their first load (so "absent" ≠ "still loading"). */
  recordsLoaded: boolean;
}

/** Is a JP adopter record non-empty (the role was started)? */
function adopterStarted(r: JpAdopterRecord | null): boolean {
  return !!r && (!!r.adopterType || !!r.attestations?.mou || !!r.adoption);
}

/** Is a JP facilitator record non-empty (the role was started)? */
function facilitatorStarted(r: JpFacilitatorRecord | null): boolean {
  return !!r && (!!r.coverage || !!r.attestations?.mou);
}

function deriveOne(
  kind: RoleKind,
  input: ResolverInput,
  started: boolean,
  complete: boolean,
  loadFailed: boolean,
): RoleCapability {
  // §7 constraint: the role org is the related org whose purpose is EXACTLY this kind's tag.
  const org = input.relatedOrgs.find((o) => o.purpose === orgPurpose(kind)) ?? null;

  let state: RoleState;
  if (!input.hasGrant) state = 'grant-missing';
  else if (loadFailed) state = 'load-failed';
  else if (!input.recordsLoaded) state = 'not-started'; // optimistic until records land; discovery gates routing
  else if (complete) state = 'ready';
  else if (started) state = 'incomplete';
  else state = 'not-started';

  return { kind, state, org, ready: state === 'ready' };
}

/** Derive role capabilities from the session + related orgs + loaded records. Pure. */
export function deriveRoleCapabilities(input: ResolverInput): RoleCapabilities {
  const empty: RoleCapability = { kind: 'adopter', state: 'not-started', org: null, ready: false };
  if (!input.connected) {
    return {
      roles: [],
      byKind: { adopter: { ...empty, kind: 'adopter' }, facilitator: { ...empty, kind: 'facilitator' } },
      recommendedRole: null,
      canSwitch: false,
    };
  }

  const adopterComplete = !!input.impact && !!input.adopterRecord && isAdopterOnboardingComplete(input.impact, input.adopterRecord);
  const facilitatorComplete = !!input.impact && !!input.facilitatorRecord && isFacilitatorOnboardingComplete(input.impact, input.facilitatorRecord);

  const adopter = deriveOne('adopter', input, adopterStarted(input.adopterRecord), adopterComplete, !!input.adopterLoadFailed);
  const facilitator = deriveOne('facilitator', input, facilitatorStarted(input.facilitatorRecord), facilitatorComplete, !!input.facilitatorLoadFailed);

  const byKind: Record<RoleKind, RoleCapability> = { adopter, facilitator };

  const roles: RoleKind[] = [];
  if (adopter.ready) roles.push('adopter');
  if (facilitator.ready) roles.push('facilitator');

  // Prefer a ready role; else an in-progress (incomplete) role is the next-best landing; else null →
  // the hub chooser shows two setup cards.
  const recommendedRole: RoleKind | null =
    roles[0] ??
    (adopter.state === 'incomplete' ? 'adopter' : facilitator.state === 'incomplete' ? 'facilitator' : null);

  return { roles, byKind, recommendedRole, canSwitch: roles.length > 1 };
}
