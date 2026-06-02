import { describe, expect, it } from 'vitest';
import {
  PACKAGE_NAME,
  PACKAGE_STATUS,
  SPEC_REF,
  canTransition,
  canTaskTransition,
  isHandoffAllowed,
  assertOutcomeCitations,
} from '../../src/index.js';

describe('fulfillment package identity', () => {
  it('exposes the spec ref + W1 status', () => {
    expect(PACKAGE_NAME).toBe('@agenticprimitives/fulfillment');
    expect(PACKAGE_STATUS).toBe('w1-foundational');
    expect(SPEC_REF).toContain('244-');
  });
});

describe('FulfillmentCase lifecycle state machine', () => {
  it('allows forward transitions per spec 244 §4.2', () => {
    expect(canTransition('drafted', 'clarified')).toBe(true);
    expect(canTransition('committed', 'in_progress')).toBe(true);
    expect(canTransition('fulfilled', 'validated')).toBe(true);
    expect(canTransition('validated', 'archived')).toBe(true);
  });

  it('rejects backward / skipping transitions', () => {
    expect(canTransition('archived', 'in_progress')).toBe(false);
    expect(canTransition('drafted', 'in_progress')).toBe(false);
  });
});

describe('A2A Task state machine (spec 245)', () => {
  it('allows submitted → working → completed', () => {
    expect(canTaskTransition('submitted', 'working')).toBe(true);
    expect(canTaskTransition('working', 'completed')).toBe(true);
  });

  it('allows input-required ↔ working loop', () => {
    expect(canTaskTransition('working', 'input-required')).toBe(true);
    expect(canTaskTransition('input-required', 'working')).toBe(true);
  });

  it('rejects terminal-state exits', () => {
    expect(canTaskTransition('completed', 'working')).toBe(false);
  });
});

describe('FLF-INV-09 handoff policy', () => {
  const policy = {
    allowedTargetAgents: ['0x1111111111111111111111111111111111111111' as const],
    allowedAgentClasses: ['verified-coach'],
    requiresUserApproval: false,
    preservePrivacyTier: true,
    allowedScopes: [],
    maxHopCount: 1,
  };

  it('allows handoff to listed target', () => {
    expect(isHandoffAllowed(policy, '0x1111111111111111111111111111111111111111')).toBe(true);
  });

  it('allows handoff to listed class', () => {
    expect(
      isHandoffAllowed(policy, '0x2222222222222222222222222222222222222222', 'verified-coach'),
    ).toBe(true);
  });

  it('rejects handoff to unlisted target with no class', () => {
    expect(isHandoffAllowed(policy, '0x2222222222222222222222222222222222222222')).toBe(false);
  });
});

describe('FLF-OUT-1 outcome citation invariant', () => {
  it('rejects OutcomeCredential without evidence citation', () => {
    expect(() =>
      assertOutcomeCitations({
        intentId: 'i-1',
        caseId: '0x00',
        intentExpected: {},
        delivered: {},
        actorSatisfaction: 'fully',
        evidenceAssertionUids: [],
      } as unknown as Parameters<typeof assertOutcomeCitations>[0]),
    ).toThrow(/FLF-OUT-1/);
  });

  it('accepts OutcomeCredential with at least one evidence UID', () => {
    expect(() =>
      assertOutcomeCitations({
        intentId: 'i-1',
        caseId: '0x00',
        intentExpected: {},
        delivered: {},
        actorSatisfaction: 'fully',
        evidenceAssertionUids: ['0xaabb'],
      } as unknown as Parameters<typeof assertOutcomeCitations>[0]),
    ).not.toThrow();
  });
});
