import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runStorageCleanup, __OBSOLETE_KEYS, __CLEANUP_MARKER } from './storage-cleanup';

function installLocalStorage(): Map<string, string> {
  const map = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size; },
  } as Storage;
  return map;
}

// The keys the sweep must NEVER delete (one representative key per protected category).
const PROTECTED = {
  'agenticprimitives:demo-gs:session:kc': 'session-cred',
  'agenticprimitives:demo-gs:connect': 'pkce-stash',
  'agenticprimitives:demo-gs:org-create': 'org-pkce-stash',
  'agenticprimitives:demo-gs:active-role:0xabc': 'kc',
  'agenticprimitives:demo-gs:last-name': 'rich-pedersen',
  'agenticprimitives:demo-gs:persona': 'jane',
  'agenticprimitives:demo-gs:switchboard-sa': '{"sa":"0x1","deployed":true}',
};

let store: Map<string, string>;
beforeEach(() => { store = installLocalStorage(); });
afterEach(() => { delete (globalThis as { localStorage?: Storage }).localStorage; });

describe('one-time storage cleanup', () => {
  it('removes the obsolete fixture-era blobs', () => {
    for (const k of __OBSOLETE_KEYS) store.set(k, '{"some":"old data"}');
    const removed = runStorageCleanup();
    expect(removed.sort()).toEqual([...__OBSOLETE_KEYS].sort());
    for (const k of __OBSOLETE_KEYS) expect(store.has(k)).toBe(false);
  });

  it('NEVER deletes a protected key', () => {
    for (const k of __OBSOLETE_KEYS) store.set(k, 'old');
    for (const [k, v] of Object.entries(PROTECTED)) store.set(k, v);
    runStorageCleanup();
    for (const [k, v] of Object.entries(PROTECTED)) {
      expect(store.get(k)).toBe(v); // untouched
    }
  });

  it('runs ONCE — a second call (and a refresh) is a no-op', () => {
    for (const k of __OBSOLETE_KEYS) store.set(k, 'old');
    expect(runStorageCleanup().length).toBe(__OBSOLETE_KEYS.length);
    expect(store.has(__CLEANUP_MARKER)).toBe(true);
    // Simulate an old bundle re-writing an obsolete blob after the sweep already ran:
    store.set(__OBSOLETE_KEYS[0], 'written-again');
    const second = runStorageCleanup();
    expect(second).toEqual([]); // marker set → no-op
    expect(store.get(__OBSOLETE_KEYS[0])).toBe('written-again'); // not re-swept
  });

  it('is safe when there is nothing to clean (sets the marker, removes nothing)', () => {
    const removed = runStorageCleanup();
    expect(removed).toEqual([]);
    expect(store.has(__CLEANUP_MARKER)).toBe(true);
  });

  it('is a no-op when localStorage is unavailable', () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(runStorageCleanup()).toEqual([]);
  });
});
