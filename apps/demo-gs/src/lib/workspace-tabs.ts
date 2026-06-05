// Workspace secondary-navigation tab IDs (spec 254 §2). The shared 5-tab IA: positions 1 and 5 are
// identical across all roles (`overview` / `data-access`); the middle three follow
// `primary-task | browse | connections` and are role-specialized. This module is the ONE source of
// truth shared by the tab bar render (`WorkspaceTabBar`) and the persistence helpers
// (`loadActiveTab`/`saveActiveTab`) so an invalid stored value can be validated against the role's id set.

import type { RoleKind } from './role-capabilities';

/** The shared tab ids (positions 1, 4, 5 — identical across roles) + the role-specific middle ids. */
export const TAB_IDS = {
  overview: 'overview',
  // KC Expert primary-task + browse (positions 2, 3).
  offering: 'offering',
  directory: 'directory',
  // GCO Org primary-task + browse (positions 2, 3) — F2; defined here for the shared map.
  need: 'need',
  // shared connections + data-access (positions 4, 5).
  connections: 'connections',
  dataAccess: 'data-access',
} as const;

export type TabId = (typeof TAB_IDS)[keyof typeof TAB_IDS];

export interface TabDescriptor {
  id: TabId;
  label: string;
}

/** KC Expert workspace tabs, in fixed position order (overview · offering · directory · connections · data-access). */
export const KC_TABS: readonly TabDescriptor[] = [
  { id: TAB_IDS.overview, label: 'Overview' },
  { id: TAB_IDS.offering, label: 'Offering' },
  { id: TAB_IDS.directory, label: 'Directory' },
  { id: TAB_IDS.connections, label: 'Connections' },
  { id: TAB_IDS.dataAccess, label: 'Data & Access' },
] as const;

/** GCO Org workspace tabs (F2; defined now so the shared map is complete). */
export const GCO_TABS: readonly TabDescriptor[] = [
  { id: TAB_IDS.overview, label: 'Overview' },
  { id: TAB_IDS.need, label: 'Post a Need' },
  { id: TAB_IDS.directory, label: 'Directory' },
  { id: TAB_IDS.connections, label: 'Connections' },
  { id: TAB_IDS.dataAccess, label: 'Data & Access' },
] as const;

/** The per-role tab descriptor array (the bar + persistence share this one source). */
export function tabsForRole(role: RoleKind): readonly TabDescriptor[] {
  return role === 'gco' ? GCO_TABS : KC_TABS;
}
