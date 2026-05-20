import { describe, it, expect } from 'vitest';
import {
  clampTtlForRiskTier,
  requiredCaveatsForRiskTier,
  evaluateThresholdPolicy,
  RISK_TIER_REQUIREMENTS,
} from '../../src/risk-tier';
import { ThresholdTier } from '../../src/types';
import type { ToolClassification } from '../../src/types';

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

// ─── Spec 207 threshold-policy mapping ────────────────────────────────

describe('evaluateThresholdPolicy', () => {
  const classify = (risk?: 'low' | 'medium' | 'high' | 'critical'): ToolClassification => ({
    '@sa-tool': 'delegation-verified',
    '@sa-auth': 'session-token',
    '@sa-risk-tier': risk,
  });

  it('low → T1 Read, no UV, no quorum, no on-chain blessing', () => {
    const d = evaluateThresholdPolicy(classify('low'));
    expect(d.tier).toBe(ThresholdTier.Read);
    expect(d.requiresQuorum).toBe(false);
    expect(d.requiresUv).toBe(false);
    expect(d.requiresAcceptedOnChain).toBe(false);
  });

  it('medium → T2 Write, UV but no quorum / on-chain blessing', () => {
    const d = evaluateThresholdPolicy(classify('medium'));
    expect(d.tier).toBe(ThresholdTier.Write);
    expect(d.requiresQuorum).toBe(false);
    expect(d.requiresUv).toBe(true);
    expect(d.requiresAcceptedOnChain).toBe(false);
  });

  it('high → T3 Value with quorum + UV but no on-chain blessing', () => {
    const d = evaluateThresholdPolicy(classify('high'));
    expect(d.tier).toBe(ThresholdTier.Value);
    expect(d.requiresQuorum).toBe(true);
    expect(d.requiresUv).toBe(true);
    expect(d.requiresAcceptedOnChain).toBe(false);
  });

  it('critical → T3 Value + ALL gates', () => {
    const d = evaluateThresholdPolicy(classify('critical'));
    expect(d.tier).toBe(ThresholdTier.Value);
    expect(d.requiresQuorum).toBe(true);
    expect(d.requiresUv).toBe(true);
    expect(d.requiresAcceptedOnChain).toBe(true);
  });

  it('unset @sa-risk-tier defaults to low (permissive default; lint catches the missing field)', () => {
    const d = evaluateThresholdPolicy(classify(undefined));
    expect(d.tier).toBe(ThresholdTier.Read);
    expect(d.requiresQuorum).toBe(false);
  });

  it('RISK_TIER_REQUIREMENTS is the source of truth — same shape as the function returns', () => {
    expect(evaluateThresholdPolicy(classify('low'))).toEqual(RISK_TIER_REQUIREMENTS.low);
    expect(evaluateThresholdPolicy(classify('medium'))).toEqual(RISK_TIER_REQUIREMENTS.medium);
    expect(evaluateThresholdPolicy(classify('high'))).toEqual(RISK_TIER_REQUIREMENTS.high);
    expect(evaluateThresholdPolicy(classify('critical'))).toEqual(RISK_TIER_REQUIREMENTS.critical);
  });

  it('ThresholdTier numeric values match spec 207 § 5 (T1=1 ... T6=6)', () => {
    expect(ThresholdTier.Read).toBe(1);
    expect(ThresholdTier.Write).toBe(2);
    expect(ThresholdTier.Value).toBe(3);
    expect(ThresholdTier.Admin).toBe(4);
    expect(ThresholdTier.Critical).toBe(5);
    expect(ThresholdTier.Recovery).toBe(6);
  });
});
