// Workspace secondary-navigation tab IDs (spec 254 §2). The shared 5-tab IA: positions 1 and 5 are
// identical across all roles (`overview` / `data-access`); the middle three follow
// `primary-task | browse | connections` and are role-specialized. This module is the ONE source of
// truth shared by the MUI Tabs render and the persistence helpers (`loadActiveTab`/`saveActiveTab`) so
// an invalid stored value can be validated against the role's tab id set. Mirrors demo-gs's identical
// module (ADR-0021 — one IA, two component systems).

import type { RoleKind } from './active-role';

/** The shared tab ids (positions 1, 4, 5 — identical across roles) + the role-specific middle ids. */
export const TAB_IDS = {
  overview: 'overview',
  // Facilitator primary-task + browse (positions 2, 3).
  coverage: 'coverage',
  matches: 'matches',
  // Adopter primary-task + browse (positions 2, 3) — F2; defined here for the shared map.
  setup: 'setup',
  declare: 'declare',
  // shared connections + data-access (positions 4, 5).
  connections: 'connections',
  dataAccess: 'data-access',
} as const;

export type TabId = (typeof TAB_IDS)[keyof typeof TAB_IDS];

export interface TabDescriptor {
  id: TabId;
  label: string;
}

/** Facilitator workspace tabs, in fixed position order. */
export const FACILITATOR_TABS: readonly TabDescriptor[] = [
  { id: TAB_IDS.overview, label: 'Overview' },
  { id: TAB_IDS.coverage, label: 'Coverage' },
  { id: TAB_IDS.matches, label: 'Matches' },
  { id: TAB_IDS.connections, label: 'Connections' },
  { id: TAB_IDS.dataAccess, label: 'Data & Access' },
] as const;

/** Adopter workspace tabs (F2; defined now so the shared map is complete). */
export const ADOPTER_TABS: readonly TabDescriptor[] = [
  { id: TAB_IDS.overview, label: 'Overview' },
  { id: TAB_IDS.setup, label: 'Setup' },
  { id: TAB_IDS.declare, label: 'Declare' },
  { id: TAB_IDS.connections, label: 'Connections' },
  { id: TAB_IDS.dataAccess, label: 'Data & Access' },
] as const;

/** The per-role tab descriptor array (the bar + persistence share this one source). */
export function tabsForRole(role: RoleKind): readonly TabDescriptor[] {
  return role === 'adopter' ? ADOPTER_TABS : FACILITATOR_TABS;
}
