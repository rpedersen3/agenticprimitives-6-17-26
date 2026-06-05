// Active-role UI preference (spec 252 design spec §7). The connected person's last-chosen workspace
// (gco | kc) is a pure UI preference — NEVER identity or authorization. It is persisted keyed by the
// canonical person identity + `demo-gs` so a dual-role member returns to the same workspace, and a
// different person on the same browser doesn't inherit it. The resolver (`role-capabilities`) decides
// what is actually openable; this only remembers the preference.
//
// `personKey` is the canonical person identity: the KC person SA when a KC session exists, else the GCO
// signatory's name (a GCO session's `sa` is the ORG SA, not the person — both KC + GCO of the same
// person share the signatory/person, so the App passes a stable person key, not the org SA).

import type { RoleKind } from './role-capabilities';
import { TAB_IDS, tabsForRole, type TabId } from './workspace-tabs';

const KEY = (personKey: string) => `agenticprimitives:demo-gs:active-role:${personKey.toLowerCase()}`;

// Active-tab preference (spec 254 §4) — the workspace's last-chosen secondary-nav tab. Keyed by the
// canonical person identity + role so a dual-role member's KC and GCO tab prefs don't collide. Pure UI
// state (never identity/authorization); fail-safe default is `overview` for unknown/invalid stored values.
const TAB_KEY = (personKey: string, role: RoleKind) =>
  `agenticprimitives:demo-gs:active-tab:${personKey.toLowerCase()}:${role}`;

export function loadActiveRole(personKey: string): RoleKind | null {
  if (typeof localStorage === 'undefined' || !personKey) return null;
  const v = localStorage.getItem(KEY(personKey));
  return v === 'gco' || v === 'kc' ? v : null;
}

export function saveActiveRole(personKey: string, role: RoleKind): void {
  if (typeof localStorage !== 'undefined' && personKey) {
    try { localStorage.setItem(KEY(personKey), role); } catch { /* ignore */ }
  }
}

/** Drop the active-role preference for an identity. Called on sign-out / session-expiry (session.ts) so
 *  a stale workspace choice can't linger after the credential that backed it is gone. */
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
