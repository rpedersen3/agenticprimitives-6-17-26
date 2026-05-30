// Adversarial-input fuzz for the DELEGATE_BINDING caveat term-shape
// validator (production-readiness wave 1).
//
// Background: the package CLAUDE.md flags DelegateBinding as a known
// regression source — the validator must reject any malformed terms
// shape. Previously `evalInert` was a literal no-op despite its own
// comment promising a sanity-check; verifyCrossDelegation downstream
// was the only defender, and it's stubbed out in v0. This test locks
// the new shape check in place.

import { describe, it, expect } from 'vitest';
import {
  buildDelegateBindingCaveat,
  evaluateCaveats,
  DELEGATE_BINDING_ENFORCER,
  type Caveat,
  type CaveatContext,
  type EnforcerAddressMap,
} from '../../src';
import type { Address, Hex } from 'viem';

const PERSON_AGENT: Address = '0x9cfc7e44757529769a28747f86425c682fe64653';
const SMART_ACCOUNT: Address = '0x31ed17fb99e82e02085ab4b3cbdab05489098b44';
const RANDOM_OTHER: Address = '0xabcdef0123456789abcdef0123456789abcdef01';
const ZERO_ADDR: Address = '0x0000000000000000000000000000000000000000';

const enforcerMap: EnforcerAddressMap = {};
const ctx: CaveatContext = {
  timestamp: 1716595200,
  account: SMART_ACCOUNT,
  delegate: PERSON_AGENT,
};

// H7-B.2: DELEGATE_BINDING is an inert sentinel (the on-chain check is the
// authority). In strict mode the off-chain evaluator denies it with
// 'context-required' regardless of shape; the shape-check fuzz here belongs
// to the on-chain-redeem path, so we pass enforceOnChain:true. The separate
// strict-mode tests below cover the H7-B.2 boundary trap.
function ev(c: Caveat) {
  return evaluateCaveats([c], ctx, enforcerMap, { enforceOnChain: true })[0]!;
}

describe('DELEGATE_BINDING caveat — adversarial shape fuzz', () => {
  it('happy path: well-formed terms with two non-zero addresses → allowed', () => {
    const c = buildDelegateBindingCaveat(SMART_ACCOUNT, PERSON_AGENT);
    expect(ev(c).allowed).toBe(true);
  });

  it('zero smartAccount → reject', () => {
    const c = buildDelegateBindingCaveat(ZERO_ADDR, PERSON_AGENT);
    const v = ev(c);
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/zero address/);
  });

  it('zero personAgent → reject', () => {
    const c = buildDelegateBindingCaveat(SMART_ACCOUNT, ZERO_ADDR);
    const v = ev(c);
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/zero address/);
  });

  it('both zero → reject', () => {
    const c = buildDelegateBindingCaveat(ZERO_ADDR, ZERO_ADDR);
    const v = ev(c);
    expect(v.allowed).toBe(false);
  });

  it('truncated terms (32 bytes instead of 64) → malformed', () => {
    const c: Caveat = {
      enforcer: DELEGATE_BINDING_ENFORCER,
      terms: ('0x' + 'ab'.repeat(32)) as Hex,
      args: '0x',
    };
    const v = ev(c);
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/malformed|length/i);
  });

  it('empty terms → malformed', () => {
    const c: Caveat = { enforcer: DELEGATE_BINDING_ENFORCER, terms: '0x' as Hex, args: '0x' };
    const v = ev(c);
    expect(v.allowed).toBe(false);
  });

  it('absurdly large terms (16 KiB of garbage) → malformed', () => {
    const c: Caveat = {
      enforcer: DELEGATE_BINDING_ENFORCER,
      terms: ('0x' + 'de'.repeat(16384)) as Hex,
      args: '0x',
    };
    const v = ev(c);
    // ABI decoder may either reject or interpret; either way the
    // sanity-check must not accept arbitrary bytes as a valid binding.
    if (v.allowed) {
      // If accepted, the decoded values MUST still be non-zero addresses;
      // otherwise our zero-check should catch it. Either way, can't be a no-op.
      throw new Error('absurdly large terms accepted as valid binding');
    }
    expect(v.allowed).toBe(false);
  });

  it('property: 20 random valid bindings all allowed', () => {
    for (let i = 0; i < 20; i++) {
      const a = `0x${(i + 1).toString(16).padStart(40, '0')}` as Address;
      const b = `0x${(i + 100).toString(16).padStart(40, '0')}` as Address;
      const c = buildDelegateBindingCaveat(a, b);
      expect(ev(c).allowed).toBe(true);
    }
  });

  it('property: any mutation that zeros either address must reject', () => {
    // Generate 50 random pairs, then for each pair zero one field and
    // confirm rejection. Smoke against accidental relaxation of the
    // zero-address rule.
    for (let i = 0; i < 50; i++) {
      const a = `0x${(i + 1).toString(16).padStart(40, '0')}` as Address;
      const b = `0x${(i + 100).toString(16).padStart(40, '0')}` as Address;
      const zeroA = buildDelegateBindingCaveat(ZERO_ADDR, b);
      const zeroB = buildDelegateBindingCaveat(a, ZERO_ADDR);
      expect(ev(zeroA).allowed).toBe(false);
      expect(ev(zeroB).allowed).toBe(false);
      // Non-zero pair stays valid (control).
      expect(ev(buildDelegateBindingCaveat(a, b)).allowed).toBe(true);
    }
  });

  it('does NOT relax in presence of an unrelated other caveat', () => {
    // Compose with a known-allowed caveat and an adversarial binding;
    // the overall evaluator must report the binding rejection.
    const goodBinding = buildDelegateBindingCaveat(SMART_ACCOUNT, RANDOM_OTHER);
    const badBinding = buildDelegateBindingCaveat(ZERO_ADDR, RANDOM_OTHER);
    const verdicts = evaluateCaveats([goodBinding, badBinding], ctx, enforcerMap, {
      enforceOnChain: true,
    });
    expect(verdicts[0]!.allowed).toBe(true);
    expect(verdicts[1]!.allowed).toBe(false);
  });

  it('H7-B.2 strict (default): even well-formed binding denies off-chain', () => {
    // PKG-DELEGATION-001 closure — an off-chain gate cannot rely on the
    // inert sentinel to be permissive. Shape was valid in the happy-path
    // test above; here we pass strict mode (the default) and assert deny.
    const c = buildDelegateBindingCaveat(SMART_ACCOUNT, PERSON_AGENT);
    const v = evaluateCaveats([c], ctx, enforcerMap)[0]!;
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.reason).toContain('context-required');
  });

  it('H7-B.2 strict: malformed binding STILL rejects in strict mode (shape > strictness)', () => {
    // Shape check fires before the strict-mode denial, so the reason
    // surfaces the shape error rather than 'context-required'.
    const truncated: Caveat = {
      enforcer: DELEGATE_BINDING_ENFORCER,
      terms: ('0x' + 'ab'.repeat(32)) as Hex,
      args: '0x',
    };
    const v = evaluateCaveats([truncated], ctx, enforcerMap)[0]!;
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.reason).toMatch(/length|malformed/);
  });
});
