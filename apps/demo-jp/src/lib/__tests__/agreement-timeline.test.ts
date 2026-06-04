// Unit tests for the Wave-5 match→agreement swimlane logic (design spec §15a "Match And Agreement
// Timeline"). Mirrors demo-gs's `agreement-timeline.test.ts`. Pure logic → fully unit-testable.

import { describe, expect, it } from 'vitest';
import {
  agreementTimeline, matchPhase, LANE_ORDER, type MatchTimelineInput,
} from '../agreement-timeline';

const input = (p: Partial<MatchTimelineInput>): MatchTimelineInput =>
  ({ requested: false, matched: false, consented: false, ...p });
const stateByKey = (steps: { key: string; state: string }[]) =>
  Object.fromEntries(steps.map((s) => [s.key, s.state]));
const currentKey = (steps: { key: string; state: string }[]) => steps.find((s) => s.state === 'current')?.key;

describe('matchPhase', () => {
  it('not requested → declared', () => {
    expect(matchPhase(input({ requested: false }))).toBe('declared');
  });
  it('requested but unmatched → declared (request on file, no match yet)', () => {
    expect(matchPhase(input({ requested: true }))).toBe('declared');
  });
  it('requested + matched → matched', () => {
    expect(matchPhase(input({ requested: true, matched: true }))).toBe('matched');
  });
  it('consent dominates → consented even with matched true', () => {
    expect(matchPhase(input({ requested: true, matched: true, consented: true }))).toBe('consented');
  });
});

describe('agreementTimeline', () => {
  it('always returns the 6-milestone backbone on the four lanes', () => {
    const steps = agreementTimeline(input({}));
    expect(steps.map((s) => s.key)).toEqual(['declared', 'propose', 'consent', 'draft', 'issue', 'assert']);
    expect(steps.map((s) => s.lane)).toEqual(['adopter', 'broker', 'facilitator', 'broker', 'issuer', 'issuer']);
  });

  it('LANE_ORDER is the four fixed parties top→bottom', () => {
    expect(LANE_ORDER).toEqual(['adopter', 'broker', 'facilitator', 'issuer']);
  });

  it('declared: nothing matched yet → declared is done, propose is current', () => {
    const m = stateByKey(agreementTimeline(input({ requested: true })));
    expect(m).toMatchObject({ declared: 'done', propose: 'current', consent: 'upcoming' });
  });

  it('matched: match surfaced → propose done, consent is current', () => {
    const m = stateByKey(agreementTimeline(input({ requested: true, matched: true })));
    expect(m).toMatchObject({ declared: 'done', propose: 'done', consent: 'current' });
  });

  it('consented: contact exchanged → consent done; the next current is a stub-free... nothing', () => {
    const steps = agreementTimeline(input({ requested: true, matched: true, consented: true }));
    const m = stateByKey(steps);
    expect(m.consent).toBe('done');
    // draft/issue/assert are member-unreadable stubs → never current, never done.
    expect(currentKey(steps)).toBeUndefined();
  });

  it('issuance + draft + assertion milestones are honest stubs — never done, never current', () => {
    for (const inp of [input({}), input({ requested: true, matched: true, consented: true })]) {
      const m = stateByKey(agreementTimeline(inp));
      expect(m.draft).not.toBe('done');
      expect(m.draft).not.toBe('current');
      expect(m.issue).not.toBe('done');
      expect(m.issue).not.toBe('current');
      expect(m.assert).not.toBe('done');
      expect(m.assert).not.toBe('current');
    }
  });

  it('the stub milestones carry the stub flag', () => {
    const steps = agreementTimeline(input({}));
    const flag = (key: string) => steps.find((s) => s.key === key)?.stub;
    expect(flag('draft')).toBe(true);
    expect(flag('issue')).toBe(true);
    expect(flag('assert')).toBe(true);
    expect(flag('declared')).toBeUndefined();
  });
});
