import { describe, expect, it } from 'vitest';
import { agreementTimeline, isOffRamp } from './agreement-timeline';
import type { GsAgreement, GsConnectionStatus } from '../domain/gs-status';

const agree = (status: GsConnectionStatus) => ({ status } as Pick<GsAgreement, 'status'>);
const stateByKey = (steps: { key: string; state: string }[]) =>
  Object.fromEntries(steps.map((s) => [s.key, s.state]));
const currentKey = (steps: { key: string; state: string }[]) => steps.find((s) => s.state === 'current')?.key;

describe('agreementTimeline', () => {
  it('always returns the 7-milestone backbone on the four lanes', () => {
    const steps = agreementTimeline(agree('proposed'));
    expect(steps.map((s) => s.key)).toEqual(['need', 'score', 'propose', 'request', 'accept', 'issue', 'fulfil']);
    expect(steps.map((s) => s.lane)).toEqual(['gco', 'broker', 'broker', 'gco', 'kc', 'issuer', 'issuer']);
  });

  it('proposed: nothing reached yet → first milestone (need) is current', () => {
    const steps = agreementTimeline(agree('proposed'));
    expect(currentKey(steps)).toBe('need');
    expect(steps.every((s) => s.state !== 'done')).toBe(true);
  });

  it('requested: request-era milestones done → accept is current', () => {
    const m = stateByKey(agreementTimeline(agree('requested')));
    expect(m).toMatchObject({ need: 'done', score: 'done', propose: 'done', request: 'done', accept: 'current', issue: 'upcoming', fulfil: 'upcoming' });
  });

  it('confirmed: through issuance done → ongoing/fulfilled is current', () => {
    const m = stateByKey(agreementTimeline(agree('confirmed')));
    expect(m.accept).toBe('done');
    expect(m.issue).toBe('done');
    expect(m.fulfil).toBe('current');
  });

  it('ongoing: still on the fulfilment milestone (not yet fulfilled)', () => {
    const m = stateByKey(agreementTimeline(agree('ongoing')));
    expect(m.issue).toBe('done');
    expect(m.fulfil).toBe('current');
  });

  it('fulfilled: every milestone done, none current', () => {
    const steps = agreementTimeline(agree('fulfilled'));
    expect(steps.every((s) => s.state === 'done')).toBe(true);
    expect(currentKey(steps)).toBeUndefined();
  });

  it('kc_declined: off-ramp keeps request-era milestones done but nothing becomes current', () => {
    const steps = agreementTimeline(agree('kc_declined'));
    const m = stateByKey(steps);
    expect(m.request).toBe('done');
    expect(m.accept).toBe('upcoming');
    expect(currentKey(steps)).toBeUndefined();
  });

  it('gco_concluded: an off-ramp after confirmation → no current step', () => {
    expect(currentKey(agreementTimeline(agree('gco_concluded')))).toBeUndefined();
  });

  it('isOffRamp flags declines and conclusions only', () => {
    expect(isOffRamp('kc_declined')).toBe(true);
    expect(isOffRamp('gco_declined')).toBe(true);
    expect(isOffRamp('gco_concluded')).toBe(true);
    expect(isOffRamp('kc_concluded')).toBe(true);
    expect(isOffRamp('confirmed')).toBe(false);
    expect(isOffRamp('fulfilled')).toBe(false);
  });
});
