/**
 * name-cache.ts — local address → `.agent` name lookup table.
 *
 * Per ADR-0012 ("No eth_getLogs in product read paths") the browser
 * MUST NOT walk `NameRegistered` event logs for every NameDisplay
 * render. Doing so hammers Alchemy's free tier (10-block getLogs cap +
 * tight rate limits) and gets 429s in seconds.
 *
 * Instead: every flow that knows BOTH a Smart Agent address AND its
 * `.agent` name (claim-psa-name on success, passkey enrolment when
 * `agentName` is predicted, seat-claim metadata) writes that pair to
 * this cache. `NameDisplay` reads from the cache synchronously — no
 * RPC, no React Query waterfall, no rate limit.
 *
 * For SAs we did NOT create locally (none in the current demo, but
 * relevant when looking up a peer's agent), NameDisplay falls back to
 * the truncated address. A future indexer Worker (out of scope for
 * the demo) can serve those lookups in batch.
 *
 * Cache storage:
 *   - In-memory `Map` for synchronous reads.
 *   - Mirrored to localStorage so it survives reloads.
 *   - Cleared as part of the demo's Reset flow.
 *   - Cross-tab updates broadcast via `storage` events (and the
 *     in-process `naming:cache:update` window event).
 */

import type { Address } from 'viem';

const STORAGE_KEY = 'agenticprimitives:demo-web-pro:name-cache';
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
    // Cross-tab sync.
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
