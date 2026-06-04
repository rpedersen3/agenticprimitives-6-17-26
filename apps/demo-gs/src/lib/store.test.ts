import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Address } from '@agenticprimitives/types';
import type { ExpertOffering, GcoNeedIntent } from '../domain/gs-types';
import type { GsAgreement } from '../domain/gs-status';
import type { MemberSession } from './session';

// Mock every seam the store hydrates through, so we can prove the entitled view is loaded from the
// VAULT (member-vault + vault-client) and never from localStorage.
const loadBrokerView = vi.fn();
const loadKcOffering = vi.fn();
const loadGcoNeeds = vi.fn();
const loadMembers = vi.fn(async () => []);
vi.mock('./member-vault', () => ({
  loadBrokerView: () => loadBrokerView(),
  loadKcOffering: (...a: unknown[]) => loadKcOffering(...a),
  loadGcoNeeds: (...a: unknown[]) => loadGcoNeeds(...a),
  loadMembers: () => loadMembers(),
}));

const vaultRead = vi.fn();
const vaultWrite = vi.fn();
vi.mock('./vault-client', () => ({
  vaultRead: (...a: unknown[]) => vaultRead(...a),
  vaultWrite: (...a: unknown[]) => vaultWrite(...a),
}));

vi.mock('./onchain', () => ({
  switchboardVaultOwner: async () => ({ owner: '0x0a' as Address, custodian: { address: '0x0b' as Address } }),
}));
vi.mock('./names', () => ({ setKnownNames: vi.fn() }));
vi.mock('./directory', () => ({
  projectNeed: (n: GcoNeedIntent) => ({ id: n.id }),
  projectOffering: (o: ExpertOffering) => ({ id: o.id }),
}));

import { setActiveContext, allOfferings, allNeeds, allAgreements, isHydrated } from './store';

function installLocalStorage(): { setItem: ReturnType<typeof vi.fn> } {
  const setItem = vi.fn();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: () => null, setItem, removeItem: vi.fn(), clear: vi.fn(), key: () => null, length: 0,
  } as unknown as Storage;
  return { setItem };
}

const SA = '0x0000000000000000000000000000000000000abc' as Address;
const grant = { delegator: SA, delegate: '0x02' as Address, authority: '0x', caveats: [], salt: '1', signature: '0x' } as MemberSession['grant'];
const kcSession: MemberSession = { kind: 'kc', sa: SA, name: 'casey', grant };

let ls: { setItem: ReturnType<typeof vi.fn> };
beforeEach(() => {
  ls = installLocalStorage();
  loadBrokerView.mockReset().mockResolvedValue({ needs: [], offerings: [] });
  loadKcOffering.mockReset().mockResolvedValue(null);
  loadGcoNeeds.mockReset().mockResolvedValue([]);
  vaultRead.mockReset().mockResolvedValue(null);
  vaultWrite.mockReset();
});
afterEach(() => { delete (globalThis as { localStorage?: Storage }).localStorage; });

describe('store hydrates operational data from the vault (not localStorage)', () => {
  it('kc context loads its OWN offering through the member grant', async () => {
    loadKcOffering.mockResolvedValue({ id: 'o1' } as ExpertOffering);
    await setActiveContext({ persona: 'kc', session: kcSession });
    expect(loadKcOffering).toHaveBeenCalledWith(grant);
    expect(allOfferings().map((o) => o.id)).toEqual(['o1']);
    expect(isHydrated()).toBe(true);
  });

  it('jane context loads the broker view + agreements + bridge from the vault', async () => {
    loadBrokerView.mockResolvedValue({ needs: [{ id: 'n1' } as GcoNeedIntent], offerings: [{ id: 'o1' } as ExpertOffering] });
    vaultRead.mockImplementation(async (_owner: unknown, rec: string) =>
      rec === 'gs:broker:agreements' ? ([{ id: 'a1' }] as GsAgreement[]) : []);
    await setActiveContext({ persona: 'jane' });
    expect(loadBrokerView).toHaveBeenCalled();
    expect(allNeeds().map((n) => n.id)).toContain('n1');
    expect(allAgreements().map((a) => a.id)).toEqual(['a1']);
  });

  it('NEVER persists the entitled view to localStorage', async () => {
    loadKcOffering.mockResolvedValue({ id: 'o1' } as ExpertOffering);
    await setActiveContext({ persona: 'kc', session: kcSession });
    expect(ls.setItem).not.toHaveBeenCalled(); // the cache is in-memory only
  });

  it('a member with no session hydrates to an empty entitled view', async () => {
    await setActiveContext({ persona: 'kc', session: null });
    expect(allOfferings()).toEqual([]);
    expect(allNeeds()).toEqual([]);
    expect(isHydrated()).toBe(true);
  });
});
