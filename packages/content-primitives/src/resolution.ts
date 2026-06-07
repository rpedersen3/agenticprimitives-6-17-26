import type { Address } from '@agenticprimitives/types';
import type {
  ContentDescriptor,
  CanonicalReference,
  RightsStatus,
  TrustProfile,
} from './types.js';

// Candidate resolution (spec 266 §3 / review §5): a reference resolves to a
// canonical locus + MULTIPLE candidate descriptors (different issuers/editions).
// The resolver does NOT pick one "official" answer — it filters by a trust
// profile + constraints; the agent/policy chooses. A descriptor is a policy
// INPUT, never a grant (ADR-0033 R5).

export interface ResolutionConstraints {
  contentType?: string;
  language?: string;
  /** Acceptable rights postures (e.g. ['public-domain']). */
  rightsStatus?: RightsStatus[];
  trustProfile?: TrustProfile;
}

/** A descriptor plus the profile/constraint screening outcome (pre-verification). */
export interface Candidate {
  descriptor: ContentDescriptor;
  /** True iff the descriptor's issuer is in the active trust profile's allowlist. */
  issuerTrusted: boolean;
  /** True iff the descriptor passed all constraint filters. */
  admitted: boolean;
  /** Why a candidate was screened out (when !admitted). */
  reason?: string;
}

export interface ResolutionResult {
  canonicalReference: CanonicalReference;
  candidates: Candidate[];
}

/** A trust profile = an issuer allowlist + posture flags. Phase 1 wires
 *  `public-domain-demo` only; the rest are reserved shapes (spec 266 §policy). */
export interface TrustProfileConfig {
  profile: TrustProfile;
  /** Issuer Smart Agent addresses trusted under this profile. Empty = trust none. */
  trustedIssuers: Address[];
  /** If set, only these rights postures are admitted. */
  allowedRightsStatus?: RightsStatus[];
  /** If true, an untrusted issuer is screened out (admitted=false). */
  requireTrustedIssuer: boolean;
}

function issuerIn(list: Address[], issuer: Address): boolean {
  return list.some((a) => a.toLowerCase() === issuer.toLowerCase());
}

/**
 * Screen descriptors for a canonical reference into a candidate set under a
 * trust profile + constraints. Pure + deterministic. Does NOT verify signatures
 * (that is the caller's per-candidate step) — it screens *eligibility*.
 */
export function resolveCandidates(
  reference: CanonicalReference,
  descriptors: ContentDescriptor[],
  profile: TrustProfileConfig,
  constraints: ResolutionConstraints = {},
): ResolutionResult {
  const candidates: Candidate[] = descriptors
    .filter((d) => d.canonicalId.toLowerCase() === reference.id.toLowerCase())
    .map((descriptor) => {
      const issuerTrusted = issuerIn(profile.trustedIssuers, descriptor.issuer.address);
      let reason: string | undefined;

      if (descriptor.status !== 'active') reason = `status ${descriptor.status}`;
      else if (profile.requireTrustedIssuer && !issuerTrusted) reason = 'issuer not in trust profile allowlist';
      else if (constraints.contentType && descriptor.contentType !== constraints.contentType) reason = 'contentType mismatch';
      else if (constraints.language && descriptor.work?.language && descriptor.work.language !== constraints.language) reason = 'language mismatch';
      else {
        const allowedRights = constraints.rightsStatus ?? profile.allowedRightsStatus;
        if (allowedRights && allowedRights.length > 0) {
          const rs = descriptor.work?.rightsStatus ?? 'unknown';
          if (!allowedRights.includes(rs)) reason = `rightsStatus ${rs} not permitted`;
        }
      }
      return { descriptor, issuerTrusted, admitted: reason === undefined, reason };
    });

  return { canonicalReference: reference, candidates };
}
