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

/**
 * H7-F.1 / PKG-MCP-RUNTIME-003 / EXT-026 / EXT-032 closure — split
 * public error surface from private failure context.
 *
 * Previously `McpAuthError.reason` carried the full denial cause
 * ("policy deny: high-risk tool requires quorum", "delegation
 * revoked at block N", "ERC-1271 returned 0x00…", etc.). A relying
 * app that forwarded `error.reason` to the client leaked denial
 * cause + occasionally PII (signer addresses, delegation hashes).
 *
 * The new surface:
 *   - {@link McpAuthError} is OPAQUE: carries only `code` (a small,
 *     bounded set) + an opaque `correlationId` the operator can use
 *     to look up the audit row.
 *   - {@link PrivateAuthFailureContext} is the rich shape emitted to
 *     the audit sink at the moment of failure. NEVER returned to the
 *     caller; consumed only by ops + forensics tooling.
 *
 * Migration note: tests that previously asserted on `error.reason`
 * should assert on `error.code` instead and (for the rich shape)
 * intercept the audit sink.
 */
export type McpAuthErrorCode =
  | 'auth-failed'        // generic credential / signature / revocation problem
  | 'auth-misconfigured' // server-side gap (missing quorum enforcer, store, etc.)
  | 'auth-paused';       // governance pause flag is set

export class McpAuthError extends Error {
  readonly code: McpAuthErrorCode;
  readonly correlationId: string;
  constructor(code: McpAuthErrorCode, correlationId: string) {
    super('mcp: auth failed');
    this.name = 'McpAuthError';
    this.code = code;
    this.correlationId = correlationId;
  }
}

/**
 * Rich failure context emitted to the audit sink. NEVER returned to
 * the caller.
 */
export interface PrivateAuthFailureContext {
  /** Same correlationId as the thrown {@link McpAuthError}. */
  correlationId: string;
  /** The opaque public code. */
  code: McpAuthErrorCode;
  /**
   * The ORIGINAL detailed denial reason (private). May contain
   * delegation hashes, on-chain addresses, classification tier labels,
   * etc. Routed to the audit sink (durable, op-only).
   */
  reason: string;
  /** Tool name if known. */
  toolName?: string;
  /** Step the failure happened at (`verify`, `policy`, `classification`, etc.). */
  stage?: string;
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
    // H7-F.1: every request gets a stable correlationId. Caller-supplied
    // wins; otherwise mint a random one so the thrown McpAuthError carries
    // a non-empty handle the operator can correlate with audit rows.
    const correlationId =
      opts?.correlationId ??
      `wd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
      // H7-F.1: private reason goes to audit; caller sees opaque code.
      await emit('denied', 'missing token', undefined);
      throw new McpAuthError('auth-failed', correlationId);
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
          // H7-F.1: server-side config gap surfaces as the distinct
          // 'auth-misconfigured' code so the caller can distinguish from
          // a legitimate credential reject.
          throw new McpAuthError('auth-misconfigured', correlationId);
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
      enforceOnChain: config.enforceOnChain === true,
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
      // H7-F.1: the private reason (which may carry delegation hashes
      // or signer addresses) is emitted to the audit sink and stays
      // server-side. The caller sees only the opaque code + correlationId
      // they can quote to the operator for forensics.
      console.error('[mcp-runtime] auth failed:', result.error);
      await emit('denied', result.error, undefined);
      throw new McpAuthError('auth-failed', correlationId);
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
          // H7-F.1: same opaque shape as other reject paths.
          throw new McpAuthError('auth-failed', correlationId);
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

/**
 * R5.8 / PKG-MCP-RUNTIME-004 — production-grade options for the
 * resource-level verify helper. Pre-R5.8 the helper accepted only
 * `{ toolName, timestamp }` and called `verifyDelegationToken` with
 * none of the policy / audit / threshold inputs, so a consumer could
 * silently skip the production policy layer that `withDelegation`
 * enforces (external audit P0-3). Now the opts surface mirrors
 * `withDelegation` exactly, and the same construction-time gate
 * fires when classification or auditSink is missing in production.
 *
 * Different from `withDelegation`:
 *   - this is the non-handler-wrapping variant (just verify, return
 *     the result). Used for MCP resource list/read paths that don't
 *     have a tool-call shape.
 *   - returns `{ principal, grants } | { error }` instead of throwing.
 *     A `'denied'` decision from the threshold-policy / classification
 *     gate is reported as `{ error }` so callers can map to their own
 *     MCP error response. Audit emission still happens; the public
 *     surface is the only thing that differs from `withDelegation`.
 */
export interface VerifyDelegationForResourceOpts {
  toolName?: string;
  /** Wall-clock at evaluation time (seconds). Optional; defaults to now. */
  timestamp?: number;
  /**
   * Same as `withDelegation` opts. See `withDelegation` for the full
   * semantic — in production both `classification` and `auditSink`
   * are required and the helper throws at construction time if they
   * are missing.
   */
  classification?: ToolClassification;
  auditSink?: AuditSink;
  correlationId?: string;
  metricsSink?: MetricsSink;
  traceparent?: string;
  environment?: 'production' | 'development';
  developmentMode?: boolean;
  /**
   * Audit H3 — when the threshold-policy decision derived from
   * `classification` requires a quorum caveat, callers must forward
   * the wallet-supplied quorum proof. Without it, the verifier
   * rejects.
   */
  quorumProof?: import('@agenticprimitives/delegation').VerifyOptsExt['quorumProof'];
}

export async function verifyDelegationForResource(
  token: string,
  config: McpResourceVerifyConfig,
  opts?: VerifyDelegationForResourceOpts,
): Promise<{ principal: Address; grants?: DataScopeGrant[] } | { error: string }> {
  // R5.8 / P0-3: identical production gate to `withDelegation`. A
  // consumer that uses this helper instead of the wrapper does not
  // get a policy-bypass discount.
  const env = inferEnvironment(opts);
  if (env === 'production') {
    if (!opts?.classification) {
      throw new Error(
        '[mcp-runtime] verifyDelegationForResource requires `classification` in production. ' +
          'The policy engine (tool-policy.evaluateThresholdPolicy) MUST run; an unclassified ' +
          'resource is a security regression. Pass `opts.classification = declareResource(...)`. ' +
          'For tests, pass `developmentMode: true` to opt out of the strict gate.',
      );
    }
    if (!opts?.auditSink) {
      throw new Error(
        '[mcp-runtime] verifyDelegationForResource requires `auditSink` in production. ' +
          'Audit emission is the only forensic trail for resource accept/reject; ' +
          'production deployments MUST persist these. Pass a durable sink (D1, ' +
          'Cloud Logging, etc.) — wrap with composeSinks(durable, console) if you ' +
          'still want a tail-friendly mirror.',
      );
    }
  }

  const toolName = opts?.toolName ?? 'unknown';
  const correlationId =
    opts?.correlationId ??
    `vr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const startedAt = Date.now();
  const metric = opts?.metricsSink;

  const emit = async (
    outcome: 'success' | 'denied',
    reason: string | undefined,
    principal: Address | undefined,
  ) => {
    if (metric) {
      const tags = {
        tool: toolName,
        audience: config.audience ?? 'unknown',
        outcome: outcome === 'success' ? 'accept' : 'reject',
      };
      try { metric.increment('mcp_runtime.verify_resource.calls', 1, tags); } catch { /* fail-soft */ }
      try { metric.observe('mcp_runtime.verify_resource.duration_ms', Date.now() - startedAt, tags); } catch { /* fail-soft */ }
    }
    if (!opts?.auditSink) return;
    try {
      await opts.auditSink.write(
        buildEvent({
          action:
            outcome === 'success'
              ? 'mcp-runtime.verify-resource.accept'
              : 'mcp-runtime.verify-resource.reject',
          outcome,
          correlationId,
          actor: principal ? { type: 'user', id: principal } : { type: 'unknown' },
          subject: { type: 'tool', id: toolName },
          audience: config.audience,
          chainId: config.chainId,
          reason,
          context: opts?.traceparent ? { traceparent: opts.traceparent } : undefined,
        }),
      );
    } catch {
      // Fail-soft: audit emission must never break the auth flow.
    }
  };

  // Threshold-policy decision → derive verifier gates (mirrors withDelegation).
  let requireQuorumCaveat: { enforcer: Address } | undefined;
  let requireAcceptedOnChain: boolean | undefined;
  if (opts?.classification) {
    const thrDecision = evaluateThresholdPolicy(opts.classification);
    if (thrDecision.requiresQuorum) {
      if (!config.quorumEnforcer) {
        const detail =
          'resource requires quorum caveat but mcp-runtime has no quorumEnforcer configured';
        console.error('[mcp-runtime] auth misconfigured:', detail);
        await emit('denied', detail, undefined);
        return { error: 'auth-misconfigured' };
      }
      requireQuorumCaveat = { enforcer: config.quorumEnforcer };
    }
    if (thrDecision.requiresAcceptedOnChain) {
      requireAcceptedOnChain = true;
    }
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
    auditSink: opts?.auditSink,
    correlationId,
    requireQuorumCaveat,
    requireAcceptedOnChain,
    quorumProof: opts?.quorumProof,
    now: opts?.timestamp ? () => opts.timestamp! * 1000 : undefined,
  });
  if ('error' in result) {
    await emit('denied', result.error, undefined);
    // Public surface: opaque error string per the H7-F.1 info-leak rule.
    // Audit sink already carries the private reason.
    return { error: 'auth-failed' };
  }

  // Classification policy enforcement (mirrors withDelegation).
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
        return { error: 'auth-failed' };
      }
    }
  }

  await emit('success', undefined, result.principal);
  return result;
}

// H7-B.8 (XPKG-002 / EXT-024 closure) — `withCrossDelegation` +
// `verifyCrossDelegationForResource` were public symbols that
// unconditionally rejected. Removed from the public surface; will land
// behind `./experimental` per spec 100 §6 when the cross-delegation work
// resumes. See PKG-mcp-runtime-001 in
// docs/audits/2026-05-packages-contracts-production-readiness.md.
