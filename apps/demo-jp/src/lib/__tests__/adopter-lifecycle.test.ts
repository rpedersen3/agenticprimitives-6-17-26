// Unit tests for the Wave-3 adopter lifecycle logic (design spec §10 rail + §15a primary-task states).
// Mirrors demo-gs's `gco-lifecycle.test.ts`. Pure logic → fully unit-testable.

import { describe, expect, it } from 'vitest';
import { adopterLifecycle, type AdopterRequestStatus } from '../adopter-lifecycle';
import type { Attestation, ImpactProfile, JpAdopterRecord } from '../vault';

const att = (docId: string): Attestation => ({ docHash: '0x', docId, signedAt: 1, consentBoundTo: '0x' });

/** An Impact profile with the individual-adopter JP-required contact fields on file. */
const fullProfile: ImpactProfile = {
  v: 1,
  contact: { firstName: 'Rich', lastName: 'Pedersen', email: 'rich@example.com', country: 'United States' },
  attestations: {},
};

/** A fully-onboarded individual adopter record: type chosen, MOU signed, adoption declared. */
const fullRecord: JpAdopterRecord = {
  v: 1,
  adopterType: 'individual',
  attestations: { mou: att('adopt-mou-v1') },
  adoption: { peopleGroupId: 'NAJDI', peopleGroupName: 'Najdi', declaredAt: 1, requestFacilitator: false },
};

const noRequest: AdopterRequestStatus = { requested: false, matched: false, agreement: false };
const currentKey = (steps: { key: string; current: boolean }[]) => steps.find((s) => s.current)?.key;
const doneByKey = (steps: { key: string; done: boolean }[]) =>
  Object.fromEntries(steps.map((s) => [s.key, s.done]));

describe('adopterLifecycle', () => {
  it('setup-needed: empty profile → profile step is current, nothing done', () => {
    const lc = adopterLifecycle({
      impact: { v: 1, attestations: {} },
      record: { v: 1, attestations: {} },
      hasAdopterOrg: false,
      request: noRequest,
    });
    expect(lc.position).toBe('setup-needed');
    expect(currentKey(lc.steps)).toBe('profile');
    expect(doneByKey(lc.steps).profile).toBe(false);
  });

  it('ready-to-request: fully onboarded, no request yet → request is the current step', () => {
    const lc = adopterLifecycle({ impact: fullProfile, record: fullRecord, hasAdopterOrg: false, request: noRequest });
    expect(lc.position).toBe('ready-to-request');
    expect(currentKey(lc.steps)).toBe('request');
    const done = doneByKey(lc.steps);
    expect(done.profile).toBe(true);
    expect(done.mou).toBe(true);
    expect(done.adoption).toBe(true);
    expect(done.request).toBe(false);
  });

  it('under-jp-review: request sent, no match → request step is done', () => {
    const lc = adopterLifecycle({
      impact: fullProfile, record: fullRecord, hasAdopterOrg: false,
      request: { requested: true, matched: false, agreement: false },
    });
    expect(lc.position).toBe('under-jp-review');
    expect(doneByKey(lc.steps).request).toBe(true);
    expect(currentKey(lc.steps)).toBeUndefined(); // every step done
  });

  it('match-ready: a match exists', () => {
    const lc = adopterLifecycle({
      impact: fullProfile, record: fullRecord, hasAdopterOrg: false,
      request: { requested: true, matched: true, agreement: false },
    });
    expect(lc.position).toBe('match-ready');
  });

  it('agreement: a match has progressed to an agreement', () => {
    const lc = adopterLifecycle({
      impact: fullProfile, record: fullRecord, hasAdopterOrg: false,
      request: { requested: true, matched: true, agreement: true },
    });
    expect(lc.position).toBe('agreement');
  });

  it('the optional adopter-org step never captures `current`', () => {
    // Org missing but it is optional → `current` stays on the first blocking step (mou here), not org.
    const recordNoMou: JpAdopterRecord = { v: 1, adopterType: 'individual', attestations: {} };
    const lc = adopterLifecycle({ impact: fullProfile, record: recordNoMou, hasAdopterOrg: false, request: noRequest });
    expect(currentKey(lc.steps)).toBe('mou');
    expect(doneByKey(lc.steps).org).toBe(false);
  });

  it('church adopter inserts a WEA step', () => {
    const churchProfile: ImpactProfile = {
      v: 1,
      contact: { ...fullProfile.contact, organizationName: 'Grace Church', organizationCountry: 'United States' },
      attestations: { wea: { docId: 'wea', hash: '0x', signature: '0x', signedAt: '2026-01-01' } as never },
    };
    const churchRecord: JpAdopterRecord = { ...fullRecord, adopterType: 'church' };
    const lc = adopterLifecycle({ impact: churchProfile, record: churchRecord, hasAdopterOrg: true, request: noRequest });
    expect(lc.steps.some((s) => s.key === 'wea')).toBe(true);
    expect(doneByKey(lc.steps).wea).toBe(true);
  });
});
