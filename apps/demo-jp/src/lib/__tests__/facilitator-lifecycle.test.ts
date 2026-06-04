// Unit tests for the Wave-4 facilitator lifecycle logic (design spec §11 rail + §15a "Facilitator
// Workspace" primary-task states). Mirrors Wave 3's `adopter-lifecycle.test.ts`. Pure logic → fully
// unit-testable.

import { describe, expect, it } from 'vitest';
import { facilitatorLifecycle, type FacilitatorMatchStatus } from '../facilitator-lifecycle';
import type { Attestation, ImpactProfile, JpFacilitatorRecord } from '../vault';

const att = (docId: string): Attestation => ({ docHash: '0x', docId, signedAt: 1, consentBoundTo: '0x' });

/** An Impact profile with the org-required JP contact fields on file + WEA signed (facilitators are
 *  always treated as 'organization' + always require WEA). */
const fullProfile: ImpactProfile = {
  v: 1,
  contact: {
    firstName: 'Rich',
    lastName: 'Pedersen',
    email: 'rich@example.com',
    country: 'United States',
    organizationName: 'Frontier Path Network',
    organizationCountry: 'United States',
  },
  attestations: { wea: { docId: 'wea', hash: '0x', signature: '0x', signedAt: '2026-01-01' } as never },
};

/** A coverage declaration with a capacity matrix (people groups + adopter types + size bands + areas). */
const fullCoverage: NonNullable<JpFacilitatorRecord['coverage']> = {
  peopleGroupIds: ['fpg-najdi-sa'],
  capacity: {
    adopterTypes: ['individual'],
    sizeBands: ['small'],
    ministryAreas: ['prayer-mobilization'],
  },
  declaredAt: 1,
};

/** A fully set-up facilitator (profile/WEA/MOU) WITHOUT coverage yet. */
const setupNoCoverage: JpFacilitatorRecord = { v: 1, attestations: { mou: att('adopt-mou-v1') } };
/** A fully set-up facilitator WITH coverage declared. */
const fullRecord: JpFacilitatorRecord = { ...setupNoCoverage, coverage: fullCoverage };

const noMatch: FacilitatorMatchStatus = { matched: false, agreement: false };
const currentKey = (steps: { key: string; current: boolean }[]) => steps.find((s) => s.current)?.key;
const doneByKey = (steps: { key: string; done: boolean }[]) =>
  Object.fromEntries(steps.map((s) => [s.key, s.done]));

describe('facilitatorLifecycle', () => {
  it('setup-needed: empty profile → profile step is current, nothing done', () => {
    const lc = facilitatorLifecycle({
      impact: { v: 1, attestations: {} },
      record: { v: 1, attestations: {} },
      hasFacilitatorOrg: false,
      match: noMatch,
    });
    expect(lc.position).toBe('setup-needed');
    expect(currentKey(lc.steps)).toBe('profile');
    expect(doneByKey(lc.steps).profile).toBe(false);
  });

  it('setup-needed: profile/WEA on file but no MOU → mou is current', () => {
    const lc = facilitatorLifecycle({
      impact: fullProfile,
      record: { v: 1, attestations: {} },
      hasFacilitatorOrg: false,
      match: noMatch,
    });
    expect(lc.position).toBe('setup-needed');
    expect(currentKey(lc.steps)).toBe('mou');
    const done = doneByKey(lc.steps);
    expect(done.profile).toBe(true);
    expect(done.mou).toBe(false);
  });

  it('coverage-draft: setup done, coverage not declared → coverage is the current step', () => {
    const lc = facilitatorLifecycle({
      impact: fullProfile,
      record: setupNoCoverage,
      hasFacilitatorOrg: false,
      match: noMatch,
    });
    expect(lc.position).toBe('coverage-draft');
    expect(currentKey(lc.steps)).toBe('coverage');
    const done = doneByKey(lc.steps);
    expect(done.profile).toBe(true);
    expect(done.mou).toBe(true);
    expect(done.coverage).toBe(false);
  });

  it('matches-empty: coverage published, no matched adopters → matches is current', () => {
    const lc = facilitatorLifecycle({
      impact: fullProfile,
      record: fullRecord,
      hasFacilitatorOrg: false,
      match: noMatch,
    });
    expect(lc.position).toBe('matches-empty');
    expect(currentKey(lc.steps)).toBe('matches');
    expect(doneByKey(lc.steps).coverage).toBe(true);
    expect(doneByKey(lc.steps).matches).toBe(false);
  });

  it('matches-pending: a matched adopter exists → matches done, every step done', () => {
    const lc = facilitatorLifecycle({
      impact: fullProfile,
      record: fullRecord,
      hasFacilitatorOrg: false,
      match: { matched: true, agreement: false },
    });
    expect(lc.position).toBe('matches-pending');
    expect(doneByKey(lc.steps).matches).toBe(true);
    expect(currentKey(lc.steps)).toBeUndefined(); // every (non-org) step done
  });

  it('agreement-requested: a match has progressed toward an agreement', () => {
    const lc = facilitatorLifecycle({
      impact: fullProfile,
      record: fullRecord,
      hasFacilitatorOrg: false,
      match: { matched: true, agreement: true },
    });
    expect(lc.position).toBe('agreement-requested');
  });

  it('the optional facilitator-org step never captures `current`', () => {
    // Org missing but it is optional → `current` stays on the first blocking step (mou here), not org.
    const lc = facilitatorLifecycle({
      impact: fullProfile,
      record: { v: 1, attestations: {} },
      hasFacilitatorOrg: false,
      match: noMatch,
    });
    expect(currentKey(lc.steps)).toBe('mou');
    expect(doneByKey(lc.steps).org).toBe(false);
  });

  it('org present marks the org step done without affecting position', () => {
    const lc = facilitatorLifecycle({
      impact: fullProfile,
      record: fullRecord,
      hasFacilitatorOrg: true,
      match: noMatch,
    });
    expect(doneByKey(lc.steps).org).toBe(true);
    expect(lc.position).toBe('matches-empty');
  });
});
