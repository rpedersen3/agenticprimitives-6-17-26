// Entitlement matching engine (spec 277 §10). Pure, deterministic, fail-closed:
// a query is allowed only if SOME credential matches it on every dimension
// (audience, resource, principal, action, fields, purpose, classification
// ceiling, validity window). Credential authenticity (VC proof) + revocation
// (status list) are a separate, later layer — `matchesEntitlement` assumes the
// credentials handed to it are already trusted/unrevoked.

import {
  type AgenticEntitlementCredentialV1,
  type EntitlementQuery,
  type EntitlementDecision,
  type EntitlementReason,
  type EntitlementClassification,
  CLASSIFICATION_ORDER,
} from './types.js';

function eq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function classificationRank(c: EntitlementClassification): number {
  return CLASSIFICATION_ORDER.indexOf(c);
}

/** Result of matching a SINGLE credential against a query. `allowedFields` is the
 *  requested∩granted intersection (or the requested set when the credential grants
 *  all fields). On no-match, `reason` is the most specific failure. */
export interface SingleMatch {
  ok: boolean;
  reason: EntitlementReason;
  allowedFields?: string[];
}

export function matchesEntitlement(cred: AgenticEntitlementCredentialV1, q: EntitlementQuery): SingleMatch {
  const s = cred.credentialSubject;

  // Validity window.
  const at = q.at.getTime();
  if (at < new Date(cred.validFrom).getTime()) return { ok: false, reason: 'expired' };
  if (cred.validUntil && at > new Date(cred.validUntil).getTime()) return { ok: false, reason: 'expired' };

  // Holder + scope.
  if (!eq(s.id, q.actor)) return { ok: false, reason: 'not_found' };
  if (!eq(s.audience, q.audience)) return { ok: false, reason: 'audience_mismatch' };
  if (!eq(s.resource, q.resource)) return { ok: false, reason: 'resource_mismatch' };
  if (s.principal !== undefined && q.principal !== undefined && !eq(s.principal, q.principal)) {
    return { ok: false, reason: 'principal_mismatch' };
  }
  if (!s.actions.some((a) => eq(a, q.action))) return { ok: false, reason: 'action_not_allowed' };

  // Purpose: if the credential pins a purpose, the query must match it.
  if (s.purpose !== undefined && (q.purpose === undefined || !eq(s.purpose, q.purpose))) {
    return { ok: false, reason: 'purpose_not_allowed' };
  }

  // Classification ceiling: the data's classification must not exceed the grant's ceiling.
  if (s.classificationCeiling !== undefined && q.classification !== undefined) {
    if (classificationRank(q.classification) > classificationRank(s.classificationCeiling)) {
      return { ok: false, reason: 'classification_exceeded' };
    }
  }

  // Fields: a credential without `fields` grants ALL; otherwise the requested
  // fields must be a subset. allowedFields = requested∩granted (or requested when all).
  if (s.fields === undefined) {
    return { ok: true, reason: 'matched', allowedFields: q.fields };
  }
  const granted = new Set(s.fields);
  if (q.fields && q.fields.length > 0) {
    const denied = q.fields.filter((f) => !granted.has(f));
    if (denied.length > 0) return { ok: false, reason: 'field_not_allowed' };
    return { ok: true, reason: 'matched', allowedFields: q.fields };
  }
  // No specific fields requested but the grant is field-scoped → expose only the granted fields.
  return { ok: true, reason: 'matched', allowedFields: [...s.fields] };
}

/** Resolve a query against a set of (already-trusted) credentials. Allow if ANY
 *  matches; the decision's `allowedFields` is the union across matching credentials,
 *  and `constraints` merge (any restrictive flag set by a matching credential wins).
 *  On no match, the most specific deny reason seen is returned (fail-closed). */
export function resolveEntitlements(
  credentials: AgenticEntitlementCredentialV1[],
  query: EntitlementQuery,
): EntitlementDecision {
  const matched: string[] = [];
  const allowedFields = new Set<string>();
  let unrestrictedFields = false;
  let constraints: EntitlementDecision['constraints'];
  // Deny-reason precedence: a near-miss (right resource/actor, wrong field/purpose/class)
  // is more informative than not_found.
  const denyPrecedence: EntitlementReason[] = [
    'classification_exceeded',
    'purpose_not_allowed',
    'field_not_allowed',
    'action_not_allowed',
    'principal_mismatch',
    'expired',
    'resource_mismatch',
    'audience_mismatch',
    'not_found',
  ];
  let bestDeny: EntitlementReason = 'not_found';
  let bestDenyRank = denyPrecedence.length;

  for (const cred of credentials) {
    const m = matchesEntitlement(cred, query);
    if (m.ok) {
      matched.push(cred.id);
      if (m.allowedFields === undefined) unrestrictedFields = true;
      else m.allowedFields.forEach((f) => allowedFields.add(f));
      if (cred.credentialSubject.constraints) constraints = { ...constraints, ...cred.credentialSubject.constraints };
    } else {
      const rank = denyPrecedence.indexOf(m.reason);
      if (rank !== -1 && rank < bestDenyRank) {
        bestDenyRank = rank;
        bestDeny = m.reason;
      }
    }
  }

  if (matched.length === 0) {
    return { decision: 'deny', reason: bestDeny, matchedCredentials: [] };
  }
  return {
    decision: 'allow',
    reason: 'matched',
    matchedCredentials: matched,
    allowedFields: unrestrictedFields ? query.fields : [...allowedFields],
    constraints,
  };
}

/** Resolver over an in-memory credential set (tests + demo/dev). The set is
 *  assumed already-verified + unrevoked (the VC-proof/status layer is upstream). */
export class InMemoryEntitlementResolver {
  constructor(private readonly credentials: AgenticEntitlementCredentialV1[]) {}
  async resolve(query: EntitlementQuery): Promise<EntitlementDecision> {
    return resolveEntitlements(this.credentials, query);
  }
}
