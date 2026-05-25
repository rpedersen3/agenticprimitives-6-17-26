// EIP-712 typed-data shape golden test (audit P2-2).
//
// Custody EIP-712 hashes MUST match what `CustodyPolicy.sol` computes
// on chain. Any drift in field order, type name, or domain name silently
// produces a hash that fails the on-chain verifier — schedule + apply
// ceremonies reject with `AdminUnauthorizedSigner` for an opaque reason.
// Locking the shapes here catches the most common refactor regressions.

import { describe, it, expect } from 'vitest';
import { hashTypedData } from 'viem';
import {
  CUSTODY_DOMAIN_NAME,
  CUSTODY_DOMAIN_VERSION,
  ScheduleCustodyChangeRequest,
  ApplyCustodyChangeRequest,
  CancelScheduledChangeRequest,
  custodyDomain,
} from '../src';

const CHAIN_ID = 84532;
const VERIFYING_CONTRACT = '0x11c89b42513caf67f6ed7e3d14088e2e744b7532';

describe('custody domain', () => {
  it('domain name + version are wire-locked', () => {
    // Changing either is a domain-separator break — every signed
    // delegation in flight against this verifying contract becomes
    // un-redeemable. Treat these as immutable once deployed.
    expect(CUSTODY_DOMAIN_NAME).toBe('agenticprimitives.CustodyPolicy');
    expect(CUSTODY_DOMAIN_VERSION).toBe('1');
  });

  it('custodyDomain returns the canonical shape', () => {
    const d = custodyDomain({ chainId: CHAIN_ID, verifyingContract: VERIFYING_CONTRACT });
    expect(d).toEqual({
      name: 'agenticprimitives.CustodyPolicy',
      version: '1',
      chainId: CHAIN_ID,
      verifyingContract: VERIFYING_CONTRACT,
    });
  });
});

describe('ScheduleCustodyChangeRequest typed-data', () => {
  it('field order is wire-locked (matches Solidity)', () => {
    expect(ScheduleCustodyChangeRequest).toEqual({
      ScheduleCustodyChangeRequest: [
        { name: 'account', type: 'address' },
        { name: 'action', type: 'uint8' },
        { name: 'argsHash', type: 'bytes32' },
        { name: 'changeId', type: 'uint256' },
      ],
    });
  });

  it('golden hash matches a fixed input (regression lock)', () => {
    const got = hashTypedData({
      domain: custodyDomain({ chainId: CHAIN_ID, verifyingContract: VERIFYING_CONTRACT }),
      types: ScheduleCustodyChangeRequest,
      primaryType: 'ScheduleCustodyChangeRequest',
      message: {
        account: '0x02a57f9bb19d09d8d824a7bb6f56a711320524ae',
        action: 2,
        argsHash: '0xc9e991f5f72a8e2bb2063259b4affba4bff1374801921f740ded90f428969771',
        changeId: 1n,
      },
    });
    // If THIS line ever fails, the EIP-712 domain or field-order
    // changed; every existing scheduled change is invalidated. Treat
    // as a deploy-blocking incident.
    expect(got).toMatchInlineSnapshot(
      `"0x88a79b8c69f71e075eb3d0a06d760fc56897c626ed77905d20abed751356f8ed"`,
    );
  });
});

describe('ApplyCustodyChangeRequest typed-data', () => {
  it('field order is wire-locked', () => {
    expect(ApplyCustodyChangeRequest).toEqual({
      ApplyCustodyChangeRequest: [
        { name: 'account', type: 'address' },
        { name: 'action', type: 'uint8' },
        { name: 'argsHash', type: 'bytes32' },
        { name: 'changeId', type: 'uint256' },
        { name: 'eta', type: 'uint64' },
      ],
    });
  });

  it('eta is the 5th field — order regression lock', () => {
    // I personally introduced an eta=0 regression earlier in this
    // demo's life by reading the wrong field index from a tuple
    // return; this test pins the on-the-wire position.
    expect(ApplyCustodyChangeRequest.ApplyCustodyChangeRequest[4]).toEqual({
      name: 'eta',
      type: 'uint64',
    });
  });
});

describe('CancelScheduledChangeRequest typed-data', () => {
  it('matches apply shape (same fields, different primaryType)', () => {
    expect(CancelScheduledChangeRequest).toEqual({
      CancelScheduledChangeRequest: [
        { name: 'account', type: 'address' },
        { name: 'action', type: 'uint8' },
        { name: 'argsHash', type: 'bytes32' },
        { name: 'changeId', type: 'uint256' },
        { name: 'eta', type: 'uint64' },
      ],
    });
  });
});
