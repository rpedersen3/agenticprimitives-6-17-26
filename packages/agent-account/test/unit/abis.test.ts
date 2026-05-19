import { describe, it, expect } from 'vitest';
import { agentAccountFactoryAbi, agentAccountAbi, ERC1271_MAGIC_VALUE } from '../../src/abis';

describe('abis', () => {
  it('exposes a getAddress(address,uint256) view on the factory', () => {
    const fn = agentAccountFactoryAbi.find((e) => e.type === 'function' && e.name === 'getAddress');
    expect(fn).toBeDefined();
    expect(fn!.stateMutability).toBe('view');
    expect(fn!.inputs).toHaveLength(2);
    expect(fn!.inputs[0]?.type).toBe('address');
    expect(fn!.inputs[1]?.type).toBe('uint256');
  });

  it('exposes a createAccount(address,uint256) non-payable on the factory', () => {
    const fn = agentAccountFactoryAbi.find((e) => e.type === 'function' && e.name === 'createAccount');
    expect(fn).toBeDefined();
    expect(fn!.stateMutability).toBe('nonpayable');
  });

  it('exposes isValidSignature(bytes32,bytes) view on the account', () => {
    const fn = agentAccountAbi.find((e) => e.type === 'function' && e.name === 'isValidSignature');
    expect(fn).toBeDefined();
    expect(fn!.stateMutability).toBe('view');
  });

  it('ERC1271_MAGIC_VALUE is the spec value 0x1626ba7e', () => {
    // EIP-1271: function magicvalue = bytes4(keccak256("isValidSignature(bytes32,bytes)"))
    expect(ERC1271_MAGIC_VALUE).toBe('0x1626ba7e');
  });
});
