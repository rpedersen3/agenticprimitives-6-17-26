import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withDelegation, verifyDelegationForResource, McpAuthError } from '../../src/with-delegation';
import { createMemoryJtiStore } from '../../src/jti-stores';
import type { McpResourceVerifyConfig } from '../../src/types';

// Mock the delegation package's verifyDelegationToken so unit tests don't
// require a running chain.
vi.mock('@agenticprimitives/delegation', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@agenticprimitives/delegation')>();
  return {
    ...orig,
    verifyDelegationToken: vi.fn(),
  };
});

import { verifyDelegationToken } from '@agenticprimitives/delegation';

const config: McpResourceVerifyConfig = {
  audience: 'urn:mcp:server:person',
  chainId: 31337,
  rpcUrl: 'http://127.0.0.1:8545',
  delegationManager: '0x0000000000000000000000000000000000000001',
  enforcerMap: {
    delegationManager: '0x0000000000000000000000000000000000000001',
    timestamp: '0x0000000000000000000000000000000000000002',
    value: '0x0000000000000000000000000000000000000003',
    allowedTargets: '0x0000000000000000000000000000000000000004',
    allowedMethods: '0x0000000000000000000000000000000000000005',
  },
  jtiStore: createMemoryJtiStore(),
};

describe('withDelegation', () => {
  beforeEach(() => {
    (verifyDelegationToken as ReturnType<typeof vi.fn>).mockClear();
  });

  it('calls inner handler with principal when verify succeeds', async () => {
    (verifyDelegationToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      principal: '0xabcdef0123456789abcdef0123456789abcdef01',
    });
    const inner = vi.fn(async (args: { principal: string; extra: string }) => `hello ${args.principal}`);
    const wrapped = withDelegation(config, inner);
    const result = await wrapped({ token: 'fake-token', extra: 'bonus' });
    expect(result).toBe('hello 0xabcdef0123456789abcdef0123456789abcdef01');
    expect(inner).toHaveBeenCalledWith({
      principal: '0xabcdef0123456789abcdef0123456789abcdef01',
      extra: 'bonus',
    });
  });

  it('throws McpAuthError when verify fails (opaque to caller)', async () => {
    (verifyDelegationToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      error: 'token expired',
    });
    const inner = vi.fn();
    const wrapped = withDelegation(config, inner);
    await expect(wrapped({ token: 'fake' })).rejects.toBeInstanceOf(McpAuthError);
    expect(inner).not.toHaveBeenCalled();
  });

  it('throws McpAuthError when token is missing', async () => {
    const wrapped = withDelegation(config, vi.fn());
    await expect(wrapped({ token: '' })).rejects.toBeInstanceOf(McpAuthError);
  });

  it('H7-F.1 — McpAuthError carries opaque code + correlationId only (no leakage)', async () => {
    (verifyDelegationToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      error: 'token expired at slot 0xdeadbeef…',
    });
    const wrapped = withDelegation(config, vi.fn());
    try {
      await wrapped({ token: 'fake' });
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(McpAuthError);
      const err = e as McpAuthError;
      expect(err.code).toBe('auth-failed');
      expect(err.correlationId).toMatch(/^wd-/);
      // The private reason ("token expired at slot 0xdeadbeef…") must NOT
      // be reachable from the caller's error surface.
      const surfaceKeys = Object.keys(err);
      expect(surfaceKeys).not.toContain('reason');
      const msg = JSON.stringify(err.message);
      expect(msg).not.toMatch(/0xdeadbeef/i);
    }
  });

  it('H7-F.1 — missing token also uses opaque code + correlationId', async () => {
    const wrapped = withDelegation(config, vi.fn());
    try {
      await wrapped({ token: '' });
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(McpAuthError);
      const err = e as McpAuthError;
      expect(err.code).toBe('auth-failed');
      expect(err.correlationId).toBeTruthy();
    }
  });

  it('H7-F.1 — caller-supplied correlationId is propagated', async () => {
    (verifyDelegationToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      error: 'expired',
    });
    const wrapped = withDelegation(config, vi.fn(), { correlationId: 'caller-req-42' });
    try {
      await wrapped({ token: 'fake' });
    } catch (e) {
      const err = e as McpAuthError;
      expect(err.correlationId).toBe('caller-req-42');
    }
  });

  it('passes toolName through to verifyDelegationToken when configured', async () => {
    const mock = verifyDelegationToken as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce({ principal: '0xabc' });
    const wrapped = withDelegation(config, vi.fn(async () => 'ok'), { toolName: 'get_profile' });
    await wrapped({ token: 'fake' });
    expect(mock).toHaveBeenCalledOnce();
    expect(mock.mock.calls[0]![1]).toMatchObject({ toolName: 'get_profile' });
  });

  // ─── Spec 207 threshold-policy wiring (6c.4) ──────────────────────

  it('low-risk classification: no quorum / no on-chain blessing required', async () => {
    const mock = verifyDelegationToken as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce({ principal: '0xabc' });
    const wrapped = withDelegation(config, vi.fn(async () => 'ok'), {
      toolName: 'get_profile',
      classification: {
        '@sa-tool': 'delegation-verified',
        '@sa-auth': 'session-token',
        '@sa-risk-tier': 'low',
      },
    });
    await wrapped({ token: 'fake' });
    expect(mock).toHaveBeenCalledOnce();
    const verifyOpts = mock.mock.calls[0]![1];
    expect(verifyOpts.requireQuorumCaveat).toBeUndefined();
    expect(verifyOpts.requireAcceptedOnChain).toBeUndefined();
  });

  it('high-risk classification: threads requireQuorumCaveat into verify opts', async () => {
    const quorumEnforcer = '0x9999999999999999999999999999999999999999' as const;
    const cfg = { ...config, quorumEnforcer };
    const mock = verifyDelegationToken as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce({ principal: '0xabc' });
    const wrapped = withDelegation(cfg, vi.fn(async () => 'ok'), {
      classification: {
        '@sa-tool': 'delegation-verified',
        '@sa-auth': 'session-token',
        '@sa-risk-tier': 'high',
      },
    });
    await wrapped({ token: 'fake' });
    const verifyOpts = mock.mock.calls[0]![1];
    expect(verifyOpts.requireQuorumCaveat).toEqual({ enforcer: quorumEnforcer });
    expect(verifyOpts.requireAcceptedOnChain).toBeUndefined();
  });

  it('critical-risk classification: threads BOTH requireQuorumCaveat AND requireAcceptedOnChain', async () => {
    const quorumEnforcer = '0x9999999999999999999999999999999999999999' as const;
    const cfg = { ...config, quorumEnforcer };
    const mock = verifyDelegationToken as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce({ principal: '0xabc' });
    const wrapped = withDelegation(cfg, vi.fn(async () => 'ok'), {
      classification: {
        '@sa-tool': 'delegation-verified',
        '@sa-auth': 'session-token',
        '@sa-risk-tier': 'critical',
      },
    });
    await wrapped({ token: 'fake' });
    const verifyOpts = mock.mock.calls[0]![1];
    expect(verifyOpts.requireQuorumCaveat).toEqual({ enforcer: quorumEnforcer });
    expect(verifyOpts.requireAcceptedOnChain).toBe(true);
  });

  it('high-risk + no quorumEnforcer configured: fails closed before chain call', async () => {
    // Critical safety property: if a tool needs quorum but the runtime
    // doesn't know where the enforcer lives, refuse — don't degrade to
    // "no quorum check."
    const wrapped = withDelegation(config /* no quorumEnforcer */, vi.fn(async () => 'ok'), {
      classification: {
        '@sa-tool': 'delegation-verified',
        '@sa-auth': 'session-token',
        '@sa-risk-tier': 'high',
      },
    });
    await expect(wrapped({ token: 'fake' })).rejects.toBeInstanceOf(McpAuthError);
    // verify should not even have been called.
    expect(verifyDelegationToken).not.toHaveBeenCalled();
  });
});

// ─── Wave H1 — production-default gate ─────────────────────────────────

describe('withDelegation production-default gate (audit H1)', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('throws at construction time when production-mode and classification missing', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      withDelegation(config, vi.fn(async () => 'ok'), {
        toolName: 'unclassified',
        // no classification, no auditSink → must throw
      }),
    ).toThrow(/requires `classification` in production/);
  });

  it('throws at construction time when production-mode and auditSink missing', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      withDelegation(config, vi.fn(async () => 'ok'), {
        toolName: 'classified-no-sink',
        classification: {
          '@sa-tool': 'delegation-verified',
          '@sa-auth': 'session-token',
          '@sa-risk-tier': 'low',
        },
        // no auditSink → must throw
      }),
    ).toThrow(/requires `auditSink` in production/);
  });

  it('does NOT throw in production-mode when both classification + auditSink are supplied', () => {
    process.env.NODE_ENV = 'production';
    const auditSink = { write: vi.fn(async () => {}) };
    expect(() =>
      withDelegation(config, vi.fn(async () => 'ok'), {
        toolName: 'classified-with-sink',
        classification: {
          '@sa-tool': 'delegation-verified',
          '@sa-auth': 'session-token',
          '@sa-risk-tier': 'low',
        },
        auditSink,
      }),
    ).not.toThrow();
  });

  it('developmentMode: true escapes the production gate', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      withDelegation(config, vi.fn(async () => 'ok'), {
        toolName: 'dev-escape',
        developmentMode: true,
        // no classification, no auditSink — but developmentMode opts out
      }),
    ).not.toThrow();
  });

  it('environment: "development" escapes the production gate', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      withDelegation(config, vi.fn(async () => 'ok'), {
        toolName: 'env-escape',
        environment: 'development',
      }),
    ).not.toThrow();
  });

  it('environment: "production" forces strict gate even when NODE_ENV is unset', () => {
    delete process.env.NODE_ENV;
    expect(() =>
      withDelegation(config, vi.fn(async () => 'ok'), {
        toolName: 'forced-prod',
        environment: 'production',
      }),
    ).toThrow(/requires `classification` in production/);
  });

  it('NODE_ENV=test inherits development mode (no throw on missing metadata)', () => {
    process.env.NODE_ENV = 'test';
    expect(() =>
      withDelegation(config, vi.fn(async () => 'ok'), { toolName: 'test-mode' }),
    ).not.toThrow();
  });
});

// ─── Wave H3 — quorumProof threading ─────────────────────────────────

describe('withDelegation quorumProof passthrough (audit H3)', () => {
  beforeEach(() => {
    (verifyDelegationToken as ReturnType<typeof vi.fn>).mockClear();
  });

  it('does NOT pass quorumProof when caller omits it', async () => {
    const mock = verifyDelegationToken as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce({ principal: '0xabc' });
    const quorumEnforcer = '0x9999999999999999999999999999999999999999' as const;
    const cfg = { ...config, quorumEnforcer };
    const wrapped = withDelegation(cfg, vi.fn(async () => 'ok'), {
      classification: {
        '@sa-tool': 'delegation-verified',
        '@sa-auth': 'session-token',
        '@sa-risk-tier': 'high',
      },
    });
    await wrapped({ token: 'fake' });
    const verifyOpts = mock.mock.calls[0]![1];
    expect(verifyOpts.requireQuorumCaveat).toEqual({ enforcer: quorumEnforcer });
    expect(verifyOpts.quorumProof).toBeUndefined();
  });

  it('threads quorumProof from caller args into delegation verifier', async () => {
    const mock = verifyDelegationToken as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce({ principal: '0xabc' });
    const quorumEnforcer = '0x9999999999999999999999999999999999999999' as const;
    const cfg = { ...config, quorumEnforcer };
    const wrapped = withDelegation(cfg, vi.fn(async () => 'ok'), {
      classification: {
        '@sa-tool': 'delegation-verified',
        '@sa-auth': 'session-token',
        '@sa-risk-tier': 'high',
      },
    });
    await wrapped({ token: 'fake', quorumProof: { mode: 'on-chain-redeemed' } } as never);
    const verifyOpts = mock.mock.calls[0]![1];
    expect(verifyOpts.quorumProof).toEqual({ mode: 'on-chain-redeemed' });
  });

  it('quorumProof is stripped from args before reaching the handler', async () => {
    const mock = verifyDelegationToken as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce({ principal: '0xabc' });
    const inner = vi.fn(async (args: Record<string, unknown>) => args);
    const wrapped = withDelegation(config, inner, {
      classification: {
        '@sa-tool': 'delegation-verified',
        '@sa-auth': 'session-token',
        '@sa-risk-tier': 'low',
      },
    });
    await wrapped({ token: 'fake', extra: 'kept', quorumProof: { mode: 'on-chain-redeemed' } } as never);
    const innerArgs = inner.mock.calls[0]![0];
    expect(innerArgs).toMatchObject({ principal: '0xabc', extra: 'kept' });
    expect((innerArgs as Record<string, unknown>).quorumProof).toBeUndefined();
  });
});

// ─── R5.8 / PKG-MCP-RUNTIME-004 — verifyDelegationForResource production gate ─

describe('verifyDelegationForResource production gate (R5.8 / P0-3)', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    (verifyDelegationToken as ReturnType<typeof vi.fn>).mockClear();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('throws when production-mode and classification missing', async () => {
    process.env.NODE_ENV = 'production';
    await expect(
      verifyDelegationForResource('fake-token', config, {
        toolName: 'unclassified',
        // no classification, no auditSink → must throw
      }),
    ).rejects.toThrow(/requires `classification` in production/);
  });

  it('throws when production-mode and auditSink missing', async () => {
    process.env.NODE_ENV = 'production';
    await expect(
      verifyDelegationForResource('fake-token', config, {
        toolName: 'classified-no-sink',
        classification: {
          '@sa-tool': 'delegation-verified',
          '@sa-auth': 'session-token',
          '@sa-risk-tier': 'low',
        },
        // no auditSink → must throw
      }),
    ).rejects.toThrow(/requires `auditSink` in production/);
  });

  it('does NOT throw in production-mode when both classification + auditSink are supplied', async () => {
    process.env.NODE_ENV = 'production';
    (verifyDelegationToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      principal: '0xabc',
    });
    const auditSink = { write: vi.fn(async () => {}) };
    const result = await verifyDelegationForResource('fake-token', config, {
      toolName: 'classified-with-sink',
      classification: {
        '@sa-tool': 'delegation-verified',
        '@sa-auth': 'session-token',
        '@sa-risk-tier': 'low',
      },
      auditSink,
    });
    expect(result).toEqual({ principal: '0xabc' });
    expect(auditSink.write).toHaveBeenCalledTimes(1);
  });

  it('developmentMode: true escapes the production gate', async () => {
    process.env.NODE_ENV = 'production';
    (verifyDelegationToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      principal: '0xabc',
    });
    const result = await verifyDelegationForResource('fake-token', config, {
      toolName: 'dev-escape',
      developmentMode: true,
    });
    expect(result).toEqual({ principal: '0xabc' });
  });

  it('environment: "production" forces strict gate even when NODE_ENV is unset', async () => {
    delete process.env.NODE_ENV;
    await expect(
      verifyDelegationForResource('fake-token', config, {
        toolName: 'forced-prod',
        environment: 'production',
      }),
    ).rejects.toThrow(/requires `classification` in production/);
  });

  it('threads requireQuorumCaveat into verify opts when high-risk classification', async () => {
    process.env.NODE_ENV = 'development';
    const mock = verifyDelegationToken as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce({ principal: '0xabc' });
    const quorumEnforcer = '0x9999999999999999999999999999999999999999' as const;
    const cfg = { ...config, quorumEnforcer };
    await verifyDelegationForResource('fake-token', cfg, {
      classification: {
        '@sa-tool': 'delegation-verified',
        '@sa-auth': 'session-token',
        '@sa-risk-tier': 'high',
      },
    });
    const verifyOpts = mock.mock.calls[0]![1];
    expect(verifyOpts.requireQuorumCaveat).toEqual({ enforcer: quorumEnforcer });
  });

  it('high-risk + no quorumEnforcer configured: fails closed before chain call', async () => {
    process.env.NODE_ENV = 'development';
    const result = await verifyDelegationForResource('fake-token', config, {
      classification: {
        '@sa-tool': 'delegation-verified',
        '@sa-auth': 'session-token',
        '@sa-risk-tier': 'high',
      },
    });
    // verifyDelegationToken must NOT have been called
    expect((verifyDelegationToken as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect(result).toEqual({ error: 'auth-misconfigured' });
  });

  it('emits accept audit event on success when auditSink is configured', async () => {
    process.env.NODE_ENV = 'development';
    (verifyDelegationToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      principal: '0xabc',
    });
    const auditSink = { write: vi.fn(async () => {}) };
    await verifyDelegationForResource('fake-token', config, {
      toolName: 'resource-x',
      auditSink,
    });
    expect(auditSink.write).toHaveBeenCalledTimes(1);
    const event = auditSink.write.mock.calls[0]![0];
    expect(event.action).toBe('mcp-runtime.verify-resource.accept');
    expect(event.outcome).toBe('success');
  });

  it('emits reject audit event when verify fails + returns opaque auth-failed', async () => {
    process.env.NODE_ENV = 'development';
    (verifyDelegationToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      error: 'token expired at slot 0xdead',
    });
    const auditSink = { write: vi.fn(async () => {}) };
    const result = await verifyDelegationForResource('fake-token', config, {
      toolName: 'resource-x',
      auditSink,
    });
    expect(result).toEqual({ error: 'auth-failed' });
    // Public surface MUST NOT leak the private reason
    expect(JSON.stringify(result)).not.toContain('token expired');
    // Audit row DOES carry the private reason for forensics
    const event = auditSink.write.mock.calls[0]![0];
    expect(event.action).toBe('mcp-runtime.verify-resource.reject');
    expect(event.reason).toBe('token expired at slot 0xdead');
  });
});
