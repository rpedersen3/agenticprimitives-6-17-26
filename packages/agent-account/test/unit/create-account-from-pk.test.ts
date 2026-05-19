/**
 * createAccountFromPrivateKey — bootstrap-relayer deploy path.
 *
 * Mocks viem so this runs without a real RPC. The system layer (Anvil
 * + e2e Playwright tests) exercises the live broadcast path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentAccountClient } from '../../src/client';

const FACTORY = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0' as const;
const ENTRY_POINT = '0x5FbDB2315678afecb367f032d93F642f64180aa3' as const;
const OWNER = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' as const;
const PREDICTED = '0x1234567890123456789012345678901234567890' as const;
const BOOTSTRAP_PK = ('0x' + '11'.repeat(32)) as `0x${string}`;
const BOOTSTRAP_ADDR = '0x19E7E376E7C213B7E7e7e46cc70A5dd086DAff2a' as const;
const TX_HASH = '0xfeedface' as const;

const fakePublicClient = {
  getCode: vi.fn(async () => '0x' as `0x${string}`),
  waitForTransactionReceipt: vi.fn(async () => ({ status: 'success' })),
};

const writeContract = vi.fn(async () => TX_HASH);

const fakeWalletClient = { writeContract };

vi.mock('viem', async (importOriginal) => {
  const real = await importOriginal<typeof import('viem')>();
  return {
    ...real,
    createPublicClient: vi.fn(() => fakePublicClient),
    createWalletClient: vi.fn(() => fakeWalletClient),
    getContract: vi.fn(() => ({
      read: {
        getAddress: vi.fn(async () => PREDICTED),
      },
    })),
    http: vi.fn(() => ({})),
  };
});

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn(() => ({ address: BOOTSTRAP_ADDR })),
}));

describe('AgentAccountClient.createAccountFromPrivateKey', () => {
  let client: AgentAccountClient;
  beforeEach(() => {
    client = new AgentAccountClient({
      rpcUrl: 'http://127.0.0.1:8545',
      chainId: 31337,
      entryPoint: ENTRY_POINT,
      factory: FACTORY,
    });
    fakePublicClient.getCode.mockReset();
    fakePublicClient.waitForTransactionReceipt.mockReset();
    fakePublicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });
    writeContract.mockReset();
    writeContract.mockResolvedValue(TX_HASH);
  });

  it('skips the tx when the account is already deployed (idempotent)', async () => {
    fakePublicClient.getCode.mockResolvedValueOnce('0x6080604052' as `0x${string}`);
    const addr = await client.createAccountFromPrivateKey(OWNER, 0n, BOOTSTRAP_PK);
    expect(addr).toBe(PREDICTED);
    expect(writeContract).not.toHaveBeenCalled();
    expect(fakePublicClient.waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it('broadcasts factory.createAccount when undeployed', async () => {
    fakePublicClient.getCode.mockResolvedValueOnce('0x' as `0x${string}`);
    const addr = await client.createAccountFromPrivateKey(OWNER, 42n, BOOTSTRAP_PK);
    expect(addr).toBe(PREDICTED);
    expect(writeContract).toHaveBeenCalledOnce();
    const call = writeContract.mock.calls[0]![0] as {
      address: string;
      functionName: string;
      args: unknown[];
      account: { address: string };
    };
    expect(call.address).toBe(FACTORY);
    expect(call.functionName).toBe('createAccount');
    expect(call.args).toEqual([OWNER, 42n]);
    expect(call.account.address).toBe(BOOTSTRAP_ADDR);
  });

  it('waits for receipt before returning', async () => {
    fakePublicClient.getCode.mockResolvedValueOnce('0x' as `0x${string}`);
    await client.createAccountFromPrivateKey(OWNER, 0n, BOOTSTRAP_PK);
    expect(fakePublicClient.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: TX_HASH });
  });
});
