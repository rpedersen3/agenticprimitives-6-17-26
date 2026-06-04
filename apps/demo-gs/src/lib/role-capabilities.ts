// Role capability resolver (spec 252 design spec §7 "State Model"). PURE — no network, no localStorage
// access of its own: it derives what workspaces a connected person can open from the per-kind sessions
// (`loadSession('kc')` / `loadSession('gco')`) + the `pendingGco` transient (a person who finished the
// GCO step-1 site-login but hasn't created the org yet). The App owns the I/O; this file is only logic,
// so it is trivially unit-testable (`role-capabilities.test.ts`).
//
// Per the spec the full state vocabulary is { empty, record-absent, grant-missing, org-pending,
// load-failed, ready, incomplete }; Wave A/B drives the SHELL routing, so the resolver returns the
// subset the shell branches on today — `empty` (no session/setup), `org-pending` (GCO step-1 done,
// org not created), and `ready` (a real member session exists). The richer per-record states
// (record-absent / grant-missing / load-failed) belong to the workspace restructure (Wave C/D) and are
// surfaced there from `loadError()` / the request-access state, not from this pure resolver.

import type { MemberSession } from './session';

export type RoleKind = 'gco' | 'kc';
export type RoleState = 'empty' | 'org-pending' | 'ready';

export interface RoleCapability {
  kind: RoleKind;
  state: RoleState;
  /** True once a real `MemberSession` exists for this kind (the workspace can open). */
  hasSession: boolean;
}

export interface RoleCapabilities {
  /** The roles a connected person can currently work as (state `ready`). */
  roles: RoleKind[];
  /** Per-kind capability (always both kinds, so the hub can render setup cards for the missing one). */
  byKind: Record<RoleKind, RoleCapability>;
  /** The role to land in by default, or null when there is nothing ready/pending to land in. */
  recommendedRole: RoleKind | null;
  /** True when more than one workspace can be opened (a dual-role member). */
  canSwitch: boolean;
}

export interface ResolverInput {
  kcSession: MemberSession | null;
  gcoSession: MemberSession | null;
  /** A person connected as a GCO signatory (step 1) but whose org isn't created yet. */
  pendingGco: boolean;
}

/** Derive role capabilities from the per-kind sessions + the pendingGco transient. Pure. */
export function deriveRoleCapabilities({ kcSession, gcoSession, pendingGco }: ResolverInput): RoleCapabilities {
  const kcState: RoleState = kcSession ? 'ready' : 'empty';
  // A GCO session beats pendingGco (the org already exists). Otherwise pendingGco => org-pending.
  const gcoState: RoleState = gcoSession ? 'ready' : pendingGco ? 'org-pending' : 'empty';

  const byKind: Record<RoleKind, RoleCapability> = {
    gco: { kind: 'gco', state: gcoState, hasSession: !!gcoSession },
    kc: { kind: 'kc', state: kcState, hasSession: !!kcSession },
  };

  const roles: RoleKind[] = [];
  if (gcoState === 'ready') roles.push('gco');
  if (kcState === 'ready') roles.push('kc');

  // Recommend a ready role first; an in-flight org-create (org-pending) is the next best landing.
  const recommendedRole: RoleKind | null =
    roles[0] ?? (gcoState === 'org-pending' ? 'gco' : null);

  return { roles, byKind, recommendedRole, canSwitch: roles.length > 1 };
}
