/**
 * Unit tests for AgentAccountClient. We mock the RPC transport so these
 * run in <100ms with no chain. The system layer (separate test file,
 * runs against Anvil) exercises the real on-chain calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentAccountClient } from '../../src/client';

const FACTORY = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0' as const;
const ENTRY_POINT = '0x5FbDB2315678afecb367f032d93F642f64180aa3' as const;
const OWNER = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' as const;
const PREDICTED_ACCOUNT = '0x1234567890123456789012345678901234567890' as const;

// Mock viem at the module level so AgentAccountClient picks up our fake client.
vi.mock('viem', async (importOriginal) => {
  const real = await importOriginal<typeof import('viem')>();
  return {
    ...real,
    createPublicClient: vi.fn(() => fakePublicClient),
    createWalletClient: vi.fn(() => ({})),
    getContract: vi.fn(({ address }: { address: string }) => {
      if (address === FACTORY) {
        return {
          read: {
            getAddressForAgentAccount: vi.fn(async () => PREDICTED_ACCOUNT),
            accountImplementation: vi.fn(async () => '0xabc'),
          },
        };
      }
      return {
        read: {
          isValidSignature: vi.fn(async () => isValidSigMockReturn),
          isCustodian: vi.fn(async () => true),
        },
      };
    }),
    http: vi.fn(() => ({})),
  };
});

let isValidSigMockReturn = '0x1626ba7e';
const fakePublicClient = {
  getCode: vi.fn(async () => '0x'),
  waitForTransactionReceipt: vi.fn(async () => ({})),
};

describe('AgentAccountClient', () => {
  let client: AgentAccountClient;
  beforeEach(() => {
    client = new AgentAccountClient({
      rpcUrl: 'http://127.0.0.1:8545',
      chainId: 31337,
      entryPoint: ENTRY_POINT,
      factory: FACTORY,
    });
    isValidSigMockReturn = '0x1626ba7e';
  });

  it('getAddressForAgentAccount delegates to factory view (EOA-only spec)', async () => {
    const result = await client.getAddressForAgentAccount({
      custodians: [OWNER],
      salt: 0n,
    });
    expect(result).toBe(PREDICTED_ACCOUNT);
  });

  it('getAddressForAgentAccount works for the passkey-only spec', async () => {
    const result = await client.getAddressForAgentAccount({
      passkey: {
        credentialIdDigest: ('0x' + '00'.repeat(32)) as `0x${string}`,
        x: 1n,
        y: 2n,
      },
      salt: 0n,
    });
    expect(result).toBe(PREDICTED_ACCOUNT);
  });

  it('getAddressForAgentAccount works for mode>0 spec with trustees', async () => {
    const result = await client.getAddressForAgentAccount({
      mode: 1,
      custodians: [OWNER],
      trustees: [OWNER],
      salt: 7n,
    });
    expect(result).toBe(PREDICTED_ACCOUNT);
  });

  it('isDeployed returns false when code is empty', async () => {
    fakePublicClient.getCode.mockResolvedValueOnce('0x');
    expect(await client.isDeployed(PREDICTED_ACCOUNT)).toBe(false);
  });

  it('isDeployed returns false when code is undefined', async () => {
    fakePublicClient.getCode.mockResolvedValueOnce(undefined as unknown as `0x${string}`);
    expect(await client.isDeployed(PREDICTED_ACCOUNT)).toBe(false);
  });

  it('isDeployed returns true when bytecode is present', async () => {
    fakePublicClient.getCode.mockResolvedValueOnce('0x6080604052');
    expect(await client.isDeployed(PREDICTED_ACCOUNT)).toBe(true);
  });

  it('isValidSignature returns true when account returns ERC1271 magic value', async () => {
    isValidSigMockReturn = '0x1626ba7e';
    expect(await client.isValidSignature(PREDICTED_ACCOUNT, '0xabc' as `0x${string}`, '0xdef' as `0x${string}`)).toBe(true);
  });

  it('isValidSignature returns false on wrong magic value', async () => {
    isValidSigMockReturn = '0xffffffff';
    expect(await client.isValidSignature(PREDICTED_ACCOUNT, '0xabc' as `0x${string}`, '0xdef' as `0x${string}`)).toBe(false);
  });

  it('isCustodian returns false when account isn\'t deployed', async () => {
    fakePublicClient.getCode.mockResolvedValueOnce('0x');
    expect(await client.isCustodian(PREDICTED_ACCOUNT, OWNER)).toBe(false);
  });

  it('isCustodian queries the account when deployed', async () => {
    fakePublicClient.getCode.mockResolvedValueOnce('0x6080604052');
    expect(await client.isCustodian(PREDICTED_ACCOUNT, OWNER)).toBe(true);
  });

  it('signWithErc1271 delegates to the signer.signMessage with raw hash', async () => {
    const mockSigner = {
      address: OWNER,
      signMessage: vi.fn(async () => '0xdeadbeef'),
      signTypedData: vi.fn(),
    };
    const sig = await client.signWithErc1271(PREDICTED_ACCOUNT, '0xaaaa' as `0x${string}`, mockSigner);
    expect(sig).toBe('0xdeadbeef');
    expect(mockSigner.signMessage).toHaveBeenCalledWith({ raw: '0xaaaa' });
  });

  it('buildUserOp throws "not implemented" in v0', async () => {
    await expect(
      client.buildUserOp({ account: PREDICTED_ACCOUNT, calls: [], paymaster: '0x0000000000000000000000000000000000000000' }),
    ).rejects.toThrow(/not implemented in v0|at least one call required/);
  });
});
