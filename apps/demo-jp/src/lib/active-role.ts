// Active-role UI preference (production UX spec §7 "State Model"). The connected person's last-chosen
// workspace (adopter | facilitator) is a PURE UI preference — NEVER identity, authorization, or proof
// of role access. It is persisted keyed by the canonical person Smart Agent address + `demo-jp` so a
// dual-role member returns to the same workspace, and a different person on the same browser does not
// inherit it. The resolver (`role-capabilities`) decides what is actually openable; this only remembers
// the preference.

import { TAB_IDS, tabsForRole, type TabId } from './workspace-tabs';

export type RoleKind = 'adopter' | 'facilitator';

const KEY = (personKey: string) => `agenticprimitives:demo-jp:active-role:${personKey.toLowerCase()}`;

// Active-tab preference (spec 254 §4) — the workspace's last-chosen secondary-nav tab. Keyed by the
// canonical person SA + role so a dual-role member's adopter and facilitator tab prefs don't collide.
// Pure UI state (never identity/authorization); fail-safe default is `overview` for unknown/invalid values.
const TAB_KEY = (personKey: string, role: RoleKind) =>
  `agenticprimitives:demo-jp:active-tab:${personKey.toLowerCase()}:${role}`;

export function loadActiveRole(personKey: string): RoleKind | null {
  if (typeof localStorage === 'undefined' || !personKey) return null;
  const v = localStorage.getItem(KEY(personKey));
  return v === 'adopter' || v === 'facilitator' ? v : null;
}

export function saveActiveRole(personKey: string, role: RoleKind): void {
  if (typeof localStorage !== 'undefined' && personKey) {
    try { localStorage.setItem(KEY(personKey), role); } catch { /* ignore */ }
  }
}

export function clearActiveRole(personKey: string): void {
  if (typeof localStorage !== 'undefined' && personKey) {
    try { localStorage.removeItem(KEY(personKey)); } catch { /* ignore */ }
  }
}

/** The last-chosen workspace tab for this (person, role). Validates the stored value against the role's
 *  tab id set; an unknown/missing/invalid value fails safe to `overview`. */
export function loadActiveTab(personKey: string, role: RoleKind): TabId {
  if (typeof localStorage === 'undefined' || !personKey) return TAB_IDS.overview;
  const v = localStorage.getItem(TAB_KEY(personKey, role));
  return tabsForRole(role).some((t) => t.id === v) ? (v as TabId) : TAB_IDS.overview;
}

/** Persist the last-chosen workspace tab for this (person, role). */
export function saveActiveTab(personKey: string, role: RoleKind, tabId: TabId): void {
  if (typeof localStorage !== 'undefined' && personKey) {
    try { localStorage.setItem(TAB_KEY(personKey, role), tabId); } catch { /* ignore */ }
  }
}
