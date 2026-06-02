import { describe, expect, it } from 'vitest';
import {
  PACKAGE_NAME,
  PACKAGE_STATUS,
  SPEC_REF,
  STATUS,
  computeAgreementCommitment,
  partySetCommitment,
  issuerCommitment,
  bytesCommitment,
  nullifierFor,
} from '../../src/index.js';

describe('agreements package identity', () => {
  it('exposes the spec ref + W1 status', () => {
    expect(PACKAGE_NAME).toBe('@agenticprimitives/agreements');
    expect(PACKAGE_STATUS).toBe('w1-foundational');
    expect(SPEC_REF).toContain('241-');
  });
});

describe('status discriminators', () => {
  it('match the Solidity STATUS_* contract constants', () => {
    expect(STATUS.NONE).toBe(0);
    expect(STATUS.ACTIVE).toBe(1);
    expect(STATUS.COMPLETED).toBe(2);
    expect(STATUS.DISPUTED).toBe(3);
    expect(STATUS.REVOKED).toBe(4);
  });
});

describe('commitment math', () => {
  it('partySetCommitment is order-sensitive', () => {
    const a = '0x1111111111111111111111111111111111111111' as const;
    const b = '0x2222222222222222222222222222222222222222' as const;
    expect(partySetCommitment(a, b)).not.toBe(partySetCommitment(b, a));
  });

  it('issuerCommitment is deterministic', () => {
    const i = '0x9999999999999999999999999999999999999999' as const;
    expect(issuerCommitment(i)).toBe(issuerCommitment(i));
  });

  it('bytesCommitment hashes consistently', () => {
    expect(bytesCommitment('terms')).toBe(bytesCommitment('terms'));
    expect(bytesCommitment('terms')).not.toBe(bytesCommitment('other'));
  });

  it('computeAgreementCommitment is deterministic', () => {
    const args = {
      partySetCommitment: ('0x' + 'aa'.repeat(32)) as `0x${string}`,
      issuerCommitment: ('0x' + 'bb'.repeat(32)) as `0x${string}`,
      termsCommitment: ('0x' + 'cc'.repeat(32)) as `0x${string}`,
      scheduleCommitment: ('0x' + 'dd'.repeat(32)) as `0x${string}`,
      salt: 1n,
    };
    expect(computeAgreementCommitment(args)).toBe(computeAgreementCommitment(args));
    expect(computeAgreementCommitment(args)).not.toBe(
      computeAgreementCommitment({ ...args, salt: 2n }),
    );
  });
});

describe('nullifier derivation', () => {
  it('changes per (commitment, status, party, secret) tuple', () => {
    const base = {
      agreementCommitment: ('0x' + 'aa'.repeat(32)) as `0x${string}`,
      toStatus: STATUS.COMPLETED,
      party: '0x1111111111111111111111111111111111111111' as const,
      secret: ('0x' + 'bb'.repeat(32)) as `0x${string}`,
    };
    const n = nullifierFor(base);
    expect(n).toBe(nullifierFor(base));
    expect(nullifierFor({ ...base, toStatus: STATUS.REVOKED })).not.toBe(n);
    expect(
      nullifierFor({ ...base, party: '0x2222222222222222222222222222222222222222' as const }),
    ).not.toBe(n);
  });
});
