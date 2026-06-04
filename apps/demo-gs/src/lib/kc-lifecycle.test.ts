import { describe, expect, it } from 'vitest';
import { kcLifecycle } from './kc-lifecycle';
import type { GsAgreement, GsConnectionStatus } from '../domain/gs-status';

const agreement = (status: GsConnectionStatus): GsAgreement =>
  ({ id: `a:${status}:${Math.random()}`, status } as unknown as GsAgreement);

/** Helper: the current step's key (the first not-done rail step). */
const currentKey = (steps: { key: string; current: boolean }[]) => steps.find((s) => s.current)?.key;
/** Helper: a map of done flags by key. */
const doneByKey = (steps: { key: string; done: boolean }[]) =>
  Object.fromEntries(steps.map((s) => [s.key, s.done]));

describe('kcLifecycle', () => {
  it('no-offering: connected, nothing published → offering is current, only connected done', () => {
    const lc = kcLifecycle({ hasOffering: false, agreements: [] });
    expect(lc.position).toBe('no-offering');
    expect(currentKey(lc.steps)).toBe('offering');
    expect(doneByKey(lc.steps)).toEqual({ connected: true, offering: false, requests: false, accepted: false, agreement: false });
  });

  it('offering-published: an offering, no requests → requests is current', () => {
    const lc = kcLifecycle({ hasOffering: true, agreements: [] });
    expect(lc.position).toBe('offering-published');
    expect(doneByKey(lc.steps).offering).toBe(true);
    expect(currentKey(lc.steps)).toBe('requests');
  });

  it('requests-pending: an open requested agreement → requests done, accepted current', () => {
    const lc = kcLifecycle({ hasOffering: true, agreements: [agreement('requested')] });
    expect(lc.position).toBe('requests-pending');
    expect(doneByKey(lc.steps).requests).toBe(true);
    expect(doneByKey(lc.steps).accepted).toBe(false);
    expect(currentKey(lc.steps)).toBe('accepted');
  });

  it('accepted: a confirmed agreement → requests + accepted done, agreement current', () => {
    const lc = kcLifecycle({ hasOffering: true, agreements: [agreement('confirmed')] });
    expect(lc.position).toBe('accepted');
    expect(doneByKey(lc.steps).requests).toBe(true);
    expect(doneByKey(lc.steps).accepted).toBe(true);
    expect(doneByKey(lc.steps).agreement).toBe(false);
    expect(currentKey(lc.steps)).toBe('agreement');
  });

  it('an ongoing agreement also counts as accepted', () => {
    const lc = kcLifecycle({ hasOffering: true, agreements: [agreement('ongoing')] });
    expect(lc.position).toBe('accepted');
  });

  it('agreement-issued: a fulfilled agreement → all steps done, none current', () => {
    const lc = kcLifecycle({ hasOffering: true, agreements: [agreement('fulfilled')] });
    expect(lc.position).toBe('agreement-issued');
    expect(doneByKey(lc.steps).agreement).toBe(true);
    expect(currentKey(lc.steps)).toBeUndefined();
  });

  it('no offering wins over any agreement state (must publish first)', () => {
    const lc = kcLifecycle({ hasOffering: false, agreements: [agreement('confirmed')] });
    expect(lc.position).toBe('no-offering');
    expect(currentKey(lc.steps)).toBe('offering');
  });
});
