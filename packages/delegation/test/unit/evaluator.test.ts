import { describe, it, expect } from 'vitest';
import { evaluateCaveats } from '../../src/evaluator';
import {
  buildCaveat,
  buildMcpToolScopeCaveat,
  encodeTimestampTerms,
  encodeAllowedTargetsTerms,
  encodeValueTerms,
} from '../../src/caveats';
import type { EnforcerAddressMap } from '../../src/types';

const ENFORCERS: EnforcerAddressMap = {
  delegationManager: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  timestamp: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
  value: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
  allowedTargets: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
  allowedMethods: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
};

describe('evaluateCaveats — fail-closed dispatcher (security invariant)', () => {
  it('unknown enforcer → denies (fail-closed)', () => {
    const v = evaluateCaveats(
      [buildCaveat('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', '0xaa')],
      { timestamp: 1000 },
      ENFORCERS,
    );
    expect(v).toHaveLength(1);
    expect(v[0]!.allowed).toBe(false);
    if (!v[0]!.allowed) expect(v[0]!.reason).toBe('unknown enforcer');
  });

  it('empty enforcer map: ALL caveats denied (the registry is the only door)', () => {
    const empty: EnforcerAddressMap = {
      delegationManager: '0x0000000000000000000000000000000000000001',
      timestamp: '0x0000000000000000000000000000000000000000', // junk, won't match
      value: '0x0000000000000000000000000000000000000000',
      allowedTargets: '0x0000000000000000000000000000000000000000',
      allowedMethods: '0x0000000000000000000000000000000000000000',
    };
    const v = evaluateCaveats(
      [buildCaveat(ENFORCERS.timestamp, encodeTimestampTerms(0, 9999))],
      { timestamp: 1000 },
      empty,
    );
    expect(v[0]!.allowed).toBe(false);
  });
});

describe('evaluateCaveats — timestamp', () => {
  it('allows when timestamp is in [validAfter, validUntil)', () => {
    const c = buildCaveat(ENFORCERS.timestamp, encodeTimestampTerms(1000, 2000));
    const v = evaluateCaveats([c], { timestamp: 1500 }, ENFORCERS);
    expect(v[0]!.allowed).toBe(true);
  });

  it('denies before validAfter', () => {
    const c = buildCaveat(ENFORCERS.timestamp, encodeTimestampTerms(1000, 2000));
    const v = evaluateCaveats([c], { timestamp: 500 }, ENFORCERS);
    expect(v[0]!.allowed).toBe(false);
    if (!v[0]!.allowed) expect(v[0]!.reason).toContain('validAfter');
  });

  it('denies at/after validUntil (half-open interval)', () => {
    const c = buildCaveat(ENFORCERS.timestamp, encodeTimestampTerms(1000, 2000));
    const v = evaluateCaveats([c], { timestamp: 2000 }, ENFORCERS);
    expect(v[0]!.allowed).toBe(false);
    if (!v[0]!.allowed) expect(v[0]!.reason).toContain('validUntil');
  });
});

describe('evaluateCaveats — MCP_TOOL_SCOPE sentinel', () => {
  it('allows when tool is in scope', () => {
    const c = buildMcpToolScopeCaveat(['get_profile', 'update_profile']);
    const v = evaluateCaveats([c], { timestamp: 1000, mcpTool: 'get_profile' }, ENFORCERS);
    expect(v[0]!.allowed).toBe(true);
  });

  it('denies when tool not in scope', () => {
    const c = buildMcpToolScopeCaveat(['get_profile']);
    const v = evaluateCaveats([c], { timestamp: 1000, mcpTool: 'delete_profile' }, ENFORCERS);
    expect(v[0]!.allowed).toBe(false);
  });

  it('denies when no tool name in context', () => {
    const c = buildMcpToolScopeCaveat(['get_profile']);
    const v = evaluateCaveats([c], { timestamp: 1000 }, ENFORCERS);
    expect(v[0]!.allowed).toBe(false);
    if (!v[0]!.allowed) expect(v[0]!.reason).toContain('no tool name');
  });
});

describe('evaluateCaveats — value + allowedTargets', () => {
  it('value: passes when ctx.value omitted (deferred to on-chain)', () => {
    const c = buildCaveat(ENFORCERS.value, encodeValueTerms(1_000_000n));
    const v = evaluateCaveats([c], { timestamp: 1 }, ENFORCERS);
    expect(v[0]!.allowed).toBe(true);
  });

  it('value: denies when ctx.value over cap', () => {
    const c = buildCaveat(ENFORCERS.value, encodeValueTerms(100n));
    const v = evaluateCaveats([c], { timestamp: 1, value: 200n }, ENFORCERS);
    expect(v[0]!.allowed).toBe(false);
  });

  it('allowedTargets: denies when target not in allowlist', () => {
    const c = buildCaveat(
      ENFORCERS.allowedTargets,
      encodeAllowedTargetsTerms(['0x1111111111111111111111111111111111111111']),
    );
    const v = evaluateCaveats(
      [c],
      { timestamp: 1, target: '0x2222222222222222222222222222222222222222' },
      ENFORCERS,
    );
    expect(v[0]!.allowed).toBe(false);
  });

  it('allowedTargets: address comparison is case-insensitive', () => {
    const c = buildCaveat(
      ENFORCERS.allowedTargets,
      encodeAllowedTargetsTerms(['0x1111111111111111111111111111111111111111']),
    );
    const v = evaluateCaveats(
      [c],
      { timestamp: 1, target: '0x1111111111111111111111111111111111111111' },
      ENFORCERS,
    );
    expect(v[0]!.allowed).toBe(true);
  });
});

describe('evaluateCaveats — multiple caveats', () => {
  it('returns one verdict per input caveat, in order', () => {
    const v = evaluateCaveats(
      [
        buildCaveat(ENFORCERS.timestamp, encodeTimestampTerms(1, 9999)),
        buildMcpToolScopeCaveat(['allowed_tool']),
      ],
      { timestamp: 1000, mcpTool: 'allowed_tool' },
      ENFORCERS,
    );
    expect(v).toHaveLength(2);
    expect(v[0]!.allowed).toBe(true);
    expect(v[1]!.allowed).toBe(true);
  });

  it('first deny remains visible even if later caveats allow', () => {
    const v = evaluateCaveats(
      [
        buildCaveat(ENFORCERS.timestamp, encodeTimestampTerms(1000, 2000)),
        buildMcpToolScopeCaveat(['get_profile']),
      ],
      { timestamp: 500, mcpTool: 'get_profile' }, // before validAfter
      ENFORCERS,
    );
    expect(v[0]!.allowed).toBe(false);
    expect(v[1]!.allowed).toBe(true);
  });
});
