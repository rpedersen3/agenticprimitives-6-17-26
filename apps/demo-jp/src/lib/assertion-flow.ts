// Assertion flow orchestrator — IA §4b (public association) + §10b (joint agreement).
//
// Composes verifiable-credentials + attestations to take a holder's
// vault-resident credential and produce the public on-chain assertion payload.

import {
  CREDENTIAL_TYPE,
  computeAttestationUid,
  type AssociationAttestationRequest,
  type Hex32,
  type JointAgreementAttestationRequest,
} from '@agenticprimitives/attestations';
import { credentialHash, type VerifiableCredential } from '@agenticprimitives/verifiable-credentials';
import type { Address, Hex } from '@agenticprimitives/types';

import { JP_SHAPES } from './jp-shapes.js';

/** IA §4b: facilitator/adopter org publishes an Association assertion. */
export function buildAssociationAssertion(args: {
  credential: VerifiableCredential;
  subject: Address;
  issuer: Address;
  issuerSignatureOverCredentialHash: Hex;
  associationKind: 'facilitator' | 'adopter';
  salt: bigint;
}): { request: AssociationAttestationRequest; predictedUid: Hex32 } {
  const ch = credentialHash(args.credential);
  const schemaId = args.associationKind === 'facilitator' ? JP_SHAPES.facilitator.hash : JP_SHAPES.adopter.hash;
  const request: AssociationAttestationRequest = {
    schemaId,
    credentialType: CREDENTIAL_TYPE.Association,
    credentialHash: ch,
    offchainCredentialStatusList: ('0x' + '00'.repeat(32)) as Hex32,
    subject: args.subject,
    issuer: args.issuer,
    issuerSignature: args.issuerSignatureOverCredentialHash,
    salt: args.salt,
  };
  const predictedUid = computeAttestationUid({
    subject: args.subject,
    party2: ('0x' + '00'.repeat(20)) as Address,
    issuer: args.issuer,
    credentialType: CREDENTIAL_TYPE.Association,
    credentialHash: ch,
    refUID: ('0x' + '00'.repeat(32)) as Hex32,
    salt: args.salt,
  });
  return { request, predictedUid };
}

/** IA §10b: joint agreement assertion with bilateral consent.
 *  RW1-1 (ADR-0027): consent is two party signatures over the JOINT_CONSENT
 *  digest (`jointConsentDigest(party1, party2, agreementCommitment,
 *  credentialHash)`), VERIFIED on-chain — not a supplied reference. */
export function buildJointAgreementAssertion(args: {
  credential: VerifiableCredential;
  party1: Address;
  party2: Address;
  issuer: Address;
  issuerSignatureOverCredentialHash: Hex;
  /** party1's consent signature over the JOINT_CONSENT digest (ERC-1271 / ECDSA). */
  party1Signature: Hex;
  /** party2's consent signature over the JOINT_CONSENT digest (ERC-1271 / ECDSA). */
  party2Signature: Hex;
  /** Back-pointer to spec 241 AgreementRegistry row. */
  agreementCommitment: Hex32;
  salt: bigint;
}): { request: JointAgreementAttestationRequest; predictedUid: Hex32 } {
  const ch = credentialHash(args.credential);
  const request: JointAgreementAttestationRequest = {
    schemaId: JP_SHAPES.agreement.hash,
    credentialType: CREDENTIAL_TYPE.JointAgreement,
    credentialHash: ch,
    refUID: args.agreementCommitment,
    offchainCredentialStatusList: ('0x' + '00'.repeat(32)) as Hex32,
    party1: args.party1,
    party2: args.party2,
    issuer: args.issuer,
    issuerSignature: args.issuerSignatureOverCredentialHash,
    party1Signature: args.party1Signature,
    party2Signature: args.party2Signature,
    salt: args.salt,
  };
  const predictedUid = computeAttestationUid({
    subject: args.party1,
    party2: args.party2,
    issuer: args.issuer,
    credentialType: CREDENTIAL_TYPE.JointAgreement,
    credentialHash: ch,
    refUID: args.agreementCommitment,
    salt: args.salt,
  });
  return { request, predictedUid };
}
