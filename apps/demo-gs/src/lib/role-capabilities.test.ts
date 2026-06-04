import { describe, expect, it } from 'vitest';
import type { Address } from '@agenticprimitives/types';
import { deriveRoleCapabilities } from './role-capabilities';
import type { MemberSession, SessionKind } from './session';

// A throwaway session (the resolver only reads its presence, not its contents).
function session(kind: SessionKind): MemberSession {
  return {
    kind,
    sa: '0x000000000000000000000000000000000000dead' as Address,
    name: kind === 'gco' ? 'Hope Church' : 'Casey',
    grant: { signedDelegation: '0x' } as unknown as MemberSession['grant'],
  };
}

describe('deriveRoleCapabilities', () => {
  it('zero: no sessions, no pending → no roles, no recommendation', () => {
    const c = deriveRoleCapabilities({ kcSession: null, gcoSession: null, pendingGco: false });
    expect(c.roles).toEqual([]);
    expect(c.byKind.gco.state).toBe('empty');
    expect(c.byKind.kc.state).toBe('empty');
    expect(c.recommendedRole).toBeNull();
    expect(c.canSwitch).toBe(false);
  });

  it('kc-only: kc ready, gco empty, recommends kc, cannot switch', () => {
    const c = deriveRoleCapabilities({ kcSession: session('kc'), gcoSession: null, pendingGco: false });
    expect(c.roles).toEqual(['kc']);
    expect(c.byKind.kc.state).toBe('ready');
    expect(c.byKind.kc.hasSession).toBe(true);
    expect(c.byKind.gco.state).toBe('empty');
    expect(c.recommendedRole).toBe('kc');
    expect(c.canSwitch).toBe(false);
  });

  it('gco-only: gco ready, kc empty, recommends gco', () => {
    const c = deriveRoleCapabilities({ kcSession: null, gcoSession: session('gco'), pendingGco: false });
    expect(c.roles).toEqual(['gco']);
    expect(c.byKind.gco.state).toBe('ready');
    expect(c.recommendedRole).toBe('gco');
    expect(c.canSwitch).toBe(false);
  });

  it('both: gco + kc ready, recommends gco (first), can switch', () => {
    const c = deriveRoleCapabilities({ kcSession: session('kc'), gcoSession: session('gco'), pendingGco: false });
    expect(c.roles).toEqual(['gco', 'kc']);
    expect(c.recommendedRole).toBe('gco');
    expect(c.canSwitch).toBe(true);
  });

  it('org-pending: pendingGco with no gco session → org-pending, recommends gco', () => {
    const c = deriveRoleCapabilities({ kcSession: null, gcoSession: null, pendingGco: true });
    expect(c.byKind.gco.state).toBe('org-pending');
    expect(c.byKind.gco.hasSession).toBe(false);
    expect(c.roles).toEqual([]); // org-pending is not yet a ready role
    expect(c.recommendedRole).toBe('gco');
    expect(c.canSwitch).toBe(false);
  });

  it('org-pending is superseded once the gco session exists', () => {
    const c = deriveRoleCapabilities({ kcSession: null, gcoSession: session('gco'), pendingGco: true });
    expect(c.byKind.gco.state).toBe('ready');
    expect(c.roles).toEqual(['gco']);
  });

  it('kc ready + gco org-pending: kc is the only ready role, gco resumable', () => {
    const c = deriveRoleCapabilities({ kcSession: session('kc'), gcoSession: null, pendingGco: true });
    expect(c.roles).toEqual(['kc']);
    expect(c.byKind.gco.state).toBe('org-pending');
    expect(c.recommendedRole).toBe('kc');
  });
});
