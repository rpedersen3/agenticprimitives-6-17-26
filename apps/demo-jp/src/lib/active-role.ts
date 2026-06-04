// Active-role UI preference (production UX spec §7 "State Model"). The connected person's last-chosen
// workspace (adopter | facilitator) is a PURE UI preference — NEVER identity, authorization, or proof
// of role access. It is persisted keyed by the canonical person Smart Agent address + `demo-jp` so a
// dual-role member returns to the same workspace, and a different person on the same browser does not
// inherit it. The resolver (`role-capabilities`) decides what is actually openable; this only remembers
// the preference.

export type RoleKind = 'adopter' | 'facilitator';

const KEY = (personKey: string) => `agenticprimitives:demo-jp:active-role:${personKey.toLowerCase()}`;

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
