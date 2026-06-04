// One-time, versioned storage cleanup (Demo GS storage cleanup). Wave 2 (spec 252) re-homed every piece
// of OPERATIONAL / source-of-truth data — the marketplace board, the member registry — out of the
// browser and into per-agent MCP vaults (read through `vault-client.ts`). The fixture-era localStorage
// blobs that used to hold that data are now dead weight: if an old bundle wrote them, they linger as a
// confusing, authoritative-looking shadow of the vault. This removes ONLY those obsolete blobs, once.
//
// See `docs/storage-ledger.md` for the full key audit. Guarantees:
//   • Runs ONCE per browser (guarded by a version marker) and is safe to call on every boot / refresh.
//   • Removes ONLY the obsolete fixture-era keys listed below — never an active key.
//   • NEVER touches: the active session keys, the connect / org-create redirect stashes, the active-role
//     preference, the last-name hint, the Pete/Jane demo-shortcut selection, or the Switchboard deploy
//     display cache. Those are all legitimate, non-authoritative browser state (see the ledger).

/** Marker so the sweep runs exactly once; bump the version to ship a new sweep. */
const CLEANUP_MARKER = 'agenticprimitives:demo-gs:storage-cleanup:v1';

// Obsolete, fixture-era / pre-Wave-2 blobs. These ONCE held source-of-truth (the marketplace board,
// the local member registry) that now lives ONLY in MCP vaults — so any surviving copy is stale and
// must not be trusted. Exact keys, never prefixes, so the sweep can't over-match a live key.
const OBSOLETE_KEYS = [
  'agenticprimitives:demo-gs:db:v1', // old shared operational store (needs/offerings/matches/agreements)
  'agenticprimitives:demo-gs:members:v1', // old local member registry — now `gs:member:*` in Jane's vault
] as const;

/** Keys the sweep must NEVER delete (documented for the reader + asserted in tests). All are
 *  non-authoritative browser state per the ledger; none is a source of truth. */
export const PROTECTED_PREFIXES = [
  'agenticprimitives:demo-gs:session:', // login credential + grant (validated, TTL'd in session.ts)
  'agenticprimitives:demo-gs:connect', // in-flight site-login PKCE redirect stash
  'agenticprimitives:demo-gs:org-create', // in-flight org-create redirect stash
  'agenticprimitives:demo-gs:active-role:', // workspace UI preference
  'agenticprimitives:demo-gs:last-name', // last-typed name hint
  'agenticprimitives:demo-gs:persona', // Pete/Jane demo-shortcut selection (testnet/demo only)
  'agenticprimitives:demo-gs:switchboard-sa', // non-authoritative deploy display cache
] as const;

/** Run the obsolete-blob sweep once. Idempotent + safe on refresh. Returns the keys it removed (for
 *  tests / diagnostics); a no-op once the marker is set. */
export function runStorageCleanup(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    if (localStorage.getItem(CLEANUP_MARKER)) return [];
  } catch {
    return []; // storage unavailable (private mode, etc.) — nothing to clean
  }
  const removed: string[] = [];
  for (const key of OBSOLETE_KEYS) {
    try {
      if (localStorage.getItem(key) !== null) {
        localStorage.removeItem(key);
        removed.push(key);
      }
    } catch { /* ignore a single bad key; continue */ }
  }
  try { localStorage.setItem(CLEANUP_MARKER, String(Date.now())); } catch { /* ignore */ }
  return removed;
}

/** Test-only: the obsolete keys this sweep targets. */
export const __OBSOLETE_KEYS = OBSOLETE_KEYS;
/** Test-only: the cleanup marker key. */
export const __CLEANUP_MARKER = CLEANUP_MARKER;
