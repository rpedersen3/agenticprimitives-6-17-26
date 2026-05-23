import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '../../src/decision';
import type { PolicyContext, ToolClassification } from '../../src/types';

function ctx(overrides: Partial<PolicyContext>): PolicyContext {
  return {
    toolName: 'test_tool',
    // Fully-qualified classification: tool + auth + risk tier.
    // (Pre-Wave-2 fixture omitted risk-tier; that's now a deny condition
    // for user-facing tools per the fail-closed shape gate.)
    classification: {
      '@sa-tool': 'delegation-verified',
      '@sa-auth': 'session-token',
      '@sa-risk-tier': 'low',
    },
    callerKind: 'user-session',
    ...overrides,
  };
}

const PRESENT_DELEGATION = {
  delegator: '0x1111111111111111111111111111111111111111' as const,
  delegate: '0x2222222222222222222222222222222222222222' as const,
  caveats: [],
};

describe('evaluatePolicy (decision engine)', () => {
  it('allows a delegation-verified tool with valid delegation', () => {
    const d = evaluatePolicy(ctx({ delegation: PRESENT_DELEGATION }));
    expect(d.decision).toBe('allow');
  });

  it('denies @sa-tool:delegation-verified with no delegation', () => {
    const d = evaluatePolicy(ctx({ delegation: undefined }));
    expect(d.decision).toBe('deny');
    if (d.decision === 'deny') expect(d.reason).toContain('delegation');
  });

  it('denies @sa-auth:none for non-service caller', () => {
    const cls: ToolClassification = { '@sa-tool': 'delegation-verified', '@sa-auth': 'none' };
    const d = evaluatePolicy(ctx({ classification: cls }));
    expect(d.decision).toBe('deny');
  });

  it('allows @sa-auth:none for service caller', () => {
    const cls: ToolClassification = { '@sa-tool': 'service-only', '@sa-auth': 'none' };
    const d = evaluatePolicy(ctx({ classification: cls, callerKind: 'service' }));
    expect(d.decision).toBe('allow');
  });

  it('denies @sa-tool:service-only for user-session caller', () => {
    const cls: ToolClassification = { '@sa-tool': 'service-only', '@sa-auth': 'service-hmac' };
    const d = evaluatePolicy(ctx({ classification: cls, callerKind: 'user-session' }));
    expect(d.decision).toBe('deny');
  });

  it('allows @sa-tool:service-only for service caller', () => {
    const cls: ToolClassification = { '@sa-tool': 'service-only', '@sa-auth': 'service-hmac' };
    const d = evaluatePolicy(ctx({ classification: cls, callerKind: 'service' }));
    expect(d.decision).toBe('allow');
  });

  it('denies @sa-tool:bootstrap for user caller', () => {
    const cls: ToolClassification = { '@sa-tool': 'bootstrap', '@sa-auth': 'service-hmac' };
    const d = evaluatePolicy(ctx({ classification: cls, callerKind: 'user-session' }));
    expect(d.decision).toBe('deny');
  });

  it('denies @sa-tool:dev-only unconditionally (explicit gate required)', () => {
    const cls: ToolClassification = { '@sa-tool': 'dev-only', '@sa-auth': 'none' };
    const d = evaluatePolicy(ctx({ classification: cls, callerKind: 'service' }));
    expect(d.decision).toBe('deny');
  });

  it('requires consent on @sa-risk-tier:critical', () => {
    const cls: ToolClassification = {
      '@sa-tool': 'delegation-verified',
      '@sa-auth': 'session-token',
      '@sa-risk-tier': 'critical',
    };
    const d = evaluatePolicy(ctx({ classification: cls, delegation: PRESENT_DELEGATION }));
    expect(d.decision).toBe('requires-consent');
    if (d.decision === 'requires-consent') {
      expect(d.risk).toBe('critical');
      expect(d.promptId).toContain('test_tool');
    }
  });

  it('is deterministic — same context → same decision', () => {
    const c = ctx({ delegation: PRESENT_DELEGATION });
    const a = evaluatePolicy(c);
    const b = evaluatePolicy(c);
    expect(a).toEqual(b);
  });

  it('low/medium/high tier without other red flags → allow', () => {
    for (const risk of ['low', 'medium', 'high'] as const) {
      const cls: ToolClassification = {
        '@sa-tool': 'delegation-verified',
        '@sa-auth': 'session-token',
        '@sa-risk-tier': risk,
      };
      const d = evaluatePolicy(ctx({ classification: cls, delegation: PRESENT_DELEGATION }));
      expect(d.decision, `risk=${risk}`).toBe('allow');
    }
  });
});
