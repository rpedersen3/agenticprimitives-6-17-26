import { describe, it, expect } from 'vitest';
import { agentAccountFactoryAbi, agentAccountAbi, ERC1271_MAGIC_VALUE } from '../../src/abis';

describe('abis', () => {
  it('exposes createPersonAgent on the factory', () => {
    const fn = agentAccountFactoryAbi.find((e) => e.type === 'function' && e.name === 'createPersonAgent');
    expect(fn).toBeDefined();
    expect(fn!.stateMutability).toBe('nonpayable');
    // (externalCustodians[], credentialIdDigest, x, y, salt)
    expect(fn!.inputs).toHaveLength(5);
    expect(fn!.inputs[0]?.type).toBe('address[]');
    expect(fn!.inputs[1]?.type).toBe('bytes32');
    expect(fn!.inputs[4]?.type).toBe('uint256');
  });

  it('exposes getAddressForPersonAgent as a view', () => {
    const fn = agentAccountFactoryAbi.find((e) => e.type === 'function' && e.name === 'getAddressForPersonAgent');
    expect(fn).toBeDefined();
    expect(fn!.stateMutability).toBe('view');
  });

  it('exposes createMultiSigSmartAgent on the factory', () => {
    const fn = agentAccountFactoryAbi.find((e) => e.type === 'function' && e.name === 'createMultiSigSmartAgent');
    expect(fn).toBeDefined();
    expect(fn!.stateMutability).toBe('nonpayable');
  });

  it('exposes getAddressForMultiSigSmartAgent as a view', () => {
    const fn = agentAccountFactoryAbi.find((e) => e.type === 'function' && e.name === 'getAddressForMultiSigSmartAgent');
    expect(fn).toBeDefined();
    expect(fn!.stateMutability).toBe('view');
  });

  it('does NOT expose any of the deleted legacy entries', () => {
    const deleted = [
      'getAddress',
      'createAccount',
      'createAccountWithMode',
      'createAccountWithModeCustomSafetyDelay',
      'createAccountWithPasskey',
      'getAddressForPasskey',
      'getAddressForMode',
    ];
    for (const name of deleted) {
      const found = agentAccountFactoryAbi.find(
        (e) => e.type === 'function' && e.name === name,
      );
      expect(found, `${name} should be removed from factory ABI`).toBeUndefined();
    }
  });

  it('exposes passkey-direct custody surface on the account', () => {
    expect(agentAccountAbi.find((e) => e.type === 'function' && e.name === 'passkeyIdentity')).toBeDefined();
    expect(agentAccountAbi.find((e) => e.type === 'function' && e.name === 'addPasskey')).toBeDefined();
    expect(agentAccountAbi.find((e) => e.type === 'function' && e.name === 'removePasskey')).toBeDefined();
    expect(agentAccountAbi.find((e) => e.type === 'function' && e.name === 'isCustodian')).toBeDefined();
    expect(agentAccountAbi.find((e) => e.type === 'function' && e.name === 'custodianCount')).toBeDefined();
  });

  it('exposes the ERC-165 marker for IAgenticPrimitivesAgentAccount', () => {
    const fn = agentAccountAbi.find(
      (e) => e.type === 'function' && e.name === 'isAgenticPrimitivesAgentAccount',
    );
    expect(fn).toBeDefined();
    expect(fn!.stateMutability).toBe('pure');
  });

  it('exposes isValidSignature(bytes32,bytes) view on the account', () => {
    const fn = agentAccountAbi.find((e) => e.type === 'function' && e.name === 'isValidSignature');
    expect(fn).toBeDefined();
    expect(fn!.stateMutability).toBe('view');
  });

  it('ERC1271_MAGIC_VALUE is the spec value 0x1626ba7e', () => {
    expect(ERC1271_MAGIC_VALUE).toBe('0x1626ba7e');
  });
});
