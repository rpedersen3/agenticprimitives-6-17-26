/**
 * name-cache.ts — local address → `.agent` name lookup table.
 *
 * Same principles as demo-web-pro: `NameDisplay` reads this cache
 * synchronously; a single `reverseResolveString` (no log walk, no
 * fallback — ADR-0013) primes it. Mirrored to localStorage; broadcasts
 * `naming:cache:update` so subscribers re-render.
 */

import type { Address } from 'viem';

const STORAGE_KEY = 'agenticprimitives:demo-web:name-cache';
export const NAME_CACHE_EVENT = 'naming:cache:update';

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
    // Corrupt / unavailable — start empty.
  }
}

function writeToStorage(): void {
  try {
    const obj: Record<string, string> = {};
    for (const [k, v] of memCache.entries()) obj[k] = v;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // Non-fatal; in-memory still works.
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

export function getCachedName(address: Address | undefined): string | undefined {
  if (!address) return undefined;
  init();
  return memCache.get(key(address));
}

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

export function clearAllCachedNames(): void {
  init();
  if (memCache.size === 0) return;
  memCache.clear();
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  if (typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent(NAME_CACHE_EVENT)); } catch {}
  }
}
