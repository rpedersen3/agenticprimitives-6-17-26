import { describe, it, expect } from 'vitest';
import { agentAccountFactoryAbi, agentAccountAbi, ERC1271_MAGIC_VALUE } from '../../src/abis';

describe('abis', () => {
  it('exposes createAgentAccount on the factory', () => {
    const fn = agentAccountFactoryAbi.find((e) => e.type === 'function' && e.name === 'createAgentAccount');
    expect(fn).toBeDefined();
    expect(fn!.stateMutability).toBe('nonpayable');
    // H7-D / PKG-agent-account-004 closure — current ABI shape is
    // (initParams tuple, timelockOverrides uint32[7], salt). The [7]
    // overrides hold one entry per CustodyTier (T1..T7). Test fixture was
    // stale from a pre-spec-209 single-scalar timelock world.
    expect(fn!.inputs).toHaveLength(3);
    expect(fn!.inputs[0]?.type).toBe('tuple');
    expect(fn!.inputs[1]?.type).toBe('uint32[7]');
    expect(fn!.inputs[2]?.type).toBe('uint256');
  });

  it('exposes getAddressForAgentAccount as a view', () => {
    const fn = agentAccountFactoryAbi.find((e) => e.type === 'function' && e.name === 'getAddressForAgentAccount');
    expect(fn).toBeDefined();
    expect(fn!.stateMutability).toBe('view');
    // CA-F1: (params, timelockOverrides, salt) — the address commits to custody config.
    expect(fn!.inputs).toHaveLength(3);
    expect(fn!.inputs[0]?.type).toBe('tuple');
    expect(fn!.inputs[1]?.type).toBe('uint32[7]');
    expect(fn!.inputs[2]?.type).toBe('uint256');
  });

  it('exposes custodyPolicy view (factory-immutable validator address)', () => {
    const fn = agentAccountFactoryAbi.find((e) => e.type === 'function' && e.name === 'custodyPolicy');
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
      'createPersonAgent',
      'getAddressForPersonAgent',
      'createMultiSigSmartAgent',
      'getAddressForMultiSigSmartAgent',
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
