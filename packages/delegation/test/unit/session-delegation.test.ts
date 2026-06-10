import { describe, it, expect } from 'vitest';
import { buildSessionDelegation, hashDelegation, ROOT_AUTHORITY } from '../../src/index';

const MEMBER = '0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0' as const;
const SESSION = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' as const;
const TS = '0x1111111111111111111111111111111111111111' as const;
const VAL = '0x2222222222222222222222222222222222222222' as const;
const DM = '0x3333333333333333333333333333333333333333' as const;

const params = (salt?: bigint) => ({
  delegator: MEMBER,
  sessionKeyAddress: SESSION,
  validUntil: 9_999_999_999,
  enforcers: { timestamp: TS, value: VAL },
  chainId: 84532,
  delegationManager: DM,
  salt,
});

describe('buildSessionDelegation (spec 270 v4 W2)', () => {
  it('binds delegator=principal SA, delegate=session key, with TTL + value-0 caveats; digest is canonical', () => {
    const { leaf, digest } = buildSessionDelegation(params(7n));
    expect(leaf.delegator).toBe(MEMBER); // v4 — bound to the principal SA (the canonical identity), not the delegate
    expect(leaf.delegate).toBe(SESSION);
    expect(leaf.authority).toBe(ROOT_AUTHORITY);
    expect(leaf.caveats).toHaveLength(2);
    expect(leaf.caveats[0]!.enforcer).toBe(TS); // timestamp (TTL)
    expect(leaf.caveats[1]!.enforcer).toBe(VAL); // value 0
    expect(leaf.salt).toBe(7n);
    expect(leaf.signature).toBe('0x'); // UNSIGNED — caller signs `digest` with the live credential
    expect(digest).toBe(hashDelegation(leaf, 84532, DM));
  });

  it('uses a random salt when omitted (two builds differ)', () => {
    const a = buildSessionDelegation(params());
    const b = buildSessionDelegation(params());
    expect(a.leaf.salt).not.toBe(b.leaf.salt);
    expect(a.digest).not.toBe(b.digest);
  });
});
