// evaluatePolicy — pure decision engine, no I/O, no clocks.
// Deterministic; same context → same decision.
//
// Rules (per spec 204 §5):
//   1. classification['@sa-auth'] === 'none' AND caller != 'service' → deny
//   2. classification['@sa-tool'] === 'service-only' AND caller != 'service' → deny
//   3. classification['@sa-tool'] === 'delegation-verified' AND no delegation → deny
//   4. classification['@sa-risk-tier'] === 'critical' → requires-consent
//   5. else → allow

import type { PolicyContext, PolicyDecision } from './types';

export function evaluatePolicy(ctx: PolicyContext): PolicyDecision {
  const cls = ctx.classification;

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
