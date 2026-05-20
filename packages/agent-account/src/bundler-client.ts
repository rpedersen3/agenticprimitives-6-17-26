// bundler-client — submit ERC-4337 v0.9 UserOps directly to our own
// deployed EntryPoint via handleOps. We are the bundler.
//
// Why this exists: public bundlers (Pimlico, Stackup, Alchemy AA) only
// support canonical EntryPoint addresses. We deployed our OWN EntryPoint
// (v0.9 from eth-infinitism's lib) so we can stay on the latest spec
// without waiting for SaaS support. The trade-off: we operate the
// bundler ourselves — a single transaction calling handleOps([userOp])
// per submission. KMS-signs the handleOps tx (via createKmsViemAccount).
//
// The paymaster contract (SmartAgentPaymaster) sponsors gas at the
// EntryPoint layer, so users never need ETH and our bundler EOA only
// pays gas it gets reimbursed for (paymaster.deposit → EntryPoint → us).

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from 'viem';
import { entryPointAbi } from './abis';

/**
 * PackedUserOperation (ERC-4337 v0.7+). Each "packed" field is two
 * uint128s packed into a bytes32:
 *   accountGasLimits = (verificationGasLimit << 128) | callGasLimit
 *   gasFees          = (maxPriorityFeePerGas << 128) | maxFeePerGas
 */
export interface PackedUserOperation {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex; // bytes32
  preVerificationGas: bigint;
  gasFees: Hex; // bytes32
  paymasterAndData: Hex;
  signature: Hex;
}

export interface BundlerClientOpts {
  rpcUrl: string;
  entryPoint: Address;
}

/** Pack two uint128s into a single bytes32. high << 128 | low. */
export function packGasLimits(high: bigint, low: bigint): Hex {
  if (high < 0n || high >= 1n << 128n) throw new Error(`packGasLimits: high out of uint128 range`);
  if (low < 0n || low >= 1n << 128n) throw new Error(`packGasLimits: low out of uint128 range`);
  const combined = (high << 128n) | low;
  return ('0x' + combined.toString(16).padStart(64, '0')) as Hex;
}

/** Unpack a bytes32 (high << 128 | low) into [high, low]. */
export function unpackGasLimits(packed: Hex): { high: bigint; low: bigint } {
  const v = BigInt(packed);
  return { high: v >> 128n, low: v & ((1n << 128n) - 1n) };
}

export class BundlerClient {
  private readonly publicClient: PublicClient;
  private readonly opts: BundlerClientOpts;

  constructor(opts: BundlerClientOpts) {
    this.opts = opts;
    this.publicClient = createPublicClient({ transport: http(opts.rpcUrl) });
  }

  /**
   * Ask the EntryPoint for the canonical hash of a (still-unsigned)
   * UserOp. The smart account validates against THIS hash in its
   * validateUserOp. Use this to get the hash for the user to sign.
   */
  async getUserOpHash(userOp: PackedUserOperation): Promise<Hex> {
    return (await this.publicClient.readContract({
      address: this.opts.entryPoint,
      abi: entryPointAbi,
      functionName: 'getUserOpHash',
      args: [userOp],
    })) as Hex;
  }

  /**
   * EntryPoint.getNonce(sender, key). Returns the next-valid nonce for
   * (sender, key). For first deploys, sender doesn't exist yet so the
   * EntryPoint's internal counter starts at 0 — we can hardcode nonce=0
   * for deploy UserOps and skip the RPC call. But for subsequent ops,
   * call this.
   */
  async getNonce(sender: Address, key: bigint = 0n): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.opts.entryPoint,
      abi: entryPointAbi,
      functionName: 'getNonce',
      args: [sender, key],
    })) as bigint;
  }

  /**
   * Submit a batch of UserOps via EntryPoint.handleOps. The `viemAccount`
   * pays gas (will be reimbursed by the paymaster if one is set in
   * paymasterAndData) and broadcasts the tx.
   *
   * @param userOps    The signed UserOps to bundle.
   * @param beneficiary  Address receiving the bundler reward (typically
   *                     the same as the viem account's address).
   * @param viemAccount  Any viem-compatible account — in production this
   *                     is `createKmsViemAccount(kmsBackend)` so signing
   *                     is HSM-backed and no private key is held locally.
   */
  async sendUserOps(
    userOps: PackedUserOperation[],
    beneficiary: Address,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    viemAccount: any,
  ): Promise<TransactionReceipt> {
    const wallet = createWalletClient({
      account: viemAccount,
      transport: http(this.opts.rpcUrl),
    });
    const hash = await wallet.writeContract({
      address: this.opts.entryPoint,
      abi: entryPointAbi,
      functionName: 'handleOps',
      args: [userOps, beneficiary],
      account: viemAccount,
      chain: null,
    });
    return this.publicClient.waitForTransactionReceipt({ hash });
  }
}
