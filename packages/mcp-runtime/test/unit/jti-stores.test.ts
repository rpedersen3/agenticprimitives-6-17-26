import { describe, it, expect } from 'vitest';
import { createMemoryJtiStore } from '../../src/jti-stores';

describe('createMemoryJtiStore', () => {
  it('first use is usage=1, allowed under limit', async () => {
    const s = createMemoryJtiStore();
    const r = await s.trackUsage('jti_1', 10);
    expect(r.usage).toBe(1);
    expect(r.allowed).toBe(true);
  });

  it('increments per call until limit then rejects', async () => {
    const s = createMemoryJtiStore();
    for (let i = 1; i <= 5; i++) {
      const r = await s.trackUsage('jti_x', 5);
      expect(r.usage).toBe(i);
      expect(r.allowed).toBe(true);
    }
    const sixth = await s.trackUsage('jti_x', 5);
    expect(sixth.usage).toBe(6);
    expect(sixth.allowed).toBe(false);
  });

  it('different jtis are independent', async () => {
    const s = createMemoryJtiStore();
    await s.trackUsage('a', 1);
    await s.trackUsage('a', 1);
    const b = await s.trackUsage('b', 1);
    expect(b.usage).toBe(1);
    expect(b.allowed).toBe(true);
  });

  it('atomic under simulated concurrency (100 parallel writers, single jti)', async () => {
    const s = createMemoryJtiStore();
    const results = await Promise.all(
      Array.from({ length: 100 }, () => s.trackUsage('concurrent', 100)),
    );
    // All 100 calls succeeded; the highest usage is exactly 100.
    const max = Math.max(...results.map((r) => r.usage));
    expect(max).toBe(100);
    // Every reported usage is unique (no double-count).
    const usages = results.map((r) => r.usage).sort((a, b) => a - b);
    expect(usages).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });
});
