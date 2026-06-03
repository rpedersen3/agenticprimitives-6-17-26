// Association issuance flow (Wave 8.8) — IA §4a / §4b.
//
// Jill-as-JP issues a `JpAssociationCredential` to a facilitator / adopter org
// SA: the credential that says "JP recognizes this org as an approved
// facilitator (or adopter) for these FPGs". This is the OFF-CHAIN VC half; the
// on-chain public Association assertion (assertion-flow.ts +
// AttestationRegistry) references its `credentialHash`.
//
// Vocabulary firewall (ADR-0021): the JP/FPG vertical content lives here, never
// in packages. This module is chain-free + deterministic so the spine e2e runs
// offline; the relayer submission lives in `onchain.ts`.

import {
  buildSituation,
  credentialHash,
  type Situation,
  type UnsignedCredential,
  VC_CONTEXT_V2,
} from '@agenticprimitives/verifiable-credentials';
import {
  CREDENTIAL_TYPE,
  computeAttestationUid,
  type AssociationAttestationRequest,
  type Hex32,
} from '@agenticprimitives/attestations';
import type { Address, Hex } from '@agenticprimitives/types';

import { JP_SHAPES } from './jp-shapes.js';
import { verifyErc1271 } from './chain.js';

export type AssociationKind = 'facilitator' | 'adopter';

/** The JP-vertical body of a JpAssociationCredential (matches the SHACL in
 *  jp-shapes.ts — facilitatorRole / fpgIds / adopterType / mouHash / validUntil). */
export interface JpAssociationBody extends Record<string, unknown> {
  associationKind: AssociationKind;
  /** facilitatorRole — JP's recognition tier. */
  role: 'approved' | 'verified' | 'trusted';
  /** FPG ids the recognition covers. */
  fpgIds: string[];
  /** ISO country codes the org operates in (facilitator). */
  countries?: string[];
  /** Adopter type (adopter associations). */
  adopterType?: 'individual' | 'family' | 'group' | 'church' | 'organization' | 'network';
  /** ADOPT MOU acceptance hash (adopter associations). */
  mouHash?: Hex32;
  validUntil?: string;
}

const ZERO32 = ('0x' + '00'.repeat(32)) as Hex32;
const ZERO_ADDR = ('0x' + '00'.repeat(20)) as Address;

export type JpAssociationCredential = UnsignedCredential<Situation<{ payload: JpAssociationBody }>>;

/** Build the unsigned JpAssociationCredential (DOLCE+DnS Situation). The issuer
 *  is JP's org SA; the subject (holder) is the facilitator/adopter org SA. */
export function buildAssociationCredential(args: {
  issuerCaip10: string;
  issuer: Address;
  subjectOrg: Address;
  body: JpAssociationBody;
  validFrom: string;
  validUntil?: string;
}): JpAssociationCredential {
  const situation = buildSituation<{ payload: JpAssociationBody }>({
    description: 'apatl:JpAssociationCredential',
    roles: {
      issuer: args.issuer,
      subject: args.subjectOrg,
    },
    body: { payload: args.body },
  });
  const shape = args.body.associationKind === 'facilitator' ? JP_SHAPES.facilitator : JP_SHAPES.adopter;
  return {
    '@context': [VC_CONTEXT_V2],
    type: ['VerifiableCredential', 'AssociationCredential'],
    issuer: args.issuerCaip10,
    validFrom: args.validFrom,
    validUntil: args.validUntil,
    credentialSubject: situation,
    credentialSchema: { id: shape.uri, type: 'ShaclShape' },
  };
}

export interface AssociationIssuance {
  /** The off-chain credential the JP issuer holds + the org keeps in its vault. */
  credential: JpAssociationCredential;
  /** RFC-8785/keccak hash — what the issuer signs and the on-chain row carries. */
  credentialHash: Hex32;
  /** The on-chain assertion request (issuerSignature still to be filled). */
  request: Omit<AssociationAttestationRequest, 'issuerSignature'>;
  /** Deterministic UID the AttestationRegistry will assign. */
  predictedUid: Hex32;
}

/**
 * Verify an OFF-CHAIN recognition credential before honoring it (the recognition-gate
 * integrity backstop). Recompute the credential hash, ERC-1271-verify the issuer's
 * signature against the claimed JP issuer SA, and extract the SIGNED subject + kind +
 * people groups from the credential body (NOT from any caller-supplied row metadata, so
 * a copied signature can only recognize what JP actually signed). Returns null (fail-closed)
 * on any mismatch — a forged or unsigned row never passes.
 */
export async function verifyRecognitionCredential(
  credential: JpAssociationCredential,
  issuerSignature: Hex,
  issuerSa: Address,
): Promise<{ subjectOrg: Address; associationKind: AssociationKind; fpgIds: string[] } | null> {
  try {
    const ch = credentialHash(credential);
    if (!(await verifyErc1271(issuerSa, ch, issuerSignature))) return null;
    const situation = credential.credentialSubject;
    const subjectOrg = situation?.roles?.subject as Address | undefined;
    const body = situation?.body?.payload;
    if (!subjectOrg || !/^0x[0-9a-fA-F]{40}$/.test(subjectOrg) || !body?.associationKind || !Array.isArray(body.fpgIds)) return null;
    return { subjectOrg, associationKind: body.associationKind, fpgIds: body.fpgIds };
  } catch {
    return null;
  }
}

/** Compose the credential + the on-chain Association assertion request (minus the
 *  issuer signature, which is produced at submit time over `credentialHash`). */
export function issueAssociation(args: {
  issuerCaip10: string;
  issuer: Address;
  subjectOrg: Address;
  body: JpAssociationBody;
  validFrom: string;
  validUntil?: string;
  salt: bigint;
}): AssociationIssuance {
  const credential = buildAssociationCredential(args);
  const ch = credentialHash(credential);
  const schemaId = args.body.associationKind === 'facilitator' ? JP_SHAPES.facilitator.hash : JP_SHAPES.adopter.hash;
  const request: Omit<AssociationAttestationRequest, 'issuerSignature'> = {
    schemaId,
    credentialType: CREDENTIAL_TYPE.Association,
    credentialHash: ch,
    offchainCredentialStatusList: ZERO32,
    subject: args.subjectOrg,
    issuer: args.issuer,
    salt: args.salt,
  };
  const predictedUid = computeAttestationUid({
    subject: args.subjectOrg,
    party2: ZERO_ADDR,
    issuer: args.issuer,
    credentialType: CREDENTIAL_TYPE.Association,
    credentialHash: ch,
    refUID: ZERO32,
    salt: args.salt,
  });
  return { credential, credentialHash: ch, request, predictedUid };
}
