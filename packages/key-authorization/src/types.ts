// Key-authorization types (spec 277 §5 + §14). Policy-bound, one-time key release:
// a DecryptGrant is the enforcement boundary the KAS independently verifies before
// any field is decrypted. This package consumes key-custody primitives for the
// actual DEK release, but AUTHORITY stays delegation/entitlement/policy — the
// grant binds all of those by hash so it can't be replayed under a different
// principal, tool, args, vault, field, purpose, or classification.

export type DecryptGrantReason =
  | 'allow'
  | 'bad_shape'
  | 'grant_hash_mismatch'
  | 'signature_invalid'
  | 'audience_mismatch'
  | 'principal_mismatch'
  | 'delegate_mismatch'
  | 'tool_mismatch'
  | 'args_hash_mismatch'
  | 'resource_mismatch'
  | 'field_not_allowed'
  | 'purpose_not_allowed'
  | 'classification_exceeded'
  | 'not_yet_valid'
  | 'expired'
  | 'jti_replay'
  | 'delegation_hash_mismatch'
  | 'entitlement_hash_mismatch'
  | 'policy_hash_mismatch';

export type Sha256 = `sha256:${string}`;

/** The one-time key-release grant (spec 277 §14.13.1). */
export interface DecryptGrantV1 {
  type: 'DecryptGrantV1';
  id: `urn:ap:decrypt-grant:${string}`;
  /** sha256 over the canonical grant body (everything EXCEPT `grantHash` + `proof`). */
  grantHash: Sha256;
  issuer: string;
  audience: string;
  principal: string;
  delegate?: string;
  mcp: {
    resourceUri: string;
    serverId: string;
    toolName: string;
    argsHash: string;
  };
  authorization: {
    oauthTokenHash?: string;
    grantBundleHash?: Sha256;
    delegationHash?: Sha256;
    entitlementHashes?: Sha256[];
    policyHash?: Sha256;
  };
  vault: {
    vaultId: string;
    objectIds: string[];
    resource: string;
    fields?: string[];
    purpose?: string;
    classificationCeiling?: string;
  };
  constraints: {
    ttlSeconds: number;
    notBefore: string;
    expiresAt: string;
    oneTimeUse: true;
    noPersist?: boolean;
    noTraining?: boolean;
  };
  replay: { jti: string };
  proof?: {
    type: 'Eip712Signature2026' | 'JWS' | 'demo-hmac' | string;
    signature: string;
  };
}

/** What the KAS checks the grant AGAINST — the live request context. Any field
 *  left undefined is not checked (e.g. a flow without OAuth omits oauthTokenHash). */
export interface DecryptGrantExpectation {
  audience: string;
  principal: string;
  delegate?: string;
  toolName: string;
  argsHash: string;
  resource: string;
  /** Fields actually being requested now; must be a subset of the grant's `vault.fields`. */
  requestedFields?: string[];
  purpose?: string;
  /** Classification of the data; must not exceed the grant's `vault.classificationCeiling`. */
  classification?: string;
  /** When provided, must equal the grant's authorization hashes (binding check). */
  delegationHash?: Sha256;
  entitlementHashes?: Sha256[];
  policyHash?: Sha256;
}

export interface KeyReleaseDecision {
  decision: 'allow' | 'deny';
  reason: DecryptGrantReason;
  /** On allow: the fields the KAS authorizes for release (grant∩requested). */
  releasedFields?: string[];
  grantId?: string;
  jti?: string;
}

/** One-time-use ledger for grant JTIs. `consume` returns false if already used. */
export interface ReplayStore {
  consume(jti: string, expiresAtUnix: number): Promise<boolean>;
}
