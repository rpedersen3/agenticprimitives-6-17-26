// Entitlements types (spec 277 §10). Durable resource/action/field/purpose/
// classification authorization over VC-compatible credentials. This file is the
// shared contract; the matching engine is in `match.ts`. VC proof verification,
// status-list revocation, and storage caches are a later sub-wave — the matching
// core here is dependency-free and operates on the credential SUBJECT.

export type EntitlementAction =
  | 'read'
  | 'write'
  | 'list'
  | 'delete'
  | 'share'
  | 'export'
  | 'key.rotate'
  | 'break-glass';

export type EntitlementClassification =
  | 'public'
  | 'internal'
  | 'pii.low'
  | 'pii.sensitive'
  | 'secret.high'
  | 'regulated.high';

/** Classification ordering for the `classificationCeiling` check (low → high). */
export const CLASSIFICATION_ORDER: readonly EntitlementClassification[] = [
  'public',
  'internal',
  'pii.low',
  'pii.sensitive',
  'regulated.high',
  'secret.high',
];

export interface EntitlementConstraints {
  noPersist?: boolean;
  noTraining?: boolean;
  redactByDefault?: boolean;
  requiresFreshConsent?: boolean;
  requiresStepUp?: boolean;
  requiresQuorum?: boolean;
}

/** A VC-compatible entitlement credential (spec 277 §10). The matching engine
 *  reads `credentialSubject` + the validity window; `proof`/`credentialStatus`
 *  are verified by the (later) VC-proof + status-list layer, not here. */
export interface AgenticEntitlementCredentialV1 {
  '@context': string[];
  type: ['VerifiableCredential', 'AgenticEntitlementCredentialV1'];
  id: `urn:ap:entitlement:${string}`;
  issuer: string;
  validFrom: string;
  validUntil?: string;
  credentialSubject: {
    /** The actor (delegate / session key / audience-bound holder) the entitlement is for. */
    id: string;
    /** The principal whose data the actor may touch (the data owner). */
    principal?: string;
    audience: string;
    resource: string;
    actions: EntitlementAction[];
    /** Allowed fields; absent ⇒ all fields of the resource. */
    fields?: string[];
    purpose?: string;
    classificationCeiling?: EntitlementClassification;
    constraints?: EntitlementConstraints;
  };
  credentialStatus?: {
    id: string;
    type: 'BitstringStatusListEntry' | string;
    statusPurpose: 'revocation' | 'suspension' | string;
  };
  proof?: unknown;
}

export interface EntitlementQuery {
  actor: string;
  principal?: string;
  audience: string;
  resource: string;
  action: EntitlementAction | string;
  fields?: string[];
  purpose?: string;
  /** The classification of the data being accessed (checked against the ceiling). */
  classification?: EntitlementClassification;
  at: Date;
}

export type EntitlementReason =
  | 'matched'
  | 'not_found'
  | 'expired'
  | 'revoked'
  | 'suspended'
  | 'field_not_allowed'
  | 'purpose_not_allowed'
  | 'classification_exceeded'
  | 'audience_mismatch'
  | 'resource_mismatch'
  | 'action_not_allowed'
  | 'principal_mismatch';

export interface EntitlementDecision {
  decision: 'allow' | 'deny';
  reason: EntitlementReason;
  matchedCredentials: string[];
  /** On allow: the fields the actor may see (intersection of requested + granted). */
  allowedFields?: string[];
  constraints?: EntitlementConstraints;
}

export interface EntitlementResolver {
  resolve(query: EntitlementQuery): Promise<EntitlementDecision>;
}
