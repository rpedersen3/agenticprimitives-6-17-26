// KAS verification (spec 277 §14.13.2). Independently re-verifies a DecryptGrant
// against the live request context BEFORE any field is decrypted, and consumes
// the one-time JTI only after every other check passes (a denied grant never
// burns its JTI). Signature verification + the actual DEK release are injected
// (the package stays dependency-free; key-custody does the unwrap downstream).

import type {
  DecryptGrantV1,
  DecryptGrantExpectation,
  KeyReleaseDecision,
  DecryptGrantReason,
  ReplayStore,
} from './types.js';
import { computeGrantHash } from './grant.js';

// Classification ordering for the ceiling check (low → high). Unknown → -1.
const CLASS_ORDER = ['public', 'internal', 'pii.low', 'pii.sensitive', 'regulated.high', 'secret.high'];
function rank(c: string | undefined): number {
  return c === undefined ? -1 : CLASS_ORDER.indexOf(c);
}
function eq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export interface VerifyDecryptGrantOpts {
  now: Date;
  replayStore: ReplayStore;
  /** Optional grant-signature verifier (proof). Omit to skip (demo/self-issued). */
  verifySignature?: (grant: DecryptGrantV1) => Promise<boolean>;
}

/** Verify a DecryptGrant against the request expectation. Fail-closed; one-time JTI. */
export async function verifyDecryptGrant(
  grant: DecryptGrantV1,
  expect: DecryptGrantExpectation,
  opts: VerifyDecryptGrantOpts,
): Promise<KeyReleaseDecision> {
  const deny = (reason: DecryptGrantReason): KeyReleaseDecision => ({
    decision: 'deny',
    reason,
    grantId: grant?.id,
    jti: grant?.replay?.jti,
  });

  if (!grant || grant.type !== 'DecryptGrantV1' || !grant.replay?.jti) return deny('bad_shape');

  // grantHash integrity — the hash must cover the presented body.
  const { grantHash, proof, ...body } = grant;
  void proof;
  if ((await computeGrantHash(body)) !== grantHash) return deny('grant_hash_mismatch');

  // Signature (injected).
  if (opts.verifySignature && !(await opts.verifySignature(grant))) return deny('signature_invalid');

  // Scope binding.
  if (!eq(grant.audience, expect.audience)) return deny('audience_mismatch');
  if (!eq(grant.principal, expect.principal)) return deny('principal_mismatch');
  if (expect.delegate !== undefined && !eq(grant.delegate ?? '', expect.delegate)) return deny('delegate_mismatch');
  if (!eq(grant.mcp.toolName, expect.toolName)) return deny('tool_mismatch');
  if (grant.mcp.argsHash !== expect.argsHash) return deny('args_hash_mismatch');
  if (!eq(grant.vault.resource, expect.resource)) return deny('resource_mismatch');

  // Field projection: requested ⊆ granted (granted undefined ⇒ all fields).
  let releasedFields = grant.vault.fields;
  if (expect.requestedFields && expect.requestedFields.length > 0) {
    if (grant.vault.fields) {
      const bad = expect.requestedFields.filter((f) => !grant.vault.fields!.includes(f));
      if (bad.length > 0) return deny('field_not_allowed');
    }
    releasedFields = expect.requestedFields;
  }

  // Purpose pinning + classification ceiling.
  if (grant.vault.purpose !== undefined && (expect.purpose === undefined || !eq(grant.vault.purpose, expect.purpose))) {
    return deny('purpose_not_allowed');
  }
  if (grant.vault.classificationCeiling !== undefined && expect.classification !== undefined) {
    if (rank(expect.classification) > rank(grant.vault.classificationCeiling)) return deny('classification_exceeded');
  }

  // Validity window.
  const now = opts.now.getTime();
  if (now < new Date(grant.constraints.notBefore).getTime()) return deny('not_yet_valid');
  const expiresAt = new Date(grant.constraints.expiresAt).getTime();
  if (now > expiresAt) return deny('expired');

  // Authorization-hash binding (only when the caller pins them).
  if (expect.delegationHash && grant.authorization.delegationHash !== expect.delegationHash) return deny('delegation_hash_mismatch');
  if (expect.policyHash && grant.authorization.policyHash !== expect.policyHash) return deny('policy_hash_mismatch');
  if (expect.entitlementHashes) {
    const granted = new Set(grant.authorization.entitlementHashes ?? []);
    if (!expect.entitlementHashes.every((h) => granted.has(h))) return deny('entitlement_hash_mismatch');
  }

  // One-time use — consume LAST, so a denied grant never burns its JTI.
  if (!(await opts.replayStore.consume(grant.replay.jti, Math.ceil(expiresAt / 1000)))) return deny('jti_replay');

  return { decision: 'allow', reason: 'allow', releasedFields, grantId: grant.id, jti: grant.replay.jti };
}

/** In-memory one-time-use ledger (tests + local dev). Production: D1 / Durable Object. */
export function createInMemoryReplayStore(): ReplayStore {
  const used = new Set<string>();
  return {
    async consume(jti: string): Promise<boolean> {
      if (used.has(jti)) return false;
      used.add(jti);
      return true;
    },
  };
}

/** The Key Authorization Service surface — wraps verification (the DEK release
 *  itself is done by the caller via key-custody once `authorize` returns allow). */
export interface KeyAuthorizationService {
  authorize(grant: DecryptGrantV1, expect: DecryptGrantExpectation, now?: Date): Promise<KeyReleaseDecision>;
}

/** Local-dev KAS: in-process verification with an in-memory replay store. Not for
 *  production (no durable replay ledger, no remote KMS isolation). */
export function createLocalDevKeyAuthorizationService(opts?: {
  replayStore?: ReplayStore;
  verifySignature?: (grant: DecryptGrantV1) => Promise<boolean>;
}): KeyAuthorizationService {
  const replayStore = opts?.replayStore ?? createInMemoryReplayStore();
  return {
    authorize(grant, expect, now) {
      return verifyDecryptGrant(grant, expect, { now: now ?? new Date(), replayStore, verifySignature: opts?.verifySignature });
    },
  };
}
