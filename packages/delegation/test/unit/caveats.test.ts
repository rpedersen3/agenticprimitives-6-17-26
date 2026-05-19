import { describe, it, expect } from 'vitest';
import { decodeAbiParameters } from 'viem';
import {
  buildCaveat,
  buildMcpToolScopeCaveat,
  buildDataScopeCaveat,
  buildDelegateBindingCaveat,
  encodeTimestampTerms,
  encodeValueTerms,
  encodeAllowedTargetsTerms,
  encodeAllowedMethodsTerms,
  MCP_TOOL_SCOPE_ENFORCER,
  DATA_SCOPE_ENFORCER,
  DELEGATE_BINDING_ENFORCER,
} from '../../src/caveats';

describe('on-chain enforcer term encoders', () => {
  it('encodeTimestampTerms round-trips through ABI decode', () => {
    const enc = encodeTimestampTerms(100, 200);
    const [validAfter, validUntil] = decodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }],
      enc,
    ) as readonly [bigint, bigint];
    expect(validAfter).toBe(100n);
    expect(validUntil).toBe(200n);
  });

  it('encodeTimestampTerms rejects invalid ranges', () => {
    expect(() => encodeTimestampTerms(100, 100)).toThrow(/validUntil/);
    expect(() => encodeTimestampTerms(100, 50)).toThrow(/validUntil/);
    expect(() => encodeTimestampTerms(-1, 100)).toThrow(/non-negative/);
  });

  it('encodeValueTerms round-trips and rejects negatives', () => {
    const enc = encodeValueTerms(1_000_000n);
    const [v] = decodeAbiParameters([{ type: 'uint256' }], enc) as readonly [bigint];
    expect(v).toBe(1_000_000n);
    expect(() => encodeValueTerms(-1n)).toThrow(/non-negative/);
  });

  it('encodeAllowedTargetsTerms round-trips', () => {
    const targets: `0x${string}`[] = [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ];
    const enc = encodeAllowedTargetsTerms(targets);
    const [decoded] = decodeAbiParameters([{ type: 'address[]' }], enc) as readonly [`0x${string}`[]];
    expect(decoded.map((s) => s.toLowerCase())).toEqual(targets.map((s) => s.toLowerCase()));
  });

  it('encodeAllowedTargetsTerms rejects empty array', () => {
    expect(() => encodeAllowedTargetsTerms([])).toThrow(/at least one/);
  });

  it('encodeAllowedMethodsTerms validates 4-byte selectors', () => {
    expect(() => encodeAllowedMethodsTerms(['0xabcd' as `0x${string}`])).toThrow(/4 bytes/);
    const enc = encodeAllowedMethodsTerms(['0xa9059cbb' as `0x${string}`]);
    const [decoded] = decodeAbiParameters([{ type: 'bytes4[]' }], enc) as readonly [`0x${string}`[]];
    expect(decoded[0]).toBe('0xa9059cbb');
  });

  it('buildCaveat defaults args to "0x"', () => {
    const c = buildCaveat('0x1234567890123456789012345678901234567890', '0xdeadbeef');
    expect(c.args).toBe('0x');
  });
});

describe('off-chain sentinel enforcers', () => {
  it('MCP_TOOL_SCOPE_ENFORCER is the keccak256-derived sentinel address', () => {
    expect(MCP_TOOL_SCOPE_ENFORCER).toMatch(/^0x[0-9a-f]{40}$/);
    expect(MCP_TOOL_SCOPE_ENFORCER).not.toBe(DATA_SCOPE_ENFORCER);
    expect(MCP_TOOL_SCOPE_ENFORCER).not.toBe(DELEGATE_BINDING_ENFORCER);
  });

  it('three sentinels are distinct', () => {
    const addrs = new Set([MCP_TOOL_SCOPE_ENFORCER, DATA_SCOPE_ENFORCER, DELEGATE_BINDING_ENFORCER]);
    expect(addrs.size).toBe(3);
  });

  it('buildMcpToolScopeCaveat encodes string[] correctly', () => {
    const c = buildMcpToolScopeCaveat(['get_profile', 'update_profile']);
    expect(c.enforcer).toBe(MCP_TOOL_SCOPE_ENFORCER);
    const [tools] = decodeAbiParameters([{ type: 'string[]' }], c.terms) as readonly [string[]];
    expect(tools).toEqual(['get_profile', 'update_profile']);
  });

  it('buildMcpToolScopeCaveat rejects empty list', () => {
    expect(() => buildMcpToolScopeCaveat([])).toThrow(/at least one/);
  });

  it('buildDataScopeCaveat encodes nested grants', () => {
    const c = buildDataScopeCaveat([
      { server: 'urn:mcp:server:person', resources: ['profile'], fields: ['email'] },
    ]);
    expect(c.enforcer).toBe(DATA_SCOPE_ENFORCER);
    expect(c.terms).toMatch(/^0x[0-9a-f]+$/);
  });

  it('buildDelegateBindingCaveat encodes two addresses', () => {
    const c = buildDelegateBindingCaveat(
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    );
    expect(c.enforcer).toBe(DELEGATE_BINDING_ENFORCER);
    const [a, b] = decodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }],
      c.terms,
    ) as readonly [`0x${string}`, `0x${string}`];
    expect(a.toLowerCase()).toBe('0x1111111111111111111111111111111111111111');
    expect(b.toLowerCase()).toBe('0x2222222222222222222222222222222222222222');
  });
});
