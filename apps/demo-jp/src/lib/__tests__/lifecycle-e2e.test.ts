// Wave 8.14 — full IA §4 lifecycle, end to end, plus the on-chain payload-shape
// guarantee. Runs offline: it composes the spine exactly as the Pete/Jill
// dashboards do, then proves every registry payload encodes + decodes against
// the REAL deployed-contract ABI (so a live Base Sepolia write can't fail on a
// shape mismatch — the only thing the offline test can't do is pay gas).

import { describe, expect, it } from 'vitest';
import { decodeFunctionData, keccak256, encodePacked, hashMessage } from 'viem';

import { mintPersona } from '../personas.js';
import { getGlobalChurch, getJP } from '../org-personas.js';
import { expressIntent, tryMatch, buildCommitment } from '../intent-flow.js';
import { JP_INTENT_OBJECT } from '../intent-payload.js';
import { issueAgreement } from '../agreement-flow.js';
import { buildJointAgreementAssertion } from '../assertion-flow.js';
import { issueAssociation } from '../issuance-flow.js';
import {
  AGREEMENT_REGISTRY_ABI,
  ATTESTATION_REGISTRY_ABI,
  encodeRegisterAgreement,
  encodeAssertAssociation,
  encodeAssertJointAgreement,
} from '../chain.js';
import { credentialHash } from '@agenticprimitives/verifiable-credentials';
import type { Hex32 } from '@agenticprimitives/attestations';

describe('demo-jp full lifecycle (IA §4) + on-chain payload shapes', () => {
  it('walks Pete-issues → adopter+facilitator intents → match → commitment → agreement → joint assertion', async () => {
    const adopterOrg = mintPersona('pete');
    const facilitatorOrg = mintPersona('jill');
    const gc = getGlobalChurch();
    const jp = getJP();
    const broker = jp.saAddress;
    const fpgId = 'NAJDI';

    // 1. Direct-Lane intents (adopter need ↔ facilitator offer).
    const need = await expressIntent({ id: 'need', expressedBy: adopterOrg.address, object: JP_INTENT_OBJECT.NeedFacilitator, payload: { fpgId, adopterType: 'church' } });
    const offer = await expressIntent({ id: 'offer', expressedBy: facilitatorOrg.address, object: JP_INTENT_OBJECT.OfferFacilitator, payload: { fpgId } });
    expect(need.resolved).not.toBeNull();
    expect(offer.resolved).not.toBeNull();

    // 2. JP brokers a match (align on the shared facilitator object, opposite direction).
    need.intent.object = 'apint:Facilitator';
    need.intent.direction = 'receive';
    offer.intent.object = 'apint:Facilitator';
    offer.intent.direction = 'give';
    const match = tryMatch(broker, need.intent, offer.intent, { topicSimilarityThreshold: 0 });
    expect(match).not.toBeNull();

    // 3. Commitment from the matched pair.
    const commitment = buildCommitment({ intentMatch: match!, parties: [adopterOrg.address, facilitatorOrg.address] });
    expect(commitment.parties).toEqual([adopterOrg.address, facilitatorOrg.address]);

    // 4. Global Church issues the AgreementCredential + commitment row.
    const issued = issueAgreement({
      party1: adopterOrg.address,
      party2: facilitatorOrg.address,
      issuer: gc.saAddress,
      issuerCaip10: `eip155:84532:${gc.saAddress}`,
      payload: { agreementKind: 'facilitator-adopter', fpgId, termsText: 'demo terms', capabilityList: ['receive-updates', 'send-support'], validFrom: '2026-07-01T00:00:00Z' },
      salt: 42n,
    });

    // 5. Bilateral joint assertion back-points to the commitment row.
    const sig = hashMessage('issuer-sig') as Hex32;
    const consent = keccak256(encodePacked(['address', 'address'], [adopterOrg.address, facilitatorOrg.address])) as Hex32;
    const signedVc = { ...issued.credential, proof: undefined } as Parameters<typeof buildJointAgreementAssertion>[0]['credential'];
    const joint = buildJointAgreementAssertion({
      credential: signedVc,
      party1: adopterOrg.address,
      party2: facilitatorOrg.address,
      issuer: gc.saAddress,
      issuerSignatureOverCredentialHash: sig,
      bilateralConsentRef: consent,
      agreementCommitment: issued.registryPayload.agreementCommitment,
      salt: 1n,
    });
    expect(joint.request.refUID).toBe(issued.registryPayload.agreementCommitment);
    expect(joint.request.party1).toBe(adopterOrg.address);
  });

  it('register payload encodes + decodes against the deployed AgreementRegistry ABI', () => {
    const adopterOrg = mintPersona('pete');
    const facilitatorOrg = mintPersona('jill');
    const gc = getGlobalChurch();
    const issued = issueAgreement({
      party1: adopterOrg.address,
      party2: facilitatorOrg.address,
      issuer: gc.saAddress,
      issuerCaip10: `eip155:84532:${gc.saAddress}`,
      payload: { agreementKind: 'facilitator-adopter', fpgId: 'NAJDI', termsText: 't', capabilityList: ['c'], validFrom: '2026-07-01T00:00:00Z' },
      salt: 9n,
    });
    const attestationStructHash = keccak256(
      encodePacked(['bytes32', 'bytes32'], [issued.registryPayload.agreementCommitment, issued.registryPayload.schemaHash]),
    ) as Hex32;
    const calldata = encodeRegisterAgreement({ ...issued.registryPayload, attestationStructHash, issuerSignature: '0x1234' });

    const decoded = decodeFunctionData({ abi: AGREEMENT_REGISTRY_ABI, data: calldata });
    expect(decoded.functionName).toBe('register');
    const p = (decoded.args ?? [])[0] as { agreementCommitment: string; issuer: string; salt: bigint };
    expect(p.agreementCommitment).toBe(issued.registryPayload.agreementCommitment);
    expect(p.issuer.toLowerCase()).toBe(gc.saAddress.toLowerCase());
    expect(p.salt).toBe(9n);
  });

  it('association + joint-agreement payloads encode + decode against the AttestationRegistry ABI', () => {
    const org = mintPersona('pete');
    const jp = getJP();
    const assoc = issueAssociation({
      issuerCaip10: `eip155:84532:${jp.saAddress}`,
      issuer: jp.saAddress,
      subjectOrg: org.address,
      body: { associationKind: 'facilitator', role: 'approved', fpgIds: ['NAJDI'], countries: ['SA'] },
      validFrom: '2026-06-02T00:00:00Z',
      salt: 5n,
    });
    const assocCalldata = encodeAssertAssociation({ ...assoc.request, issuerSignature: '0xabcd' });
    const da = decodeFunctionData({ abi: ATTESTATION_REGISTRY_ABI, data: assocCalldata });
    expect(da.functionName).toBe('assertAssociation');
    const ra = (da.args ?? [])[0] as { subject: string; issuer: string; credentialHash: string };
    expect(ra.subject.toLowerCase()).toBe(org.address.toLowerCase());
    expect(ra.credentialHash).toBe(credentialHash(assoc.credential));

    const jointCalldata = encodeAssertJointAgreement({
      schemaId: ('0x' + '11'.repeat(32)) as Hex32,
      credentialType: ('0x' + '22'.repeat(32)) as Hex32,
      credentialHash: ('0x' + '33'.repeat(32)) as Hex32,
      refUID: ('0x' + '44'.repeat(32)) as Hex32,
      bilateralConsentRef: ('0x' + '55'.repeat(32)) as Hex32,
      offchainCredentialStatusList: ('0x' + '00'.repeat(32)) as Hex32,
      party1: org.address,
      party2: jp.saAddress,
      issuer: jp.saAddress,
      issuerSignature: '0xdead',
      salt: 7n,
    });
    const dj = decodeFunctionData({ abi: ATTESTATION_REGISTRY_ABI, data: jointCalldata });
    expect(dj.functionName).toBe('assertJointAgreement');
    const rj = (dj.args ?? [])[0] as { party1: string; party2: string; refUID: string };
    expect(rj.party1.toLowerCase()).toBe(org.address.toLowerCase());
    expect(rj.refUID).toBe('0x' + '44'.repeat(32));
  });
});
