// withDelegation — the headline wrapper.
//
// Pipeline (per spec 205 §2):
//   1. extract token from args
//   2. delegation.verifyDelegationToken(token, opts) — full chain check
//   3. (future) tool-policy.evaluatePolicy(ctx) for classification gating
//   4. invoke inner handler with verified { principal, grants? }
//
// Error responses must NOT leak the specific failure mode (malformed vs
// expired vs revoked vs caveat-failed). Single "auth failed" error class.

import type { Address, Hex } from '@agenticprimitives/types';
import { verifyDelegationToken } from '@agenticprimitives/delegation';
import type { DataScopeGrant, McpResourceVerifyConfig } from './types';

export class McpAuthError extends Error {
  constructor(public readonly reason: string) {
    super('mcp: auth failed');
    this.name = 'McpAuthError';
  }
}

export function withDelegation<A extends Record<string, unknown>>(
  config: McpResourceVerifyConfig,
  handler: (args: A & { principal: Address; grants?: DataScopeGrant[] }) => Promise<unknown>,
  opts?: { toolName?: string },
): (args: A & { token: string }) => Promise<unknown> {
  return async (args) => {
    const { token, ...rest } = args;
    if (typeof token !== 'string' || token.length === 0) {
      throw new McpAuthError('missing token');
    }
    const result = await verifyDelegationToken(token, {
      audience: config.audience,
      chainId: config.chainId,
      rpcUrl: config.rpcUrl,
      delegationManager: config.delegationManager,
      enforcerMap: config.enforcerMap,
      jtiStore: config.jtiStore,
      toolName: opts?.toolName,
    });
    if ('error' in result) {
      // Internal log retains the reason; external surface stays opaque.
      console.error('[mcp-runtime] auth failed:', result.error);
      throw new McpAuthError(result.error);
    }
    return handler({ ...(rest as unknown as A), principal: result.principal, grants: result.grants });
  };
}

export interface VerifyDelegationForResourceOpts {
  toolName?: string;
}

export async function verifyDelegationForResource(
  token: string,
  config: McpResourceVerifyConfig,
  ctx?: { toolName?: string; timestamp?: number },
): Promise<{ principal: Address; grants?: DataScopeGrant[] } | { error: string }> {
  return verifyDelegationToken(token, {
    audience: config.audience,
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    delegationManager: config.delegationManager,
    enforcerMap: config.enforcerMap,
    jtiStore: config.jtiStore,
    toolName: ctx?.toolName,
    now: ctx?.timestamp ? () => ctx.timestamp! * 1000 : undefined,
  });
}

export function withCrossDelegation<A extends Record<string, unknown>>(
  _config: McpResourceVerifyConfig,
  _handler: (args: A & {
    callerPrincipal: Address;
    dataPrincipal: Address;
    grants: DataScopeGrant[];
  }) => Promise<unknown>,
): (args: A & { token: string; crossDelegationHash: Hex }) => Promise<unknown> {
  return async () => {
    throw new McpAuthError(
      'withCrossDelegation not implemented in v0 (cross-delegation verify lands in v0.1)',
    );
  };
}

export async function verifyCrossDelegationForResource(): Promise<{ error: string }> {
  return { error: 'verifyCrossDelegationForResource not implemented in v0' };
}
