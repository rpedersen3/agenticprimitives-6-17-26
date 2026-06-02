// JP-vertical agreement payload + commitment helpers.
//
// The GENERIC commitment-math + commitment payload types live in
// `@agenticprimitives/agreements`. This module ships the JP-VERTICAL agreement
// fields and computes the canonical commitment by feeding those fields through
// the substrate's commitment helpers.

import {
  bytesCommitment,
  computeAgreementCommitment,
  issuerCommitment,
  partySetCommitment,
  type Hex32,
} from '@agenticprimitives/agreements';
import type { Address } from '@agenticprimitives/types';

export type JpAgreementKind =
  | 'facilitator-adopter'
  | 'facilitator-network'
  | 'fund-disbursement';

export interface JpAgreementPayload {
  agreementKind: JpAgreementKind;
  /** FPG identifier the agreement scopes to. */
  fpgId: string;
  /** Free-text terms — content stays in vaults; only hash on chain. */
  termsText: string;
  /** Capability list — what the parties grant each other under this agreement. */
  capabilityList: string[];
  /** When the agreement starts being executable. */
  validFrom: string;
  /** Optional hard expiry. */
  validUntil?: string;
}

export interface JpAgreementSpec {
  party1: Address;
  party2: Address;
  issuer: Address;
  payload: JpAgreementPayload;
  salt: bigint;
}

export interface JpAgreementCommitmentResult {
  agreementCommitment: Hex32;
  partySetCommitment: Hex32;
  issuerCommitment: Hex32;
  termsCommitment: Hex32;
  scheduleCommitment: Hex32;
}

/** Compute the canonical commitment for a JP agreement. */
export function buildJpAgreementCommitment(spec: JpAgreementSpec): JpAgreementCommitmentResult {
  const psc = partySetCommitment(spec.party1, spec.party2);
  const ic = issuerCommitment(spec.issuer);
  const termsCommitment = bytesCommitment(
    canonicalTermsString({
      kind: spec.payload.agreementKind,
      fpgId: spec.payload.fpgId,
      terms: spec.payload.termsText,
      capabilities: spec.payload.capabilityList,
    }),
  );
  const scheduleCommitment = bytesCommitment(
    canonicalScheduleString({
      validFrom: spec.payload.validFrom,
      validUntil: spec.payload.validUntil ?? '',
    }),
  );
  const agreementCommitment = computeAgreementCommitment({
    partySetCommitment: psc,
    issuerCommitment: ic,
    termsCommitment,
    scheduleCommitment,
    salt: spec.salt,
  });
  return {
    agreementCommitment,
    partySetCommitment: psc,
    issuerCommitment: ic,
    termsCommitment,
    scheduleCommitment,
  };
}

/** Canonical JSON-like serialisation for terms — same string across stacks. */
function canonicalTermsString(args: {
  kind: JpAgreementKind;
  fpgId: string;
  terms: string;
  capabilities: string[];
}): string {
  const caps = [...args.capabilities].sort();
  return JSON.stringify({
    capabilities: caps,
    fpgId: args.fpgId,
    kind: args.kind,
    terms: args.terms,
  });
}

function canonicalScheduleString(args: { validFrom: string; validUntil: string }): string {
  return JSON.stringify({ validFrom: args.validFrom, validUntil: args.validUntil });
}
