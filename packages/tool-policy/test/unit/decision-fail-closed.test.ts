// evaluatePolicy fail-closed negative-test matrix (audit P0-1).
//
// Every shape the auditor flagged as silently allowed must now deny.
// These tests are the regression lock against any future "let's add a
// permissive default" PR.

import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '../../src/decision';
import type { PolicyContext, ToolClassification } from '../../src/types';

function ctx(cls: ToolClassification): PolicyContext {
  return {
    toolName: 'fuzzed_tool',
    classification: cls,
    callerKind: 'user-session',
    delegation: {
      delegator: '0x1111111111111111111111111111111111111111',
      delegate: '0x2222222222222222222222222222222222222222',
      caveats: [],
    },
  };
}

describe('evaluatePolicy — fail-closed shape gate', () => {
  it('empty classification → deny', () => {
    const d = evaluatePolicy(ctx({} as ToolClassification));
    expect(d.decision).toBe('deny');
  });

  it('missing @sa-tool → deny', () => {
    const d = evaluatePolicy(
      ctx({ '@sa-auth': 'session-token', '@sa-risk-tier': 'low' } as unknown as ToolClassification),
    );
    expect(d.decision).toBe('deny');
    if (d.decision === 'deny') expect(d.reason).toMatch(/@sa-tool/);
  });

  it('missing @sa-auth → deny', () => {
    const d = evaluatePolicy(
      ctx({ '@sa-tool': 'delegation-verified', '@sa-risk-tier': 'low' } as unknown as ToolClassification),
    );
    expect(d.decision).toBe('deny');
    if (d.decision === 'deny') expect(d.reason).toMatch(/@sa-auth/);
  });

  it('missing @sa-risk-tier on user-facing tool → deny', () => {
    const d = evaluatePolicy(
      ctx({ '@sa-tool': 'delegation-verified', '@sa-auth': 'session-token' } as ToolClassification),
    );
    expect(d.decision).toBe('deny');
    if (d.decision === 'deny') expect(d.reason).toMatch(/@sa-risk-tier/);
  });

  it('unknown @sa-tool value → deny', () => {
    const d = evaluatePolicy(
      ctx({
        '@sa-tool': 'super-secret-mode' as never,
        '@sa-auth': 'session-token',
        '@sa-risk-tier': 'low',
      }),
    );
    expect(d.decision).toBe('deny');
  });

  it('unknown @sa-auth value → deny', () => {
    const d = evaluatePolicy(
      ctx({
        '@sa-tool': 'delegation-verified',
        '@sa-auth': 'magic-trust-me' as never,
        '@sa-risk-tier': 'low',
      }),
    );
    expect(d.decision).toBe('deny');
  });

  it('unknown @sa-risk-tier value → deny', () => {
    const d = evaluatePolicy(
      ctx({
        '@sa-tool': 'delegation-verified',
        '@sa-auth': 'session-token',
        '@sa-risk-tier': 'extreme' as never,
      }),
    );
    expect(d.decision).toBe('deny');
  });

  it('non-string @sa-tool → deny', () => {
    const d = evaluatePolicy(
      ctx({
        '@sa-tool': 42 as never,
        '@sa-auth': 'session-token',
        '@sa-risk-tier': 'low',
      }),
    );
    expect(d.decision).toBe('deny');
  });

  it('service-only with no risk-tier is allowed when caller=service (no human risk dimension)', () => {
    const d = evaluatePolicy({
      toolName: 'health_check',
      classification: { '@sa-tool': 'service-only', '@sa-auth': 'service-hmac' },
      callerKind: 'service',
    });
    expect(d.decision).toBe('allow');
  });

  it('service-only with unknown risk-tier → deny', () => {
    const d = evaluatePolicy({
      toolName: 'health_check',
      classification: {
        '@sa-tool': 'service-only',
        '@sa-auth': 'service-hmac',
        '@sa-risk-tier': 'extreme' as never,
      },
      callerKind: 'service',
    });
    expect(d.decision).toBe('deny');
  });

  it('classification with extra unknown key is still allowed (forward-compat)', () => {
    // Unknown EXTRA keys are OK (forward compat for future tags); we
    // only fail closed on unknown VALUES for known tags. The lint
    // layer is what flags unknown extra keys at registration time.
    const d = evaluatePolicy(
      ctx({
        '@sa-tool': 'delegation-verified',
        '@sa-auth': 'session-token',
        '@sa-risk-tier': 'low',
        '@sa-future-tag': 'whatever',
      } as ToolClassification),
    );
    expect(d.decision).toBe('allow');
  });
});
