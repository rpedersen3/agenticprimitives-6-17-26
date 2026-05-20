// withDelegation — the headline wrapper.
//
// Pipeline (per spec 205 §2):
//   1. extract token from args
//   2. delegation.verifyDelegationToken(token, opts) — full chain check
//   3. tool-policy.evaluatePolicy(ctx) for classification gating
//      (audit H2; fail-closed on deny / requires-consent / unknown
//      classification)
//   4. invoke inner handler with verified { principal, grants? }
//
// Error responses must NOT leak the specific failure mode (malformed vs
// expired vs revoked vs caveat-failed vs policy-denied). Single
// "auth failed" error class.

import type { Address, Hex } from '@agenticprimitives/types';
import { verifyDelegationToken } from '@agenticprimitives/delegation';
import { evaluatePolicy } from '@agenticprimitives/tool-policy';
import type { ToolClassification } from '@agenticprimitives/tool-policy';
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
  opts?: {
    toolName?: string;
    /**
     * Tool classification metadata (audit H2). When provided, the
     * `evaluatePolicy()` decision engine runs after delegation verify;
     * `deny` and `requires-consent` both reject with McpAuthError. When
     * omitted, an internal warning is logged but the call proceeds
     * (back-compat for unclassified demo tools). Production code MUST
     * pass classification — the production preflight will eventually
     * enforce this.
     */
    classification?: ToolClassification;
  },
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
      requireDeployed: config.requireDeployed,
    });
    if ('error' in result) {
      // Internal log retains the reason; external surface stays opaque.
      console.error('[mcp-runtime] auth failed:', result.error);
      throw new McpAuthError(result.error);
    }

    // Policy enforcement (audit H2). Fail-closed on deny + requires-consent.
    // requires-consent is treated as deny here because this runtime does
    // not host a consent loop — consumers needing consent UX should
    // build their own wrapper that pauses, surfaces the prompt, and
    // re-enters the pipeline with the consent token.
    if (opts?.classification) {
      const decision = evaluatePolicy({
        toolName: opts.toolName ?? 'unknown',
        classification: opts.classification,
        // The delegation already proved the principal; callerKind is
        // therefore 'user-session' here (the user signed the delegation).
        // Future runtimes (a2a-runtime) can construct a different ctx.
        callerKind: 'user-session',
        delegation: {
          delegator: result.principal,
          // The delegate/caveats aren't surfaced from verify; for v0 we
          // pass an empty caveat list because evaluatePolicy's current
          // rules only need `classification` and `callerKind`.
          delegate: result.principal,
          caveats: [],
        },
      });
      if (decision.decision !== 'allow') {
        const detail =
          decision.decision === 'deny'
            ? `policy deny: ${decision.reason}`
            : `policy requires-consent (${decision.promptId}); runtime does not host consent loop`;
        console.error('[mcp-runtime] auth failed:', detail);
        throw new McpAuthError(detail);
      }
    } else {
      console.warn(
        '[mcp-runtime] withDelegation called without classification — ' +
          'consider passing opts.classification for policy enforcement (audit H2)',
      );
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
    requireDeployed: config.requireDeployed,
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
