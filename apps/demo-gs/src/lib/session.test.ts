import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Address } from '@agenticprimitives/types';
import {
  clearSession, loadSession, setSession, SESSION_TTL_MS, type MemberSession,
} from './session';
import { loadActiveRole, saveActiveRole } from './active-role';
import { CONTRACTS } from './chain';

// The current DelegationManager the grant must be bound to; a session stamped with a different DM
// (e.g. after a contract redeploy) is rejected as stale (see session.ts).
const DM = CONTRACTS.delegationManager;

// The vitest env is `node` (no DOM) — install a minimal in-memory localStorage stub so the storage
// modules under test behave as they would in the browser.
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

const SA = '0x00000000000000000000000000000000000000aa' as Address;
const GRANT = {
  delegator: SA, delegate: '0x00000000000000000000000000000000000000bb' as Address,
  authority: '0x00', caveats: [], salt: '1', signature: '0x',
} as MemberSession['grant'];

function validSession(kind: 'kc' | 'gco' = 'kc'): MemberSession {
  return { kind, sa: SA, name: 'casey', grant: GRANT };
}

const SESSION_KEY = (kind: string) => `agenticprimitives:demo-gs:session:${kind}`;

let store: Map<string, string>;
beforeEach(() => { store = installLocalStorage(); });
afterEach(() => { delete (globalThis as { localStorage?: Storage }).localStorage; });

describe('session validation (fail-closed, ADR-0013)', () => {
  it('round-trips a valid session', () => {
    setSession(validSession());
    const s = loadSession('kc');
    expect(s?.sa).toBe(SA);
    expect(s?.name).toBe('casey');
  });

  it('rejects + purges a malformed blob (missing grant)', () => {
    store.set(SESSION_KEY('kc'), JSON.stringify({ v: 1, savedAt: Date.now(), kind: 'kc', sa: SA, name: 'x', dm: DM }));
    expect(loadSession('kc')).toBeNull();
    expect(store.has(SESSION_KEY('kc'))).toBe(false); // purged
  });

  it('rejects a grant that is structurally invalid (not a delegation shape)', () => {
    store.set(SESSION_KEY('kc'), JSON.stringify({ v: 1, savedAt: Date.now(), kind: 'kc', sa: SA, name: 'x', grant: { foo: 1 }, dm: DM }));
    expect(loadSession('kc')).toBeNull();
  });

  it('rejects a version-skewed blob (stale schema)', () => {
    store.set(SESSION_KEY('kc'), JSON.stringify({ v: 0, savedAt: Date.now(), kind: 'kc', sa: SA, name: 'x', grant: GRANT, dm: DM }));
    expect(loadSession('kc')).toBeNull();
  });

  it('rejects an expired blob (older than the TTL)', () => {
    const old = Date.now() - SESSION_TTL_MS - 1000;
    store.set(SESSION_KEY('kc'), JSON.stringify({ v: 1, savedAt: old, kind: 'kc', sa: SA, name: 'x', grant: GRANT, dm: DM }));
    expect(loadSession('kc')).toBeNull();
    expect(store.has(SESSION_KEY('kc'))).toBe(false);
  });

  it('rejects a blob with no savedAt (legacy / un-stamped)', () => {
    store.set(SESSION_KEY('kc'), JSON.stringify({ v: 1, kind: 'kc', sa: SA, name: 'x', grant: GRANT, dm: DM }));
    expect(loadSession('kc')).toBeNull();
  });

  it('rejects + purges a session signed against a different DelegationManager (stale after redeploy)', () => {
    const staleDm = '0x000000000000000000000000000000000000dEaD' as Address;
    store.set(SESSION_KEY('kc'), JSON.stringify({ v: 1, savedAt: Date.now(), kind: 'kc', sa: SA, name: 'x', grant: GRANT, dm: staleDm }));
    expect(loadSession('kc')).toBeNull();
    expect(store.has(SESSION_KEY('kc'))).toBe(false); // purged → forces a fresh reconnect
  });

  it('rejects a session with no dm (pre-binding legacy blob)', () => {
    store.set(SESSION_KEY('kc'), JSON.stringify({ v: 1, savedAt: Date.now(), kind: 'kc', sa: SA, name: 'x', grant: GRANT }));
    expect(loadSession('kc')).toBeNull();
  });

  it('accepts a raw envelope bound to the current DelegationManager', () => {
    store.set(SESSION_KEY('kc'), JSON.stringify({ v: 1, savedAt: Date.now(), kind: 'kc', sa: SA, name: 'casey', grant: GRANT, dm: DM }));
    expect(loadSession('kc')?.name).toBe('casey');
  });

  it('rejects a kind mismatch', () => {
    setSession(validSession('kc'));
    expect(loadSession('gco')).toBeNull();
  });

  it('rejects non-JSON garbage and purges it', () => {
    store.set(SESSION_KEY('kc'), 'not json {');
    expect(loadSession('kc')).toBeNull();
    expect(store.has(SESSION_KEY('kc'))).toBe(false);
  });

  it('does not leak the envelope metadata to callers', () => {
    setSession(validSession());
    const s = loadSession('kc') as Record<string, unknown> | null;
    expect(s).not.toBeNull();
    expect(s!.v).toBeUndefined();
    expect(s!.savedAt).toBeUndefined();
  });
});

describe('clearSession clears dependent UI state', () => {
  it('clears the active-role preference for the signed-out identity', () => {
    setSession(validSession('kc'));
    saveActiveRole(SA, 'kc');
    expect(loadActiveRole(SA)).toBe('kc');
    clearSession('kc');
    expect(loadSession('kc')).toBeNull();
    expect(loadActiveRole(SA)).toBeNull(); // dependent UI state gone, no stale lingering
  });

  it('uses the signatory as the person key for a GCO sign-out', () => {
    const gco: MemberSession = { kind: 'gco', sa: SA, name: 'Hope Org', orgName: 'Hope Org', signatory: 'rich', grant: GRANT };
    setSession(gco);
    saveActiveRole('rich', 'gco');
    clearSession('gco');
    expect(loadActiveRole('rich')).toBeNull();
  });
});
