// Risk-tier helpers. The taxonomy is the binding contract — these helpers
// surface "what should issuance demand for this tier."

import type { RiskTier } from './types';

const TTL_CLAMP_SECONDS: Record<RiskTier, number> = {
  low: 7 * 24 * 60 * 60,        // 7 days
  medium: 7 * 24 * 60 * 60,     // 7 days
  high: 24 * 60 * 60,           // 1 day
  critical: 60 * 60,            // 1 hour
};

const REQUIRED_CAVEATS: Record<RiskTier, string[]> = {
  low: ['timestamp'],
  medium: ['timestamp', 'mcp-tool-scope'],
  high: ['timestamp', 'mcp-tool-scope', 'value', 'data-scope'],
  critical: ['timestamp', 'exact-call'],
};

export function clampTtlForRiskTier(requestedTtlSec: number, risk: RiskTier): number {
  if (!Number.isFinite(requestedTtlSec) || requestedTtlSec <= 0) {
    throw new Error('clampTtlForRiskTier: requestedTtlSec must be a positive number');
  }
  const max = TTL_CLAMP_SECONDS[risk];
  return Math.min(requestedTtlSec, max);
}

export function requiredCaveatsForRiskTier(risk: RiskTier): string[] {
  return [...REQUIRED_CAVEATS[risk]];
}
