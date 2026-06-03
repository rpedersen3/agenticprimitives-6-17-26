import { describe, expect, it } from 'vitest';
import {
  buildRelatedAgentCredential,
  relatedAgentProofHash,
  relatedAgentReadCaveats,
  RELATED_AGENT_DESCRIPTION,
} from '../../src/index.js';
import { credentialHash } from '@agenticprimitives/verifiable-credentials';

const PERSON = '0x1111111111111111111111111111111111111111' as const;
const ORG = '0x2222222222222222222222222222222222222222' as const;
const TS = '0x3333333333333333333333333333333333333333' as const;
const VAL = '0x4444444444444444444444444444444444444444' as const;
const TGT = '0x5555555555555555555555555555555555555555' as const;

function build(extra?: Partial<Parameters<typeof buildRelatedAgentCredential>[0]>) {
  return buildRelatedAgentCredential({
    holder: PERSON,
    relatedAgent: ORG,
    purpose: 'jp-adopter-org',
    requestedBy: 'demo-jp',
    issuerCaip10: `eip155:84532:${PERSON}`,
    body: { agentName: 'grace-community.impact' },
    validFrom: '2026-06-02T00:00:00Z',
    ...extra,
  });
}

describe('buildRelatedAgentCredential', () => {
  it('is self-issued (holder == issuer role) + private by default', () => {
    const c = build();
    expect(c.credentialSubject.description).toBe(RELATED_AGENT_DESCRIPTION);
    expect(c.credentialSubject.roles.holder).toBe(PERSON);
    expect(c.credentialSubject.roles.issuer).toBe(PERSON);
    expect(c.credentialSubject.roles.relatedAgent).toBe(ORG);
    expect(c.credentialSubject.participants?.visibility).toBe('private');
    expect(c.credentialSubject.participants?.purpose).toBe('jp-adopter-org');
    expect(c.credentialSubject.participants?.requestedBy).toBe('demo-jp');
    expect(c.type).toContain('RelatedAgentCredential');
  });

  it('carries the related-agent name in the body, NOT a person→org graph claim', () => {
    const c = build({ body: { agentName: 'frontier-path.impact', agentKind: 'facilitator' } });
    expect(c.credentialSubject.body.payload.agentName).toBe('frontier-path.impact');
    expect(c.credentialSubject.body.payload.agentKind).toBe('facilitator');
  });

  it('proofHash is deterministic + equals the VC credentialHash', () => {
    const c = build();
    expect(relatedAgentProofHash(c)).toBe(credentialHash(c));
    expect(relatedAgentProofHash(build())).toBe(relatedAgentProofHash(build()));
  });

  it('honours an explicit visibility override', () => {
    const c = build({ visibility: 'public' });
    expect(c.credentialSubject.participants?.visibility).toBe('public');
  });
});

describe('relatedAgentReadCaveats', () => {
  it('builds a time-bounded, zero-value, target-scoped caveat set (3 caveats)', () => {
    const caveats = relatedAgentReadCaveats({
      enforcers: { timestamp: TS, value: VAL, allowedTargets: TGT },
      validUntil: 2_000_000_000,
      allowedTargets: [ORG],
    });
    expect(caveats).toHaveLength(3);
    expect(caveats[0]?.enforcer).toBe(TS);
    expect(caveats[1]?.enforcer).toBe(VAL);
    expect(caveats[2]?.enforcer).toBe(TGT);
    for (const c of caveats) expect(c.terms).toMatch(/^0x[0-9a-f]+$/);
  });
});
