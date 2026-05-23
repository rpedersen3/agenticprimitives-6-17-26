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
import { buildEvent, type AuditSink, type MetricsSink } from '@agenticprimitives/audit';
import type { DataScopeGrant, McpResourceVerifyConfig } from './types';

/**
 * Resolve the effective environment for production-mode gates. Order
 * of precedence:
 *   1. Explicit `opts.environment` value.
 *   2. `developmentMode: true` → 'development'.
 *   3. `process.env.NODE_ENV` if readable.
 *   4. Default to 'production' — safe-by-default when the runtime is
 *      ambiguous (Cloudflare Workers, Deno, browser). Consumers who
 *      want a permissive wrapper MUST opt out explicitly.
 */
function inferEnvironment(opts?: {
  environment?: 'production' | 'development';
  developmentMode?: boolean;
}): 'production' | 'development' {
  if (opts?.environment) return opts.environment;
  if (opts?.developmentMode === true) return 'development';
  try {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV) {
      return process.env.NODE_ENV === 'production' ? 'production' : 'development';
    }
  } catch {
    /* SES / Workers may throw on process access */
  }
  return 'production';
}

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
    /**
     * Metrics sink (production-readiness wave 1). When provided, the
     * wrapper emits:
     *   - counter `mcp_runtime.with_delegation.calls` per call
     *     (tags: tool, audience, outcome ∈ accept|reject)
     *   - histogram `mcp_runtime.with_delegation.duration_ms` per call
     *     (tags: tool, audience, outcome)
     * Cardinality is bounded by the tool registry; safe for production
     * Prometheus / Datadog / OpenTelemetry pipelines.
     */
    metricsSink?: MetricsSink;
    /**
     * W3C traceparent header value (`00-{trace-id}-{parent-id}-{flags}`)
     * captured from the inbound request. Forwarded on outbound calls
     * the handler makes and stamped into emitted audit events so the
     * full session→token→tool chain stitches together end-to-end.
     */
    traceparent?: string;
    /**
     * Production-readiness gate (audit H1). Inverted default behaviour:
     * `withDelegation` runs in PRODUCTION mode unless the consumer
     * explicitly opts out via `developmentMode: true` (test/dev shim)
     * OR the runtime reports `NODE_ENV !== 'production'`. In
     * production, the wrapper throws at construction time if
     * `classification` or `auditSink` is missing. This makes the
     * package API impossible to misuse: you can't register a tool
     * wrapper without the metadata the policy engine + audit pipeline
     * need.
     *
     * Pass `environment: 'production'` to force production (the
     * canonical override; useful for tests that need to exercise prod
     * gates without setting NODE_ENV). Pass `environment: 'development'`
     * or `developmentMode: true` to opt out — required only for tests.
     */
    environment?: 'production' | 'development';
    /**
     * Explicit opt-out shorthand for non-production callers. Equivalent
     * to `environment: 'development'`. Useful so test code reads as
     * "this is intentionally a dev wrapper" rather than referencing
     * the environment axis directly.
     */
    developmentMode?: boolean;
  },
): (args: A & { token: string }) => Promise<unknown> {
  // Inferred environment — production-by-default per audit H1. The
  // construction-time gate now fires unless the consumer explicitly
  // opts into development.
  const env = inferEnvironment(opts);
  if (env === 'production') {
    if (!opts?.classification) {
      throw new Error(
        '[mcp-runtime] withDelegation requires `classification` in production. ' +
          'The policy engine (tool-policy.evaluatePolicy) MUST run; an unclassified tool ' +
          'is a security regression. Pass `opts.classification = declareTool(...)`. ' +
          'For tests, pass `developmentMode: true` to opt out of the strict gate.',
      );
    }
    if (!opts?.auditSink) {
      throw new Error(
        '[mcp-runtime] withDelegation requires `auditSink` in production. ' +
          'Audit emission is the only forensic trail for delegation accept/reject; ' +
          'production deployments MUST persist these. Pass a durable sink (D1, ' +
          'Cloud Logging, etc.) — wrap with composeSinks(durable, console) if you ' +
          'still want a tail-friendly mirror.',
      );
    }
  }
  return async (args) => {
    // Pull `quorumProof` off args (audit H3). It's a delegation-layer
    // concern, not handler input. Either the caller serializes proof
    // alongside the token, or there's no proof — and the verifier
    // rejects accordingly when `requireQuorumCaveat` is set.
    const { token, quorumProof, ...rest } =
      args as A & { token: string; quorumProof?: import('@agenticprimitives/delegation').VerifyOptsExt['quorumProof'] };
    const toolName = opts?.toolName ?? 'unknown';
    const correlationId = opts?.correlationId;
    const startedAt = Date.now();
    const metric = opts?.metricsSink;

    const emit = async (
      outcome: 'success' | 'denied' | 'error',
      reason: string | undefined,
      principal: Address | undefined,
    ) => {
      // Metrics fire in lockstep with audit emissions so a single
      // observability pipeline sees both the structured event AND the
      // counter/histogram. Cardinality is bounded by tool name +
      // audience + outcome — safe for production Prometheus.
      if (metric) {
        const tags = {
          tool: toolName,
          audience: config.audience ?? 'unknown',
          outcome: outcome === 'success' ? 'accept' : 'reject',
        };
        try { metric.increment('mcp_runtime.with_delegation.calls', 1, tags); } catch { /* fail-soft */ }
        try { metric.observe('mcp_runtime.with_delegation.duration_ms', Date.now() - startedAt, tags); } catch { /* fail-soft */ }
      }
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
            // Traceparent (W3C) stamped into context for downstream
            // trace correlation. Reject events still carry the trace.
            context: opts?.traceparent ? { traceparent: opts.traceparent } : undefined,
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
      // Audit H3 — when requireQuorumCaveat is set, delegation refuses
      // without an explicit proof. Forward the caller-supplied proof
      // through; if missing, the verifier rejects (a Wave H1 production
      // wrapper would have already thrown at construction if the tool
      // is unclassified).
      quorumProof,
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
