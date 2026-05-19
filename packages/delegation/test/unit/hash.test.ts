import { describe, it, expect } from 'vitest';
import { hashDelegation, hashCaveats, delegationDomain } from '../../src/hash';
import { ROOT_AUTHORITY } from '../../src/types';
import { buildCaveat, encodeTimestampTerms } from '../../src/caveats';
import type { Delegation } from '../../src/types';

const DELEGATION_MANAGER = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' as const;
const CHAIN_ID = 31337;

const fixtureDelegation: Delegation = {
  delegator: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
  delegate: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  authority: ROOT_AUTHORITY,
  caveats: [buildCaveat('0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9', encodeTimestampTerms(1000, 2000))],
  salt: 42n,
  signature: '0x',
};

describe('hashDelegation', () => {
  it('produces a deterministic 32-byte hash', () => {
    const a = hashDelegation(fixtureDelegation, CHAIN_ID, DELEGATION_MANAGER);
    const b = hashDelegation(fixtureDelegation, CHAIN_ID, DELEGATION_MANAGER);
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('differs across chain IDs', () => {
    const a = hashDelegation(fixtureDelegation, 31337, DELEGATION_MANAGER);
    const b = hashDelegation(fixtureDelegation, 1, DELEGATION_MANAGER);
    expect(a).not.toBe(b);
  });

  it('differs across delegation managers', () => {
    const a = hashDelegation(fixtureDelegation, CHAIN_ID, DELEGATION_MANAGER);
    const b = hashDelegation(fixtureDelegation, CHAIN_ID, '0x1111111111111111111111111111111111111111');
    expect(a).not.toBe(b);
  });

  it('differs when any delegation field changes', () => {
    const base = hashDelegation(fixtureDelegation, CHAIN_ID, DELEGATION_MANAGER);
    const altered = hashDelegation(
      { ...fixtureDelegation, salt: 43n },
      CHAIN_ID,
      DELEGATION_MANAGER,
    );
    expect(base).not.toBe(altered);
  });

  it('treats missing args as "0x" — same hash as explicit "0x"', () => {
    const noArgs = hashDelegation(fixtureDelegation, CHAIN_ID, DELEGATION_MANAGER);
    const explicit = hashDelegation(
      {
        ...fixtureDelegation,
        caveats: fixtureDelegation.caveats.map((c) => ({ ...c, args: '0x' as const })),
      },
      CHAIN_ID,
      DELEGATION_MANAGER,
    );
    expect(noArgs).toBe(explicit);
  });
});

describe('hashCaveats', () => {
  it('produces 32-byte keccak256 of the ABI-encoded array', () => {
    const h = hashCaveats(fixtureDelegation.caveats);
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('differs for different caveat arrays', () => {
    const c1 = [buildCaveat('0x1111111111111111111111111111111111111111', '0xaa')];
    const c2 = [buildCaveat('0x2222222222222222222222222222222222222222', '0xaa')];
    expect(hashCaveats(c1)).not.toBe(hashCaveats(c2));
  });
});

describe('delegationDomain', () => {
  it('returns the canonical AgentDelegationManager domain', () => {
    const d = delegationDomain(CHAIN_ID, DELEGATION_MANAGER);
    expect(d.name).toBe('AgentDelegationManager');
    expect(d.version).toBe('1');
    expect(d.chainId).toBe(CHAIN_ID);
    expect(d.verifyingContract).toBe(DELEGATION_MANAGER);
  });
});
