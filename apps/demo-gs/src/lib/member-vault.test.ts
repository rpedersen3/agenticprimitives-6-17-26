import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Address } from '@agenticprimitives/types';
import type { ExpertOffering, GcoNeedIntent } from '../domain/gs-types';
import type { VaultOwner } from './vault-client';

// Mock the vault transport + the broker-owner deploy seam. The point of these tests is to PROVE that
// operational data (member registry, offerings, needs) is loaded/saved through the vault APIs — never
// through localStorage. If any of these functions stop being called, the data left the vault.
const vaultList = vi.fn();
const vaultRead = vi.fn();
const vaultWrite = vi.fn();
const vaultReadWithDelegation = vi.fn();
const vaultWriteWithDelegation = vi.fn();
vi.mock('./vault-client', () => ({
  vaultList: (...a: unknown[]) => vaultList(...a),
  vaultRead: (...a: unknown[]) => vaultRead(...a),
  vaultWrite: (...a: unknown[]) => vaultWrite(...a),
  vaultReadWithDelegation: (...a: unknown[]) => vaultReadWithDelegation(...a),
  vaultWriteWithDelegation: (...a: unknown[]) => vaultWriteWithDelegation(...a),
}));

const JANE_OWNER: VaultOwner = {
  owner: '0x000000000000000000000000000000000000ja00' as Address,
  custodian: { address: '0x0000000000000000000000000000000000000c00' as Address } as VaultOwner['custodian'],
};
const switchboardVaultOwner = vi.fn(async () => JANE_OWNER);
vi.mock('./onchain', () => ({ switchboardVaultOwner: () => switchboardVaultOwner() }));

import {
  loadMembers, registerMember, loadKcOffering, saveKcOffering, loadGcoNeeds, saveGcoNeeds, loadBrokerView,
  type MemberEntry,
} from './member-vault';

const SA = '0x0000000000000000000000000000000000000001' as Address;
const grant = { delegator: SA, delegate: '0x02' as Address, authority: '0x', caveats: [], salt: '1', signature: '0x' } as MemberEntry['delegation'];

beforeEach(() => {
  vaultList.mockReset(); vaultRead.mockReset(); vaultWrite.mockReset();
  vaultReadWithDelegation.mockReset(); vaultWriteWithDelegation.mockReset();
  switchboardVaultOwner.mockClear();
});

describe('member registry lives in the vault (not localStorage)', () => {
  it('registerMember writes to Jane broker vault under gs:member:<sa>', async () => {
    const e: MemberEntry = { kind: 'kc', sa: SA, name: 'casey', delegation: grant };
    await registerMember(e);
    expect(vaultWrite).toHaveBeenCalledWith(JANE_OWNER, `gs:member:${SA.toLowerCase()}`, e);
  });

  it('loadMembers enumerates the vault + reads each gs:member record', async () => {
    vaultList.mockResolvedValue([
      { record_type: `gs:member:${SA.toLowerCase()}`, updated_at: 'now' },
      { record_type: 'gs:broker:agreements', updated_at: 'now' }, // not a member record → skipped
    ]);
    vaultRead.mockResolvedValue({ kind: 'kc', sa: SA, name: 'casey', delegation: grant });
    const members = await loadMembers();
    expect(vaultList).toHaveBeenCalledWith(JANE_OWNER);
    expect(vaultRead).toHaveBeenCalledTimes(1);
    expect(members).toHaveLength(1);
    expect(members[0]?.sa).toBe(SA);
  });
});

describe('member-owned data is read/written via the member grant', () => {
  it('loadKcOffering reads gs:offering through the grant', async () => {
    const o = { id: 'o1' } as ExpertOffering;
    vaultReadWithDelegation.mockResolvedValue(o);
    expect(await loadKcOffering(grant)).toBe(o);
    expect(vaultReadWithDelegation).toHaveBeenCalledWith(grant, 'gs:offering', undefined);
  });

  it('saveKcOffering writes gs:offering through the grant', async () => {
    const o = { id: 'o1' } as ExpertOffering;
    await saveKcOffering(grant, o);
    expect(vaultWriteWithDelegation).toHaveBeenCalledWith(grant, 'gs:offering', o);
  });

  it('loadGcoNeeds reads gs:needs through the grant (empty → [])', async () => {
    vaultReadWithDelegation.mockResolvedValue(null);
    expect(await loadGcoNeeds(grant)).toEqual([]);
    expect(vaultReadWithDelegation).toHaveBeenCalledWith(grant, 'gs:needs', undefined);
  });

  it('saveGcoNeeds writes gs:needs through the grant', async () => {
    const needs = [{ id: 'n1' }] as GcoNeedIntent[];
    await saveGcoNeeds(grant, needs);
    expect(vaultWriteWithDelegation).toHaveBeenCalledWith(grant, 'gs:needs', needs);
  });
});

describe('loadBrokerView aggregates members through their grants', () => {
  it('reads each member’s offering/needs via its own delegation', async () => {
    const kc: MemberEntry = { kind: 'kc', sa: SA, name: 'casey', delegation: grant };
    const gco: MemberEntry = { kind: 'gco', sa: '0x03' as Address, name: 'Hope', orgName: 'Hope', delegation: grant };
    vaultList.mockResolvedValue([
      { record_type: `gs:member:${SA.toLowerCase()}`, updated_at: 'now' },
      { record_type: 'gs:member:0x03', updated_at: 'now' },
    ]);
    vaultRead.mockResolvedValueOnce(kc).mockResolvedValueOnce(gco);
    vaultReadWithDelegation
      .mockResolvedValueOnce({ id: 'o1' }) // kc offering
      .mockResolvedValueOnce([{ id: 'n1' }]); // gco needs
    const view = await loadBrokerView();
    expect(view.offerings).toHaveLength(1);
    expect(view.needs).toHaveLength(1);
    // Every read went through a delegation (the member grant), never a raw owner read; the broker
    // survey uses a SINGLE attempt so a stale/orphaned member grant drops without a 4× 403 storm.
    expect(vaultReadWithDelegation).toHaveBeenCalledWith(grant, 'gs:offering', 1);
    expect(vaultReadWithDelegation).toHaveBeenCalledWith(grant, 'gs:needs', 1);
  });

  it('a revoked/expired grant simply drops that member (no fallback)', async () => {
    const kc: MemberEntry = { kind: 'kc', sa: SA, name: 'casey', delegation: grant };
    vaultList.mockResolvedValue([{ record_type: `gs:member:${SA.toLowerCase()}`, updated_at: 'now' }]);
    vaultRead.mockResolvedValue(kc);
    vaultReadWithDelegation.mockRejectedValue(new Error('grant revoked'));
    const view = await loadBrokerView();
    expect(view.offerings).toEqual([]);
    expect(view.needs).toEqual([]);
  });
});
