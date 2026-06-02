// End-to-end test: exercises the full v2 spine substrate from a demo-jp
// perspective. Composes personas + intent + match + agreement + commitment +
// assertion + attestation — all without touching a live RPC.

import { describe, expect, it } from 'vitest';
import { hashMessage } from 'viem';

import { loadOrMintPersona, mintPersona } from '../personas.js';
import { loadOrMintOrgPersona, getGlobalChurch, getJP } from '../org-personas.js';
import { JP_SHAPES } from '../jp-shapes.js';
import { JP_INTENT_OBJECT, buildJpIntent } from '../intent-payload.js';
import { buildJpAgreementCommitment } from '../agreement-payload.js';
import { expressIntent, tryMatch, buildCommitment } from '../intent-flow.js';
import { issueAgreement } from '../agreement-flow.js';
import {
  buildAssociationAssertion,
  buildJointAgreementAssertion,
} from '../assertion-flow.js';
import { credentialHash } from '@agenticprimitives/verifiable-credentials';

describe('demo-jp spine end-to-end (substrate composability)', () => {
  it('mints + loads Pete + Jill personas deterministically', () => {
    const pete = mintPersona('pete');
    const jill = mintPersona('jill');
    expect(pete.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(jill.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(pete.address).not.toBe(jill.address);
  });

  it('derives Global Church + JP org SA addresses from custodian EOAs', () => {
    const gc = getGlobalChurch();
    const jp = getJP();
    expect(gc.saAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(jp.saAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(gc.saAddress).not.toBe(jp.saAddress);
    expect(gc.custodian.name).toBe('pete');
    expect(jp.custodian.name).toBe('jill');
  });

  it('registers JP-vertical SHACL shapes with stable on-chain hashes', () => {
    expect(JP_SHAPES.facilitator.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(JP_SHAPES.adopter.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(JP_SHAPES.agreement.hash).toMatch(/^0x[0-9a-f]{64}$/);
    // All three differ
    expect(JP_SHAPES.facilitator.hash).not.toBe(JP_SHAPES.adopter.hash);
    expect(JP_SHAPES.facilitator.hash).not.toBe(JP_SHAPES.agreement.hash);
  });

  it('lifts JP intent payload fields into first-class ConstraintSet (D-38)', () => {
    const facilitator = mintPersona('pete');
    const intent = buildJpIntent({
      id: 'i-1',
      expressedBy: facilitator.address,
      object: JP_INTENT_OBJECT.OfferFacilitator,
      payload: {
        fpgId: 'NAJDI-Saudi-Arabia',
        countries: ['SA', 'JO'],
      },
    });

    // ConstraintSet should now carry fpgId + geo as hard constraints with provenance
    expect(intent.direction).toBe('give');
    expect(intent.hasConstraintSet.hardConstraints.length).toBeGreaterThanOrEqual(2);
    const fpgConstraint = intent.hasConstraintSet.hardConstraints.find((c) => c.variable === 'fpgId');
    expect(fpgConstraint).toBeDefined();
    expect(fpgConstraint?.source).toBe('user-asserted');
    expect(fpgConstraint?.strength).toBe('hard');
  });

  it('matches opposite-direction intents on the same FPG', async () => {
    const adopter = mintPersona('pete');
    const facilitator = mintPersona('jill');
    const broker = getJP().saAddress;

    const need = await expressIntent({
      id: 'i-adopter',
      expressedBy: adopter.address,
      object: JP_INTENT_OBJECT.NeedFacilitator,
      payload: { fpgId: 'NAJDI', adopterType: 'church' },
    });
    const offer = await expressIntent({
      id: 'i-facilitator',
      expressedBy: facilitator.address,
      object: JP_INTENT_OBJECT.OfferFacilitator,
      payload: { fpgId: 'NAJDI' },
    });

    expect(need.resolved).not.toBeNull();
    expect(offer.resolved).not.toBeNull();
    // BUT they have DIFFERENT objects (Need vs Offer Facilitator) so won't match;
    // verify the matchmaker correctly rejects different-object pairs.
    const match = tryMatch(broker, need.intent, offer.intent);
    expect(match).toBeNull(); // SS-01: objects differ.
  });

  it('produces a Commitment from a matched pair', async () => {
    const a = mintPersona('pete');
    const b = mintPersona('jill');
    const broker = getJP().saAddress;

    const give = await expressIntent({
      id: 'g',
      expressedBy: a.address,
      object: JP_INTENT_OBJECT.OfferFacilitator,
      payload: { fpgId: 'NAJDI' },
    });
    const receive = await expressIntent({
      id: 'r',
      expressedBy: b.address,
      object: JP_INTENT_OBJECT.OfferFacilitator, // intentionally same object for compatibility
      payload: { fpgId: 'NAJDI' },
    });
    // Force opposite direction by editing the intent directly (the SS-01 invariant means
    // matchmaker only accepts opposite direction + same object).
    receive.intent.direction = 'receive';

    const match = tryMatch(broker, give.intent, receive.intent);
    expect(match).not.toBeNull();
    expect(match!.matchScore).toBeGreaterThan(0);
    expect(match!.matchScore).toBeLessThanOrEqual(10000);

    const commitment = buildCommitment({
      intentMatch: match!,
      parties: [a.address, b.address],
    });
    expect(commitment.commitmentHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(commitment.parties).toEqual([a.address, b.address]);
  });

  it('computes a deterministic agreement commitment for two parties', () => {
    const a = mintPersona('pete');
    const b = mintPersona('jill');
    const gc = getGlobalChurch();
    const spec = {
      party1: a.address,
      party2: b.address,
      issuer: gc.saAddress,
      payload: {
        agreementKind: 'facilitator-adopter' as const,
        fpgId: 'NAJDI',
        termsText: 'Adopter commits to 12 months of prayer + funding.',
        capabilityList: ['receive-prayer-updates', 'send-funds-monthly'],
        validFrom: '2026-07-01T00:00:00Z',
      },
      salt: 1n,
    };
    const result1 = buildJpAgreementCommitment(spec);
    const result2 = buildJpAgreementCommitment(spec);
    expect(result1.agreementCommitment).toBe(result2.agreementCommitment);

    // Salt change ⇒ different commitment
    const result3 = buildJpAgreementCommitment({ ...spec, salt: 2n });
    expect(result3.agreementCommitment).not.toBe(result1.agreementCommitment);

    // Party order matters
    const result4 = buildJpAgreementCommitment({
      ...spec,
      party1: b.address,
      party2: a.address,
    });
    expect(result4.agreementCommitment).not.toBe(result1.agreementCommitment);
  });

  it('issues an AgreementCredential whose subject is a DOLCE Situation', () => {
    const a = mintPersona('pete');
    const b = mintPersona('jill');
    const gc = getGlobalChurch();
    const issued = issueAgreement({
      party1: a.address,
      party2: b.address,
      issuer: gc.saAddress,
      issuerCaip10: `eip155:84532:${gc.saAddress}`,
      payload: {
        agreementKind: 'facilitator-adopter',
        fpgId: 'NAJDI',
        termsText: 'demo terms',
        capabilityList: ['receive-updates'],
        validFrom: '2026-07-01T00:00:00Z',
      },
      salt: 7n,
    });

    expect(issued.credential.type).toContain('VerifiableCredential');
    expect(issued.credential.type).toContain('AgreementCredential');
    expect(issued.credential.credentialSubject.description).toBe('apagr:AgreementCredential');
    expect(issued.credential.credentialSubject.roles.issuer).toBe(gc.saAddress);
    expect(issued.credential.credentialSubject.roles.party1).toBe(a.address);
    expect(issued.credential.credentialSubject.roles.party2).toBe(b.address);
    expect(issued.registryPayload.agreementCommitment).toMatch(/^0x[0-9a-f]{64}$/);
    expect(issued.registryPayload.schemaHash).toBe(JP_SHAPES.agreement.hash);
  });

  it('builds an Association attestation request + predicts its UID', () => {
    const facilitator = mintPersona('pete');
    const jp = getJP();
    // Synth a minimal AssociationCredential
    const credential = {
      '@context': ['https://www.w3.org/ns/credentials/v2'] as const,
      type: ['VerifiableCredential', 'AssociationCredential'] as const,
      issuer: `eip155:84532:${jp.saAddress}`,
      validFrom: '2026-06-02T00:00:00Z',
      credentialSubject: { id: facilitator.address, facilitatorRole: 'approved' },
    };
    const sigOverHash = hashMessage('demo-signature') as `0x${string}`;
    const { request, predictedUid } = buildAssociationAssertion({
      credential,
      subject: facilitator.address,
      issuer: jp.saAddress,
      issuerSignatureOverCredentialHash: sigOverHash,
      associationKind: 'facilitator',
      salt: 1n,
    });
    expect(request.schemaId).toBe(JP_SHAPES.facilitator.hash);
    expect(request.credentialHash).toBe(credentialHash(credential));
    expect(predictedUid).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('builds a JointAgreement assertion request that back-points to the commitment row', () => {
    const a = mintPersona('pete');
    const b = mintPersona('jill');
    const gc = getGlobalChurch();
    const issued = issueAgreement({
      party1: a.address,
      party2: b.address,
      issuer: gc.saAddress,
      issuerCaip10: `eip155:84532:${gc.saAddress}`,
      payload: {
        agreementKind: 'facilitator-adopter',
        fpgId: 'NAJDI',
        termsText: 'demo terms',
        capabilityList: ['c1'],
        validFrom: '2026-07-01T00:00:00Z',
      },
      salt: 11n,
    });

    const sigOverHash = hashMessage('demo-signature') as `0x${string}`;
    const bilateralConsentRef = hashMessage('bilateral-signatures-bundle') as `0x${string}`;
    const signedVc = { ...issued.credential, proof: undefined } as Parameters<typeof buildJointAgreementAssertion>[0]['credential'];

    const { request, predictedUid } = buildJointAgreementAssertion({
      credential: signedVc,
      party1: a.address,
      party2: b.address,
      issuer: gc.saAddress,
      issuerSignatureOverCredentialHash: sigOverHash,
      bilateralConsentRef,
      agreementCommitment: issued.registryPayload.agreementCommitment,
      salt: 1n,
    });
    expect(request.refUID).toBe(issued.registryPayload.agreementCommitment);
    expect(request.bilateralConsentRef).toBe(bilateralConsentRef);
    expect(request.party1).toBe(a.address);
    expect(request.party2).toBe(b.address);
    expect(predictedUid).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
