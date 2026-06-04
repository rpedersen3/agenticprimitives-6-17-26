import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearActiveRole, loadActiveRole, saveActiveRole } from './active-role';

function installLocalStorage(): Map<string, string> {
  const map = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(), key: () => null, get length() { return map.size; },
  } as Storage;
  return map;
}

beforeEach(() => { installLocalStorage(); });
afterEach(() => { delete (globalThis as { localStorage?: Storage }).localStorage; });

describe('active-role preference (non-authoritative UI state)', () => {
  it('round-trips and is keyed case-insensitively per person', () => {
    saveActiveRole('0xABC', 'gco');
    expect(loadActiveRole('0xabc')).toBe('gco'); // same identity, different case
  });

  it('rejects an invalid stored value', () => {
    installLocalStorage().set('agenticprimitives:demo-gs:active-role:0xabc', 'bogus');
    expect(loadActiveRole('0xabc')).toBeNull();
  });

  it('clearActiveRole drops the preference', () => {
    saveActiveRole('rich', 'kc');
    expect(loadActiveRole('rich')).toBe('kc');
    clearActiveRole('rich');
    expect(loadActiveRole('rich')).toBeNull();
  });

  it('an empty personKey is a no-op (never identity)', () => {
    saveActiveRole('', 'kc');
    expect(loadActiveRole('')).toBeNull();
  });
});
