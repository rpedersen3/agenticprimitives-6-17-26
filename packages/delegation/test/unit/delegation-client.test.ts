import { describe, it, expect, vi } from 'vitest';
import { DelegationClient } from '../../src/client';
import { buildCaveat, encodeTimestampTerms } from '../../src/caveats';
import { ROOT_AUTHORITY } from '../../src/types';

const SMART_ACCOUNT = '0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0' as const;
const DELEGATION_MANAGER = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' as const;
const DELEGATE = '0x9876543210987654321098765432109876543210' as const;
const TIMESTAMP_ENFORCER = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9' as const;

describe('DelegationClient.issueDelegation', () => {
  it('builds a Delegation, signs via signer, returns the struct', async () => {
    const signer = {
      address: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const,
      signTypedData: vi.fn().mockResolvedValue('0xabc123'),
    };
    const client = new DelegationClient({
      signer,
      smartAccount: SMART_ACCOUNT,
      chainId: 31337,
      delegationManager: DELEGATION_MANAGER,
    });

    const caveats = [buildCaveat(TIMESTAMP_ENFORCER, encodeTimestampTerms(100, 200))];
    const d = await client.issueDelegation({ delegate: DELEGATE, caveats, salt: 42n });

    expect(d.delegator).toBe(SMART_ACCOUNT);
    expect(d.delegate).toBe(DELEGATE);
    expect(d.authority).toBe(ROOT_AUTHORITY);
    expect(d.salt).toBe(42n);
    expect(d.signature).toBe('0xabc123');
    expect(d.caveats).toHaveLength(1);
    expect(signer.signTypedData).toHaveBeenCalledOnce();

    // Inspect the typed-data call to confirm the EIP-712 shape.
    const call = signer.signTypedData.mock.calls[0]![0];
    expect(call.domain.name).toBe('AgentDelegationManager');
    expect(call.domain.version).toBe('1');
    expect(call.domain.chainId).toBe(31337);
    expect(call.domain.verifyingContract).toBe(DELEGATION_MANAGER);
    expect(call.primaryType).toBe('Delegation');
    expect(call.message.delegator).toBe(SMART_ACCOUNT);
    expect(call.message.delegate).toBe(DELEGATE);
  });

  it('generates a random salt when none supplied', async () => {
    const signer = {
      address: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const,
      signTypedData: vi.fn().mockResolvedValue('0xfff'),
    };
    const client = new DelegationClient({
      signer,
      smartAccount: SMART_ACCOUNT,
      chainId: 31337,
      delegationManager: DELEGATION_MANAGER,
    });
    const a = await client.issueDelegation({ delegate: DELEGATE, caveats: [] });
    const b = await client.issueDelegation({ delegate: DELEGATE, caveats: [] });
    expect(a.salt).not.toBe(b.salt);
  });

  it('H7-D / PKG-delegation-004 closure: EIP-712 Caveat type EXCLUDES `args` (audit F-1)', async () => {
    // `args` is the redeemer-supplied runtime data. It MUST NOT appear in the
    // signed typed-data message because (a) on-chain CAVEAT_TYPEHASH is
    // keccak256("Caveat(address enforcer,bytes terms)") — args excluded;
    // (b) including args would let the redeemer's chosen args ride inside
    // the delegator's signature. (audit F-1)
    const signer = {
      address: '0xaaaa' as const,
      signTypedData: vi.fn().mockResolvedValue('0xfff'),
    };
    const client = new DelegationClient({
      signer,
      smartAccount: SMART_ACCOUNT,
      chainId: 31337,
      delegationManager: DELEGATION_MANAGER,
    });
    await client.issueDelegation({
      delegate: DELEGATE,
      caveats: [buildCaveat(TIMESTAMP_ENFORCER, encodeTimestampTerms(1, 2))],
      salt: 1n,
    });
    const callArg = signer.signTypedData.mock.calls[0]![0];
    // The Caveat EIP-712 type lists `enforcer` + `terms` only.
    expect(callArg.types.Caveat).toEqual([
      { name: 'enforcer', type: 'address' },
      { name: 'terms', type: 'bytes' },
    ]);
    // The signed message's caveat carries enforcer + terms; args is absent.
    const sentCaveat = callArg.message.caveats[0];
    expect(sentCaveat.enforcer).toBe(TIMESTAMP_ENFORCER);
    expect(sentCaveat.terms).toBeDefined();
    expect(sentCaveat.args).toBeUndefined();
  });
});
