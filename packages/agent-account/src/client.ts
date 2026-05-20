// AgentAccountClient — ERC-4337 substrate. Deterministic address + lazy
// deploy + ERC-1271 verification + UserOp building.
//
// This client delegates CREATE2 math to the factory's getAddress() view —
// keeping all address-derivation logic on-chain so TS and Solidity never
// disagree.

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  getContract,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Signer } from '@agenticprimitives/identity-auth';
import { agentAccountFactoryAbi, agentAccountAbi, ERC1271_MAGIC_VALUE } from './abis';
import { BundlerClient, packGasLimits, type PackedUserOperation } from './bundler-client';
import type { UserOperation } from './types';

export interface AgentAccountClientOpts {
  rpcUrl: string;
  chainId: number;
  entryPoint: Address;
  factory: Address;
}

export interface CreateAgentAccountParams {
  owner: Address;
  salt: bigint;
}

export class AgentAccountClient {
  private readonly publicClient: PublicClient;
  private readonly opts: AgentAccountClientOpts;

  constructor(opts: AgentAccountClientOpts) {
    this.opts = opts;
    this.publicClient = createPublicClient({ transport: http(opts.rpcUrl) });
  }

  /**
   * Deterministic CREATE2 address. Works pre-deploy. Delegates the actual
   * computation to the factory's getAddress() view so TS and Solidity stay
   * in lock-step.
   */
  async getAddress(owner: Address, salt: bigint): Promise<Address> {
    const factory = getContract({
      address: this.opts.factory,
      abi: agentAccountFactoryAbi,
      client: this.publicClient,
    });
    return (await factory.read.getAddress([owner, salt])) as Address;
  }

  /**
   * Deploy via factory using the provided signer to broadcast.
   * For relayer-deployed accounts (auth flows where the user can't pay
   * gas themselves), the signer should be a tool-executor key from
   * @agenticprimitives/key-custody, NOT the user's own signer.
   */
  async createAccount(params: CreateAgentAccountParams, signer: Signer): Promise<Address> {
    const wallet = this.walletFromSigner(signer);
    const hash = await wallet.writeContract({
      address: this.opts.factory,
      abi: agentAccountFactoryAbi,
      functionName: 'createAccount',
      args: [params.owner, params.salt],
      account: signer.address,
      chain: null,
    });
    // Wait for receipt; on success the deployed address is also derivable.
    await this.publicClient.waitForTransactionReceipt({ hash });
    return this.getAddress(params.owner, params.salt);
  }

  /**
   * Deploy via factory using a raw bootstrap private key.
   *
   * Lower-level primitive: most callers should prefer
   * `createAccountFromAccount` with a KMS-backed viem account
   * (`createKmsViemAccount` from `@agenticprimitives/key-custody/kms-viem`)
   * so no private-key material lives in env vars or process memory.
   *
   * Idempotent: skips the tx if the account is already deployed.
   */
  async createAccountFromPrivateKey(
    owner: Address,
    salt: bigint,
    bootstrapPrivateKey: Hex,
  ): Promise<Address> {
    const account = privateKeyToAccount(bootstrapPrivateKey);
    return this.createAccountFromAccount(owner, salt, account);
  }

  /**
   * Deploy via factory using any viem-compatible account. The intended
   * production caller is the KMS-backed viem account from
   * `@agenticprimitives/key-custody/kms-viem` — that way the relayer
   * signs the deploy tx via Cloud KMS instead of holding a private key.
   *
   * The address backing `account` must hold ETH on the target chain to
   * pay gas. The deployed smart account is owned by `owner`, not by the
   * relayer — the relayer is a gas payer, not an authority.
   *
   * Idempotent: skips the tx if the account is already deployed.
   */
  async createAccountFromAccount(
    owner: Address,
    salt: bigint,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    account: any,
  ): Promise<Address> {
    const predicted = await this.getAddress(owner, salt);
    if (await this.isDeployed(predicted)) return predicted;

    const wallet = createWalletClient({
      account,
      transport: http(this.opts.rpcUrl),
    });
    const hash = await wallet.writeContract({
      address: this.opts.factory,
      abi: agentAccountFactoryAbi,
      functionName: 'createAccount',
      args: [owner, salt],
      account,
      chain: null,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return predicted;
  }

  async isOwner(account: Address, address: Address): Promise<boolean> {
    // AgentAccount has an internal _owners mapping; expose via a view if
    // the contract has one. For v0 we don't have a public read; return
    // false as a conservative default until the consumer wires one.
    // (Deferred: extend ABI when needed.)
    void account;
    void address;
    return false;
  }

  async isDeployed(account: Address): Promise<boolean> {
    const code = await this.publicClient.getCode({ address: account });
    return code !== undefined && code !== '0x' && code.length > 2;
  }

  /**
   * Produce an ERC-1271-compatible signature: signer.signMessage of `hash`
   * (as raw bytes). The deployed account's isValidSignature then validates
   * by re-deriving EIP-191 digest and checking ownership.
   */
  async signWithErc1271(account: Address, hash: Hex, signer: Signer): Promise<Hex> {
    void account; // signer's signature is what matters; account is for the verifier's lookup
    return signer.signMessage({ raw: hash });
  }

  /**
   * Verify a signature against a deployed account via on-chain ERC-1271 call.
   * Returns true iff `isValidSignature` returns the magic value 0x1626ba7e.
   */
  async isValidSignature(account: Address, hash: Hex, signature: Hex): Promise<boolean> {
    try {
      const account_ = getContract({
        address: account,
        abi: agentAccountAbi,
        client: this.publicClient,
      });
      const result = (await account_.read.isValidSignature([hash, signature])) as Hex;
      return result === ERC1271_MAGIC_VALUE;
    } catch {
      // If the call reverts (e.g., account not deployed yet), treat as invalid.
      return false;
    }
  }

  /**
   * Build a UserOp shell. Gas estimation + paymaster signing happens at the
   * consumer layer (we don't take an opinion on which bundler/paymaster to
   * use). v0: callers fill in nonce / gas / signature themselves.
   */
  async buildUserOp(_params: {
    account: Address;
    calls: Array<{ to: Address; data: Hex; value: bigint }>;
    paymaster?: Address;
  }): Promise<UserOperation> {
    throw new Error(
      'AgentAccountClient.buildUserOp: not implemented in v0 demo (delegation does not require UserOp construction in the v0 demo flow). Land alongside the on-chain delegation redeem path.',
    );
  }

  /**
   * Build an UNSIGNED ERC-4337 v0.9 UserOperation that, when submitted,
   * will deploy the smart account at `getAddress(owner, salt)` via the
   * factory. The user signs `userOpHash` with their owner EOA; the
   * caller then passes the signed userOp to `submitDeployUserOp`.
   *
   * Paymaster sponsorship: `paymasterAndData` is set to the configured
   * paymaster (typically our SmartAgentPaymaster). Dev-mode accept-all
   * means no further data needed beyond gas limits.
   *
   * Returns:
   *   - `userOp`: the unsigned PackedUserOperation (signature = '0x')
   *   - `userOpHash`: the EIP-712 hash the owner must sign
   *   - `sender`: the predicted smart-account address (same as
   *     `getAddress(owner, salt)`)
   */
  async buildDeployUserOp(opts: {
    owner: Address;
    salt: bigint;
    paymaster: Address;
    verificationGasLimit?: bigint;
    preVerificationGas?: bigint;
    paymasterVerificationGasLimit?: bigint;
  }): Promise<{ userOp: PackedUserOperation; userOpHash: Hex; sender: Address }> {
    const sender = await this.getAddress(opts.owner, opts.salt);

    // initCode = factory address (20 bytes) || createAccount(owner, salt) calldata
    const factoryCalldata = encodeFunctionData({
      abi: agentAccountFactoryAbi,
      functionName: 'createAccount',
      args: [opts.owner, opts.salt],
    });
    const initCode = (this.opts.factory + factoryCalldata.slice(2)) as Hex;

    // Conservative gas defaults. Production should estimate via the EntryPoint
    // (simulateValidation / simulateHandleOp) but for the demo's first deploy
    // these are safe upper bounds.
    const verificationGasLimit = opts.verificationGasLimit ?? 700_000n;
    const callGasLimit = 0n; // callData is empty — we only want to deploy.
    const accountGasLimits = packGasLimits(verificationGasLimit, callGasLimit);
    const preVerificationGas = opts.preVerificationGas ?? 60_000n;

    // Gas fees — pull current base fee from the chain and add a tip.
    const block = await this.publicClient.getBlock();
    const baseFeePerGas = block.baseFeePerGas ?? 1_000_000_000n;
    const maxPriorityFeePerGas = 1_500_000_000n; // 1.5 gwei
    const maxFeePerGas = baseFeePerGas * 2n + maxPriorityFeePerGas;
    const gasFees = packGasLimits(maxPriorityFeePerGas, maxFeePerGas);

    // paymasterAndData (v0.7+ layout):
    //   [20 bytes paymaster addr][16 bytes paymasterVerificationGasLimit]
    //   [16 bytes paymasterPostOpGasLimit][remaining bytes paymasterData]
    const pmVerifGas = opts.paymasterVerificationGasLimit ?? 100_000n;
    const pmPostOpGas = 0n; // our SmartAgentPaymaster._postOp is a no-op
    const paymasterAndData = (
      opts.paymaster +
      pmVerifGas.toString(16).padStart(32, '0') +
      pmPostOpGas.toString(16).padStart(32, '0')
    ) as Hex;

    const userOp: PackedUserOperation = {
      sender,
      nonce: 0n,
      initCode,
      callData: '0x',
      accountGasLimits,
      preVerificationGas,
      gasFees,
      paymasterAndData,
      signature: '0x',
    };

    const bundler = new BundlerClient({
      rpcUrl: this.opts.rpcUrl,
      entryPoint: this.opts.entryPoint,
    });
    const userOpHash = await bundler.getUserOpHash(userOp);

    return { userOp, userOpHash, sender };
  }

  /**
   * Submit a (now-signed) deploy UserOp via EntryPoint.handleOps. The
   * `bundlerAccount` pays gas (will be reimbursed by the paymaster) and
   * broadcasts the tx. In production this is `createKmsViemAccount(kms)`
   * — no private key held locally.
   */
  async submitDeployUserOp(
    userOp: PackedUserOperation,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bundlerAccount: any,
  ): Promise<{ deployedAddress: Address; receipt: TransactionReceipt }> {
    const bundler = new BundlerClient({
      rpcUrl: this.opts.rpcUrl,
      entryPoint: this.opts.entryPoint,
    });
    const receipt = await bundler.sendUserOps([userOp], bundlerAccount.address, bundlerAccount);
    return { deployedAddress: userOp.sender, receipt };
  }

  private walletFromSigner(signer: Signer): WalletClient {
    // Adapt the abstract Signer interface to viem's WalletClient. We never
    // expose the private key. The signer's signMessage is sufficient for
    // factory.createAccount (which is a regular contract call, not a UserOp).
    void signer;
    // viem requires an account-of-known-type for writeContract. For v0,
    // consumers passing an EOA signer can supply a viem WalletClient
    // directly via a future overload. Today: deploy path is exercised by
    // the contract deploy script, not via this client.
    return createWalletClient({ transport: http(this.opts.rpcUrl) }) as WalletClient;
  }
}
