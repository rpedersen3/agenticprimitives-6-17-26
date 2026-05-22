/**
 * Tests for AgentAccountClient.buildDeployUserOpForPersonAgent + submitDeployUserOp.
 * viem is mocked; covers the UserOp construction shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentAccountClient } from '../../src/client';

const FACTORY = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0' as const;
const ENTRY_POINT = '0xc3001F36478f50018C616eB808ab61874414e904' as const;
const PAYMASTER = '0x93B800CD7ACdcA13754624D4B1A2760A86bE0D1f' as const;
const OWNER = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' as const;
const PREDICTED = '0x1234567890123456789012345678901234567890' as const;
const BUNDLER_ADDR = '0xfeedfacefeedfacefeedfacefeedfacefeedface' as const;
const MOCK_USEROP_HASH = ('0x' + 'aa'.repeat(32)) as `0x${string}`;
const MOCK_TX_HASH = ('0x' + 'bb'.repeat(32)) as `0x${string}`;

const fakeReadContract = vi.fn();
const fakeGetBlock = vi.fn(async () => ({ baseFeePerGas: 10_000_000n }));
const fakeWriteContract = vi.fn();
const fakeWaitForReceipt = vi.fn();

vi.mock('viem', async (importOriginal) => {
  const real = await importOriginal<typeof import('viem')>();
  return {
    ...real,
    createPublicClient: vi.fn(() => ({
      readContract: fakeReadContract,
      getBlock: fakeGetBlock,
      waitForTransactionReceipt: fakeWaitForReceipt,
      getCode: vi.fn(async () => '0x'),
    })),
    createWalletClient: vi.fn(() => ({
      writeContract: fakeWriteContract,
    })),
    getContract: vi.fn(({ address }: { address: string }) => {
      if (address === FACTORY) {
        return {
          read: {
            getAddressForPersonAgent: vi.fn(async () => PREDICTED),
            getAddressForMultiSigSmartAgent: vi.fn(async () => PREDICTED),
          },
        };
      }
      return { read: {} };
    }),
    http: vi.fn(() => ({})),
  };
});

describe('AgentAccountClient.buildDeployUserOpForPersonAgent', () => {
  let client: AgentAccountClient;
  beforeEach(() => {
    fakeReadContract.mockReset();
    fakeReadContract.mockResolvedValue(MOCK_USEROP_HASH);
    fakeGetBlock.mockReset();
    fakeGetBlock.mockResolvedValue({ baseFeePerGas: 10_000_000n });
    client = new AgentAccountClient({
      rpcUrl: 'http://127.0.0.1:8545',
      chainId: 31337,
      entryPoint: ENTRY_POINT,
      factory: FACTORY,
    });
  });

  it('returns sender == getAddressForPersonAgent(spec)', async () => {
    const { sender } = await client.buildDeployUserOpForPersonAgent({
      spec: { externalCustodians: [OWNER], salt: 0n },
      paymaster: PAYMASTER,
    });
    expect(sender).toBe(PREDICTED);
  });

  it('initCode starts with factory address (20 bytes)', async () => {
    const { userOp } = await client.buildDeployUserOpForPersonAgent({
      spec: { externalCustodians: [OWNER], salt: 0n },
      paymaster: PAYMASTER,
    });
    const first20 = userOp.initCode.slice(2, 42).toLowerCase();
    expect(first20).toBe(FACTORY.slice(2).toLowerCase());
    expect(userOp.initCode.length).toBeGreaterThan(2 + 40 + 8);
  });

  it('callData is empty (deploy-only UserOp)', async () => {
    const { userOp } = await client.buildDeployUserOpForPersonAgent({
      spec: { externalCustodians: [OWNER], salt: 0n },
      paymaster: PAYMASTER,
    });
    expect(userOp.callData).toBe('0x');
  });

  it('paymasterAndData starts with paymaster address (20 bytes)', async () => {
    const { userOp } = await client.buildDeployUserOpForPersonAgent({
      spec: { externalCustodians: [OWNER], salt: 0n },
      paymaster: PAYMASTER,
    });
    const first20 = userOp.paymasterAndData.slice(2, 42).toLowerCase();
    expect(first20).toBe(PAYMASTER.slice(2).toLowerCase());
    // 20 + 16 + 16 = 52 bytes
    expect(userOp.paymasterAndData.length).toBe(2 + 52 * 2);
  });

  it('signature is empty in unsigned userOp', async () => {
    const { userOp } = await client.buildDeployUserOpForPersonAgent({
      spec: { externalCustodians: [OWNER], salt: 0n },
      paymaster: PAYMASTER,
    });
    expect(userOp.signature).toBe('0x');
  });

  it('nonce is 0 for first deploy', async () => {
    const { userOp } = await client.buildDeployUserOpForPersonAgent({
      spec: { externalCustodians: [OWNER], salt: 0n },
      paymaster: PAYMASTER,
    });
    expect(userOp.nonce).toBe(0n);
  });

  it('userOpHash is fetched from EntryPoint.getUserOpHash', async () => {
    const { userOpHash } = await client.buildDeployUserOpForPersonAgent({
      spec: { externalCustodians: [OWNER], salt: 0n },
      paymaster: PAYMASTER,
    });
    expect(userOpHash).toBe(MOCK_USEROP_HASH);
    const callsForHash = fakeReadContract.mock.calls.filter((call) => {
      const args = call[0] as { functionName?: string };
      return args.functionName === 'getUserOpHash';
    });
    expect(callsForHash.length).toBe(1);
  });

  it('overrides verificationGasLimit + preVerificationGas when supplied', async () => {
    const { userOp } = await client.buildDeployUserOpForPersonAgent({
      spec: { externalCustodians: [OWNER], salt: 0n },
      paymaster: PAYMASTER,
      verificationGasLimit: 999_999n,
      preVerificationGas: 88_888n,
    });
    expect(userOp.preVerificationGas).toBe(88_888n);
    const packed = BigInt(userOp.accountGasLimits);
    expect(packed >> 128n).toBe(999_999n);
  });

  it('passkey-only spec encodes the passkey args into initCode', async () => {
    const { userOp } = await client.buildDeployUserOpForPersonAgent({
      spec: {
        passkey: {
          credentialIdDigest: ('0x' + 'ee'.repeat(32)) as `0x${string}`,
          x: 0xa1n,
          y: 0xa2n,
        },
        salt: 7n,
      },
      paymaster: PAYMASTER,
    });
    // initCode includes the credentialIdDigest constant pattern.
    expect(userOp.initCode.toLowerCase()).toContain('ee'.repeat(32));
  });
});

describe('AgentAccountClient.submitDeployUserOp', () => {
  let client: AgentAccountClient;
  beforeEach(() => {
    fakeWriteContract.mockReset();
    fakeWriteContract.mockResolvedValue(MOCK_TX_HASH);
    fakeWaitForReceipt.mockReset();
    fakeWaitForReceipt.mockResolvedValue({ status: 'success', transactionHash: MOCK_TX_HASH });
    client = new AgentAccountClient({
      rpcUrl: 'http://127.0.0.1:8545',
      chainId: 31337,
      entryPoint: ENTRY_POINT,
      factory: FACTORY,
    });
  });

  it('returns deployedAddress == userOp.sender', async () => {
    const signedUserOp = {
      sender: PREDICTED,
      nonce: 0n,
      initCode: '0xface' as `0x${string}`,
      callData: '0x' as `0x${string}`,
      accountGasLimits: ('0x' + '00'.repeat(32)) as `0x${string}`,
      preVerificationGas: 60_000n,
      gasFees: ('0x' + '00'.repeat(32)) as `0x${string}`,
      paymasterAndData: '0x' as `0x${string}`,
      signature: ('0x' + 'cd'.repeat(65)) as `0x${string}`,
    };
    const bundlerAccount = { address: BUNDLER_ADDR, type: 'local' as const };
    const out = await client.submitDeployUserOp(signedUserOp, bundlerAccount);
    expect(out.deployedAddress).toBe(PREDICTED);
  });

  it('calls handleOps with [userOp] + beneficiary=bundler.address', async () => {
    const signedUserOp = {
      sender: PREDICTED,
      nonce: 0n,
      initCode: '0xface' as `0x${string}`,
      callData: '0x' as `0x${string}`,
      accountGasLimits: ('0x' + '00'.repeat(32)) as `0x${string}`,
      preVerificationGas: 60_000n,
      gasFees: ('0x' + '00'.repeat(32)) as `0x${string}`,
      paymasterAndData: '0x' as `0x${string}`,
      signature: ('0x' + 'cd'.repeat(65)) as `0x${string}`,
    };
    const bundlerAccount = { address: BUNDLER_ADDR, type: 'local' as const };
    await client.submitDeployUserOp(signedUserOp, bundlerAccount);
    expect(fakeWriteContract).toHaveBeenCalledOnce();
    const call = fakeWriteContract.mock.calls[0]![0] as {
      address: string;
      functionName: string;
      args: unknown[];
    };
    expect(call.address).toBe(ENTRY_POINT);
    expect(call.functionName).toBe('handleOps');
    expect(call.args).toEqual([[signedUserOp], BUNDLER_ADDR]);
  });
});
