/**
 * name-cache.ts — local address → `.agent` name lookup table.
 *
 * Ported from demo-web-pro with the same principles: `NameDisplay`
 * reads this cache synchronously (no RPC on render); flows that mint /
 * claim a name (claim-psa-name on success) and a bounded boot-time
 * reverse-resolve (App.tsx) populate it. There is NO `eth_getLogs`
 * walk anywhere (ADR-0012 / ADR-0013) — the package's reverseResolve
 * is a single `reverseResolveString` call with no fallback.
 *
 * Cache storage:
 *   - In-memory `Map` for synchronous reads.
 *   - Mirrored to localStorage so it survives reloads.
 *   - Cleared by the demo's Reset flow (prefix wipe in App.tsx).
 *   - Cross-tab updates broadcast via `storage` + `naming:cache:update`.
 */

import type { Address } from 'viem';

const STORAGE_KEY = 'agenticprimitives:demo-web-recovery:name-cache';
export const NAME_CACHE_EVENT = 'naming:cache:update';

/** Address normalization key (lowercased hex). */
function key(address: Address): string {
  return address.toLowerCase();
}

const memCache: Map<string, string> = new Map();

function loadFromStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, string>;
    for (const [k, v] of Object.entries(obj)) memCache.set(k, v);
  } catch {
    // Corrupt or unavailable storage — start empty.
  }
}

function writeToStorage(): void {
  try {
    const obj: Record<string, string> = {};
    for (const [k, v] of memCache.entries()) obj[k] = v;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // Storage quota or unavailable — non-fatal, in-memory still works.
  }
}

let initialized = false;
function init(): void {
  if (initialized) return;
  initialized = true;
  if (typeof localStorage !== 'undefined') {
    loadFromStorage();
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key !== STORAGE_KEY) return;
        memCache.clear();
        loadFromStorage();
        try { window.dispatchEvent(new CustomEvent(NAME_CACHE_EVENT)); } catch {}
      });
    }
  }
}

/** Look up the cached `.agent` name for an SA address, or undefined. */
export function getCachedName(address: Address | undefined): string | undefined {
  if (!address) return undefined;
  init();
  return memCache.get(key(address));
}

/**
 * Store (address → name). Fires `naming:cache:update` so subscribers
 * (NameDisplay, etc.) can re-render. Idempotent.
 */
export function setCachedName(address: Address, name: string): void {
  init();
  const k = key(address);
  if (memCache.get(k) === name) return;
  memCache.set(k, name);
  writeToStorage();
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent<{ address: Address; name: string }>(NAME_CACHE_EVENT, {
          detail: { address, name },
        }),
      );
    } catch {}
  }
}

/** Forget a specific entry. */
export function clearCachedName(address: Address): void {
  init();
  if (!memCache.delete(key(address))) return;
  writeToStorage();
  if (typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent(NAME_CACHE_EVENT)); } catch {}
  }
}

/** Wipe everything (called from the demo's Reset flow). */
export function clearAllCachedNames(): void {
  init();
  if (memCache.size === 0) return;
  memCache.clear();
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  if (typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent(NAME_CACHE_EVENT)); } catch {}
  }
}

/** Snapshot of all entries — useful for diagnostics + tests. */
export function listCachedNames(): Array<{ address: Address; name: string }> {
  init();
  return Array.from(memCache.entries()).map(([address, name]) => ({
    address: address as Address,
    name,
  }));
}
