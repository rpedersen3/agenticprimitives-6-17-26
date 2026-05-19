import { describe, it, expect } from 'vitest';
import { clampTtlForRiskTier, requiredCaveatsForRiskTier } from '../../src/risk-tier';

describe('clampTtlForRiskTier', () => {
  it('low/medium clamp at 7 days', () => {
    const sevenDays = 7 * 24 * 60 * 60;
    expect(clampTtlForRiskTier(30 * 24 * 60 * 60, 'low')).toBe(sevenDays);
    expect(clampTtlForRiskTier(sevenDays, 'low')).toBe(sevenDays);
    expect(clampTtlForRiskTier(3600, 'low')).toBe(3600);
  });

  it('high clamps at 1 day', () => {
    const oneDay = 24 * 60 * 60;
    expect(clampTtlForRiskTier(7 * 24 * 60 * 60, 'high')).toBe(oneDay);
    expect(clampTtlForRiskTier(3600, 'high')).toBe(3600);
  });

  it('critical clamps at 1 hour', () => {
    expect(clampTtlForRiskTier(24 * 60 * 60, 'critical')).toBe(3600);
    expect(clampTtlForRiskTier(60, 'critical')).toBe(60);
  });

  it('rejects non-positive TTL', () => {
    expect(() => clampTtlForRiskTier(0, 'low')).toThrow(/positive number/);
    expect(() => clampTtlForRiskTier(-1, 'low')).toThrow(/positive number/);
    expect(() => clampTtlForRiskTier(NaN, 'low')).toThrow(/positive number/);
  });
});

describe('requiredCaveatsForRiskTier', () => {
  it('low requires only timestamp', () => {
    expect(requiredCaveatsForRiskTier('low')).toEqual(['timestamp']);
  });

  it('medium requires timestamp + mcp-tool-scope', () => {
    expect(requiredCaveatsForRiskTier('medium')).toEqual(['timestamp', 'mcp-tool-scope']);
  });

  it('high adds value + data-scope', () => {
    expect(requiredCaveatsForRiskTier('high')).toEqual([
      'timestamp', 'mcp-tool-scope', 'value', 'data-scope',
    ]);
  });

  it('critical requires exact-call', () => {
    expect(requiredCaveatsForRiskTier('critical')).toEqual(['timestamp', 'exact-call']);
  });

  it('returns a fresh array (caller cannot mutate the lookup)', () => {
    const a = requiredCaveatsForRiskTier('low');
    a.push('hacked');
    expect(requiredCaveatsForRiskTier('low')).toEqual(['timestamp']);
  });
});
