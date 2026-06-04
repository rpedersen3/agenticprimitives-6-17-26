import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Address } from '@agenticprimitives/types';
import type { RelatedOrgLink } from '../connect-client';
import type { MemberEntry } from './member-vault';

// Mock the two seams gco-discovery depends on: Connect's related-orgs (which org SAs belong to the
// person) + Jane's member registry (which holds the grant). No network in the test.
const listRelatedOrgs = vi.fn<(name: string, idToken: string) => Promise<RelatedOrgLink[]>>();
const loadMembers = vi.fn<() => Promise<MemberEntry[]>>();
vi.mock('../connect-client', () => ({ listRelatedOrgs: (...a: [string, string]) => listRelatedOrgs(...a) }));
vi.mock('./member-vault', () => ({ loadMembers: () => loadMembers() }));

import { discoverGcoSession } from './gco-discovery';

const ORG = '0x0000000000000000000000000000000000000010' as Address;
const grant = { delegator: ORG, delegate: '0x11' as Address, authority: '0x', caveats: [], salt: '1', signature: '0x' } as MemberEntry['delegation'];

function member(): MemberEntry {
  return { kind: 'gco', sa: ORG, name: 'Hope Org', orgName: 'Hope Church Missions Team', signatory: 'rich', delegation: grant };
}
function link(purpose: string | undefined): RelatedOrgLink {
  return { orgAgent: ORG, orgName: 'Hope Church Missions Team', purpose: purpose as string };
}

beforeEach(() => { listRelatedOrgs.mockReset(); loadMembers.mockReset(); });

describe('discoverGcoSession purpose gating (ADR-0013, no silent fallback)', () => {
  it('recognizes a link explicitly tagged gs-gco-org', async () => {
    listRelatedOrgs.mockResolvedValue([link('gs-gco-org')]);
    loadMembers.mockResolvedValue([member()]);
    const s = await discoverGcoSession('rich', 'tok');
    expect(s?.kind).toBe('gco');
    expect(s?.sa).toBe(ORG);
    expect(s?.grant).toBe(grant);
  });

  it('does NOT recognize a link with a MISSING purpose (stale/migration data)', async () => {
    listRelatedOrgs.mockResolvedValue([link(undefined)]);
    loadMembers.mockResolvedValue([member()]);
    expect(await discoverGcoSession('rich', 'tok')).toBeNull();
    expect(loadMembers).not.toHaveBeenCalled(); // short-circuits before touching the registry
  });

  it('does NOT recognize a link with a DIFFERENT purpose', async () => {
    listRelatedOrgs.mockResolvedValue([link('some-other-app')]);
    loadMembers.mockResolvedValue([member()]);
    expect(await discoverGcoSession('rich', 'tok')).toBeNull();
  });

  it('returns null (not recognized) if related-orgs is unreachable — no fallback read', async () => {
    listRelatedOrgs.mockRejectedValue(new Error('network'));
    expect(await discoverGcoSession('rich', 'tok')).toBeNull();
    expect(loadMembers).not.toHaveBeenCalled();
  });

  it('returns null when the org is gco-tagged but absent from Jane registry (no fabricated grant)', async () => {
    listRelatedOrgs.mockResolvedValue([link('gs-gco-org')]);
    loadMembers.mockResolvedValue([]);
    expect(await discoverGcoSession('rich', 'tok')).toBeNull();
  });
});
