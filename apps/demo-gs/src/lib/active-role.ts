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

const KEY = (personKey: string) => `agenticprimitives:demo-gs:active-role:${personKey.toLowerCase()}`;

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
