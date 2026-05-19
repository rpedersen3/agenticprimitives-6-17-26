// AgentAccountClient — ERC-4337 substrate. Deterministic address + lazy
// deploy + ERC-1271 verification + UserOp building.
//
// This client delegates CREATE2 math to the factory's getAddress() view —
// keeping all address-derivation logic on-chain so TS and Solidity never
// disagree.

import {
  createPublicClient,
  createWalletClient,
  http,
  getContract,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Signer } from '@agenticprimitives/identity-auth';
import { agentAccountFactoryAbi, agentAccountAbi, ERC1271_MAGIC_VALUE } from './abis';
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
