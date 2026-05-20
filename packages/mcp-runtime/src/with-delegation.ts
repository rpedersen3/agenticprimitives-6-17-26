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
import { evaluatePolicy, evaluateThresholdPolicy } from '@agenticprimitives/tool-policy';
import type { ToolClassification } from '@agenticprimitives/tool-policy';
import { buildEvent, type AuditSink } from '@agenticprimitives/audit';
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
    /**
     * Audit sink (audit C3). When provided, the wrapper emits
     * `mcp-runtime.with-delegation.{accept,reject}` events on every
     * call. Omit only for tests / paths that explicitly opt out of
     * forensics; production code MUST pass a sink and the preflight
     * will eventually enforce.
     */
    auditSink?: AuditSink;
    /** Correlation ID threaded into emitted events. */
    correlationId?: string;
  },
): (args: A & { token: string }) => Promise<unknown> {
  return async (args) => {
    const { token, ...rest } = args;
    const toolName = opts?.toolName ?? 'unknown';
    const correlationId = opts?.correlationId;

    const emit = async (
      outcome: 'success' | 'denied' | 'error',
      reason: string | undefined,
      principal: Address | undefined,
    ) => {
      if (!opts?.auditSink) return;
      try {
        await opts.auditSink.write(
          buildEvent({
            action:
              outcome === 'success'
                ? 'mcp-runtime.with-delegation.accept'
                : 'mcp-runtime.with-delegation.reject',
            outcome,
            correlationId,
            actor: principal ? { type: 'user', id: principal } : { type: 'unknown' },
            subject: { type: 'tool', id: toolName },
            audience: config.audience,
            chainId: config.chainId,
            reason,
          }),
        );
      } catch {
        // Fail-soft: audit emission must never break the auth flow.
        // composeSinks should be doing this for us, but belt-and-braces.
      }
    };

    if (typeof token !== 'string' || token.length === 0) {
      await emit('denied', 'missing token', undefined);
      throw new McpAuthError('missing token');
    }
    // Spec 207 threshold-policy: when a classification is provided,
    // derive the threshold-policy decision via tool-policy +
    // translate into delegation's verify opts. Pre-verify check so a
    // missing quorum caveat or absent on-chain blessing fails closed
    // before any chain reads.
    let requireQuorumCaveat: { enforcer: Address } | undefined;
    let requireAcceptedOnChain: boolean | undefined;
    if (opts?.classification) {
      const thrDecision = evaluateThresholdPolicy(opts.classification);
      if (thrDecision.requiresQuorum) {
        if (!config.quorumEnforcer) {
          // Fail closed at the boundary — a T3+ tool that needs
          // quorum can't be verified if the runtime doesn't know
          // where to find the QuorumEnforcer. Consumer apps must
          // wire `config.quorumEnforcer` from their deployments JSON.
          const detail =
            'tool requires quorum caveat but mcp-runtime has no quorumEnforcer configured';
          console.error('[mcp-runtime] auth misconfigured:', detail);
          await emit('denied', detail, undefined);
          throw new McpAuthError(detail);
        }
        requireQuorumCaveat = { enforcer: config.quorumEnforcer };
      }
      if (thrDecision.requiresAcceptedOnChain) {
        requireAcceptedOnChain = true;
      }
      // `requiresUv` from the threshold-policy decision is verified
      // at the SIGNER layer (the wallet sets the WebAuthn UV flag when
      // producing the delegation signature). delegation's verify path
      // doesn't re-check UV because it would need to parse the
      // passkey signature blob; that's the consumer app's
      // responsibility at signing time.
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
      // Thread the audit sink + correlation id down so delegation
      // emits `delegation.verify.{accept,reject}` events through the
      // same sink as `mcp-runtime.with-delegation.*`. Pass 3b.
      auditSink: opts?.auditSink,
      correlationId,
      // Spec 207 threshold-policy gates (6c.4). Both undefined for T1
      // tools; either or both set for T2+ depending on the tool's
      // `@sa-risk-tier` classification.
      requireQuorumCaveat,
      requireAcceptedOnChain,
    });
    if ('error' in result) {
      // Internal log retains the reason; external surface stays opaque.
      console.error('[mcp-runtime] auth failed:', result.error);
      await emit('denied', result.error, undefined);
      throw new McpAuthError(result.error);
    }

    // Policy enforcement (audit H2). Fail-closed on deny + requires-consent.
    if (opts?.classification) {
      const decision = evaluatePolicy({
        toolName,
        classification: opts.classification,
        callerKind: 'user-session',
        delegation: {
          delegator: result.principal,
          delegate: result.principal,
          caveats: [],
        },
      });
      if (decision.decision !== 'allow') {
        // Spec 207 reconciliation: critical-risk tools have historically
        // returned `requires-consent` from evaluatePolicy + the wrapper
        // failed closed because the runtime doesn't host a consent loop
        // (audit H2). The threshold-policy `requiresAcceptedOnChain`
        // gate IS the consent loop for that path — the user committed
        // an `acceptSessionDelegation(hash)` transaction in advance.
        // When that gate is in force AND it passed (verify didn't
        // reject), the requires-consent outcome is satisfied.
        const thrDec = evaluateThresholdPolicy(opts.classification);
        const satisfiedByOnChainBlessing =
          decision.decision === 'requires-consent' && thrDec.requiresAcceptedOnChain;
        if (!satisfiedByOnChainBlessing) {
          const detail =
            decision.decision === 'deny'
              ? `policy deny: ${decision.reason}`
              : `policy requires-consent (${decision.promptId}); runtime does not host consent loop`;
          console.error('[mcp-runtime] auth failed:', detail);
          await emit('denied', detail, result.principal);
          throw new McpAuthError(detail);
        }
      }
    } else {
      console.warn(
        '[mcp-runtime] withDelegation called without classification — ' +
          'consider passing opts.classification for policy enforcement (audit H2)',
      );
    }

    await emit('success', undefined, result.principal);
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
