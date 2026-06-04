import { describe, expect, it } from 'vitest';
import { gcoLifecycle } from './gco-lifecycle';
import type { GcoNeedIntent } from '../domain/gs-types';
import type { GsAgreement, GsConnectionStatus } from '../domain/gs-status';

const need = (status: GcoNeedIntent['status']): GcoNeedIntent =>
  ({ id: `n:${status}:${Math.random()}`, status } as unknown as GcoNeedIntent);
const agreement = (status: GsConnectionStatus): GsAgreement =>
  ({ id: `a:${status}:${Math.random()}`, status } as unknown as GsAgreement);

/** Helper: the current step's key (the first not-done rail step). */
const currentKey = (steps: { key: string; current: boolean }[]) => steps.find((s) => s.current)?.key;
/** Helper: a map of done flags by key. */
const doneByKey = (steps: { key: string; done: boolean }[]) =>
  Object.fromEntries(steps.map((s) => [s.key, s.done]));

describe('gcoLifecycle', () => {
  it('org-pending: no org session → only org step is current, nothing done', () => {
    const lc = gcoLifecycle({ hasOrg: false, needs: [], agreements: [] });
    expect(lc.position).toBe('org-pending');
    expect(currentKey(lc.steps)).toBe('org');
    expect(doneByKey(lc.steps)).toEqual({ org: false, need: false, match: false, request: false, agreement: false });
  });

  it('no-need: org ready, nothing posted → need is current', () => {
    const lc = gcoLifecycle({ hasOrg: true, needs: [], agreements: [] });
    expect(lc.position).toBe('no-need');
    expect(currentKey(lc.steps)).toBe('need');
    expect(doneByKey(lc.steps).org).toBe(true);
  });

  it('need-posted: a live need, no request → match is current', () => {
    const lc = gcoLifecycle({ hasOrg: true, needs: [need('open')], agreements: [] });
    expect(lc.position).toBe('need-posted');
    expect(doneByKey(lc.steps).need).toBe(true);
    expect(currentKey(lc.steps)).toBe('match');
  });

  it('withdrawn needs do not count as posted', () => {
    const lc = gcoLifecycle({ hasOrg: true, needs: [need('withdrawn')], agreements: [] });
    expect(lc.position).toBe('no-need');
    expect(doneByKey(lc.steps).need).toBe(false);
  });

  it('request-pending: a requested agreement → request done, agreement current', () => {
    const lc = gcoLifecycle({ hasOrg: true, needs: [need('open')], agreements: [agreement('requested')] });
    expect(lc.position).toBe('request-pending');
    expect(doneByKey(lc.steps).match).toBe(true);
    expect(doneByKey(lc.steps).request).toBe(true);
    expect(doneByKey(lc.steps).agreement).toBe(false);
    expect(currentKey(lc.steps)).toBe('agreement');
  });

  it('agreement-issued: a confirmed agreement → all steps done, none current', () => {
    const lc = gcoLifecycle({ hasOrg: true, needs: [need('open')], agreements: [agreement('confirmed')] });
    expect(lc.position).toBe('agreement-issued');
    expect(doneByKey(lc.steps).agreement).toBe(true);
    expect(currentKey(lc.steps)).toBeUndefined();
  });

  it('a fulfilled agreement also counts as issued', () => {
    const lc = gcoLifecycle({ hasOrg: true, needs: [need('open')], agreements: [agreement('fulfilled')] });
    expect(lc.position).toBe('agreement-issued');
  });
});
