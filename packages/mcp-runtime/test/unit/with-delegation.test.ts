import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withDelegation, McpAuthError } from '../../src/with-delegation';
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
