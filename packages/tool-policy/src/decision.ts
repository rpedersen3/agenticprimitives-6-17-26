// evaluatePolicy — pure decision engine, no I/O, no clocks.
// Deterministic; same context → same decision. Fail-CLOSED on any
// unrecognised classification metadata (audit P0-1).
//
// Order of operations (fail-closed first):
//   0. Classification shape: every required tag present + value in
//      the closed enum set → reject otherwise.
//   1. classification['@sa-auth'] === 'none' AND caller != 'service' → deny
//   2. classification['@sa-tool'] === 'service-only' AND caller != 'service' → deny
//   3. classification['@sa-tool'] === 'bootstrap' AND caller != 'service' → deny
//   4. classification['@sa-tool'] === 'dev-only' → deny (env gate required)
//   5. classification['@sa-tool'] === 'delegation-verified' AND no delegation → deny
//   6. classification['@sa-risk-tier'] === 'critical' → requires-consent
//   7. else → allow

import type { PolicyContext, PolicyDecision, ToolClassification } from './types';

// Closed enum sets — keep in lockstep with `types.ts ToolClassification`.
// Any value outside these sets is treated as unknown → deny. This is
// the wire-format security boundary; loosening any of these requires
// a coordinated change to the type, the enum here, and (likely) the
// production preflight that audits classification coverage.
const KNOWN_TOOL_KINDS = new Set([
  'delegation-verified',
  'service-only',
  'bootstrap',
  'dev-only',
]);
const KNOWN_AUTH_KINDS = new Set([
  'session-token',
  'service-hmac',
  'none',
  'none-with-csrf',
]);
const KNOWN_RISK_TIERS = new Set(['low', 'medium', 'high', 'critical']);

/**
 * Validate the *shape* of a classification. Returns null when the
 * classification is well-formed, or a deny-reason string otherwise.
 *
 * Spec invariant: `@sa-tool` AND `@sa-auth` are REQUIRED; `@sa-risk-tier`
 * is required for everything except `service-only` / `bootstrap` /
 * `none-with-csrf` (which have no human risk dimension). Unknown values
 * in ANY of the three tags is unrecoverable — the package can't infer
 * an interpretation it doesn't know.
 */
function validateClassificationShape(cls: ToolClassification): string | null {
  const tool = cls['@sa-tool'];
  if (typeof tool !== 'string' || !KNOWN_TOOL_KINDS.has(tool)) {
    return `classification: @sa-tool="${tool}" not in known set ${[...KNOWN_TOOL_KINDS].join('|')}`;
  }
  const auth = cls['@sa-auth'];
  if (typeof auth !== 'string' || !KNOWN_AUTH_KINDS.has(auth)) {
    return `classification: @sa-auth="${auth}" not in known set ${[...KNOWN_AUTH_KINDS].join('|')}`;
  }
  // Risk tier is REQUIRED for user-facing tool kinds.
  const userFacing = tool === 'delegation-verified' || tool === 'dev-only';
  const tier = cls['@sa-risk-tier'];
  if (userFacing) {
    if (typeof tier !== 'string' || !KNOWN_RISK_TIERS.has(tier)) {
      return `classification: @sa-risk-tier="${tier}" required for tool=${tool} but not in known set ${[...KNOWN_RISK_TIERS].join('|')}`;
    }
  } else if (tier !== undefined && !KNOWN_RISK_TIERS.has(tier)) {
    // Set but with an unknown value → deny (no silent acceptance).
    return `classification: @sa-risk-tier="${tier}" not in known set ${[...KNOWN_RISK_TIERS].join('|')}`;
  }
  return null;
}

export function evaluatePolicy(ctx: PolicyContext): PolicyDecision {
  const cls = ctx.classification;

  // 0. SHAPE GATE (fail-closed default). Unknown/missing classification
  //    metadata is the most common cause of mis-configured tools
  //    silently being accepted. Reject here before any rule fires.
  const shapeErr = validateClassificationShape(cls);
  if (shapeErr) {
    return { decision: 'deny', reason: shapeErr };
  }

  if (cls['@sa-auth'] === 'none' && ctx.callerKind !== 'service') {
    return { decision: 'deny', reason: 'tool is @sa-auth:none; only service callers permitted' };
  }

  if (cls['@sa-tool'] === 'service-only' && ctx.callerKind !== 'service') {
    return { decision: 'deny', reason: 'tool is @sa-tool:service-only; user/agent calls rejected' };
  }

  if (cls['@sa-tool'] === 'bootstrap' && ctx.callerKind !== 'service') {
    return { decision: 'deny', reason: 'tool is @sa-tool:bootstrap; only service callers permitted' };
  }

  if (cls['@sa-tool'] === 'dev-only') {
    // Dev-only tools must be gated by environment; we don't read env here
    // (purity), so we deny unless explicitly classified differently by
    // the consumer's runtime. Consumers wanting "allow in dev" should
    // re-declare the tool as service-only with @sa-prod-gate:disabled.
    return { decision: 'deny', reason: 'tool is @sa-tool:dev-only; explicit env gate required' };
  }

  if (cls['@sa-tool'] === 'delegation-verified' && !ctx.delegation) {
    return { decision: 'deny', reason: 'tool requires delegation but none presented' };
  }

  if (cls['@sa-risk-tier'] === 'critical') {
    return {
      decision: 'requires-consent',
      promptId: `consent:critical:${ctx.toolName}`,
      risk: 'critical',
    };
  }

  return { decision: 'allow' };
}
