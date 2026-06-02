// Agreement flow orchestrator — IA §4c steps 5a..6.
//
// Composes agreements + verifiable-credentials to (a) build the JP-vertical
// agreement payload, (b) compute the substrate commitment via
// buildJpAgreementCommitment, (c) issue an AgreementCredential (W3C VC + DOLCE
// Situation), and (d) produce the AgreementIssuancePayload ready for
// AgreementRegistry.register().

import {
  buildSituation,
  type Situation,
  type UnsignedCredential,
  type VerifiableCredential,
  VC_CONTEXT_V2,
} from '@agenticprimitives/verifiable-credentials';
import type { AgreementIssuancePayload } from '@agenticprimitives/agreements';
import type { Address } from '@agenticprimitives/types';

import { JP_SHAPES } from './jp-shapes.js';
import {
  buildJpAgreementCommitment,
  type JpAgreementPayload,
  type JpAgreementSpec,
} from './agreement-payload.js';

export interface IssuedAgreement {
  /** The off-chain credential the issuer signs and the parties hold in their JV. */
  credential: UnsignedCredential<Situation<{ payload: JpAgreementPayload }>>;
  /** The substrate commitment math result. */
  commitment: ReturnType<typeof buildJpAgreementCommitment>;
  /** Payload ready to hand to AgreementRegistry.register(). */
  registryPayload: Omit<AgreementIssuancePayload, 'attestationStructHash' | 'issuerSignature'>;
}

/** Issuer (Global Church) takes a dual-signed Commitment + parties + payload,
 *  builds the AgreementCredential and the commitment row payload. The issuer
 *  signature over `attestationStructHash` is the caller's responsibility. */
export function issueAgreement(spec: JpAgreementSpec & { issuerCaip10: string }): IssuedAgreement {
  const commitment = buildJpAgreementCommitment(spec);

  // DOLCE+DnS Situation pattern — the off-chain credential body.
  const situation = buildSituation<{ payload: JpAgreementPayload }>({
    description: 'apagr:AgreementCredential',
    roles: {
      issuer: spec.issuer,
      party1: spec.party1,
      party2: spec.party2,
    },
    body: { payload: spec.payload },
  });

  const credential: UnsignedCredential<Situation<{ payload: JpAgreementPayload }>> = {
    '@context': [VC_CONTEXT_V2],
    type: ['VerifiableCredential', 'AgreementCredential'],
    issuer: spec.issuerCaip10,
    validFrom: spec.payload.validFrom,
    validUntil: spec.payload.validUntil,
    credentialSubject: situation,
    credentialSchema: {
      id: JP_SHAPES.agreement.uri,
      type: 'ShaclShape',
    },
  };

  const registryPayload: IssuedAgreement['registryPayload'] = {
    schemaHash: JP_SHAPES.agreement.hash,
    issuer: spec.issuer,
    agreementCommitment: commitment.agreementCommitment,
    partySetCommitment: commitment.partySetCommitment,
    issuerCommitment: commitment.issuerCommitment,
    termsCommitment: commitment.termsCommitment,
    scheduleCommitment: commitment.scheduleCommitment,
    salt: spec.salt,
  };

  return { credential, commitment, registryPayload };
}
