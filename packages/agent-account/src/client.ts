// AgentAccountClient — ERC-4337 substrate. Deterministic address + lazy
// deploy + ERC-1271 verification + UserOp building.
//
// This client delegates CREATE2 math to the factory's getAddress() view —
// keeping all address-derivation logic on-chain so TS and Solidity never
// disagree.

import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  keccak256,
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

/**
 * Build `paymasterAndData` with the standard v0.7+ prefix:
 *   [20 paymaster][16 pmVerifGas][16 pmPostOpGas]
 *
 * When `verifyingPaymaster.signFn` is provided (audit C2), additionally
 * appends `[6 validUntil][6 validAfter][65 signature]`. The signature
 * is produced by passing the canonical hash from
 * `AgentAccountClient.computeVerifyingPaymasterHash` to `signFn` —
 * which MUST EIP-191-wrap the hash (e.g. via viem's `signMessage({ raw })`
 * or a KMS-backed equivalent).
 *
 * The on-chain `SmartAgentPaymaster._validatePaymasterUserOp` recovers
 * the signature via `MessageHashUtils.toEthSignedMessageHash`, matching
 * the EIP-191 wrap. Sig must recover to `verifyingSigner` on the
 * paymaster.
 */
async function buildPaymasterAndData(args: {
  paymaster: Address;
  pmVerifGas: bigint;
  pmPostOpGas: bigint;
  verifyingPaymaster?: {
    signFn: (hash: Hex) => Promise<Hex>;
    validUntilSeconds?: number;
    validAfterSeconds?: number;
  };
  userOpFields: Pick<
    PackedUserOperation,
    'sender' | 'nonce' | 'initCode' | 'callData' | 'accountGasLimits' | 'preVerificationGas' | 'gasFees'
  >;
  chainId: number;
}): Promise<Hex> {
  const prefix = (args.paymaster +
    args.pmVerifGas.toString(16).padStart(32, '0') +
    args.pmPostOpGas.toString(16).padStart(32, '0')) as Hex;
  if (!args.verifyingPaymaster) return prefix;

  const now = Math.floor(Date.now() / 1000);
  const validUntil = args.verifyingPaymaster.validUntilSeconds ?? now + 3600;
  const validAfter = args.verifyingPaymaster.validAfterSeconds ?? 0;

  const hash = AgentAccountClient.computeVerifyingPaymasterHash({
    userOp: args.userOpFields,
    paymaster: args.paymaster,
    chainId: args.chainId,
    validUntil,
    validAfter,
  });
  const signature = await args.verifyingPaymaster.signFn(hash);

  const validUntilHex = validUntil.toString(16).padStart(12, '0');
  const validAfterHex = validAfter.toString(16).padStart(12, '0');
  const sigStripped = signature.startsWith('0x') ? signature.slice(2) : signature;
  if (sigStripped.length !== 130) {
    throw new Error(
      `verifyingPaymaster.signFn returned ${sigStripped.length / 2} bytes; expected 65 (r,s,v ECDSA)`,
    );
  }
  return (prefix + validUntilHex + validAfterHex + sigStripped) as Hex;
}

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
   * Build an unsigned UserOp targeting an ALREADY-DEPLOYED AgentAccount.
   * Counterpart to `buildDeployUserOp` (which deploys the account); this
   * is for calls AFTER deploy: addOwner, addPasskey, validator.proposeAdmin,
   * arbitrary execute(target, value, data), etc.
   *
   * @param opts.sender    Existing AgentAccount address.
   * @param opts.callData  Calldata for the account's execute path. Typically
   *                       built via viem's encodeFunctionData against
   *                       agentAccountAbi.execute or the account's own
   *                       per-action selectors.
   * @param opts.paymaster Paymaster address (sponsors gas).
   * @param opts.verifyingPaymaster When set, appends the EIP-191 paymaster
   *                       signature to paymasterAndData (audit C2 mode).
   *
   * Returns { userOp, userOpHash, sender } — same shape as buildDeployUserOp.
   * The caller signs userOpHash with their owner authority (EOA, passkey,
   * or ERC-1271 contract sig) + drops the sig into userOp.signature, then
   * passes the result to submitCallUserOp.
   */
  async buildCallUserOp(opts: {
    sender: Address;
    callData: Hex;
    paymaster: Address;
    verificationGasLimit?: bigint;
    callGasLimit?: bigint;
    preVerificationGas?: bigint;
    paymasterVerificationGasLimit?: bigint;
    verifyingPaymaster?: {
      signFn: (hash: Hex) => Promise<Hex>;
      validUntilSeconds?: number;
      validAfterSeconds?: number;
    };
  }): Promise<{ userOp: PackedUserOperation; userOpHash: Hex; sender: Address }> {
    const bundler = new BundlerClient({
      rpcUrl: this.opts.rpcUrl,
      entryPoint: this.opts.entryPoint,
    });

    const nonce = await bundler.getNonce(opts.sender);

    // Gas defaults sized for a typical post-deploy call. validateUserOp on a
    // deployed account is ~30-50k; we leave headroom. callGasLimit varies a
    // lot with what's being called — 250k is enough for the validator's
    // propose/execute paths (largest currently-supported actions).
    const verificationGasLimit = opts.verificationGasLimit ?? 120_000n;
    const callGasLimit         = opts.callGasLimit         ?? 250_000n;
    const accountGasLimits     = packGasLimits(verificationGasLimit, callGasLimit);
    const preVerificationGas   = opts.preVerificationGas   ?? 60_000n;

    const block = await this.publicClient.getBlock();
    const baseFeePerGas        = block.baseFeePerGas ?? 100_000_000n;
    const maxPriorityFeePerGas = 100_000_000n; // 0.1 gwei
    const maxFeePerGas         = baseFeePerGas + maxPriorityFeePerGas * 2n;
    const gasFees              = packGasLimits(maxPriorityFeePerGas, maxFeePerGas);

    const pmVerifGas = opts.paymasterVerificationGasLimit ?? 50_000n;
    const pmPostOpGas = 0n;
    const paymasterAndData = await buildPaymasterAndData({
      paymaster: opts.paymaster,
      pmVerifGas,
      pmPostOpGas,
      verifyingPaymaster: opts.verifyingPaymaster,
      userOpFields: {
        sender: opts.sender,
        nonce,
        initCode: '0x' as Hex,
        callData: opts.callData,
        accountGasLimits,
        preVerificationGas,
        gasFees,
      },
      chainId: this.opts.chainId,
    });

    const userOp: PackedUserOperation = {
      sender: opts.sender,
      nonce,
      initCode: '0x',
      callData: opts.callData,
      accountGasLimits,
      preVerificationGas,
      gasFees,
      paymasterAndData,
      signature: '0x',
    };

    const userOpHash = await bundler.getUserOpHash(userOp);
    return { userOp, userOpHash, sender: opts.sender };
  }

  /**
   * Backwards-compatible alias preserving the spec 201 `buildUserOp` shape.
   * Wraps `buildCallUserOp` for single-call userOps. Multi-call (`account.executeBatch`)
   * is the consumer's responsibility — encode the batch as callData and pass it in.
   */
  async buildUserOp(params: {
    account: Address;
    calls: Array<{ to: Address; data: Hex; value: bigint }>;
    paymaster: Address;
    verifyingPaymaster?: {
      signFn: (hash: Hex) => Promise<Hex>;
      validUntilSeconds?: number;
      validAfterSeconds?: number;
    };
  }): Promise<{ userOp: PackedUserOperation; userOpHash: Hex; sender: Address }> {
    if (params.calls.length === 0) throw new Error('buildUserOp: at least one call required');
    if (params.calls.length > 1) {
      throw new Error('buildUserOp: multi-call not implemented in v0 — encode as account.executeBatch in callData');
    }
    const c = params.calls[0]!;
    const callData = encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'execute',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'target', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'data', type: 'bytes' },
          ],
          outputs: [],
        },
      ],
      functionName: 'execute',
      args: [c.to, c.value, c.data],
    });
    return this.buildCallUserOp({
      sender: params.account,
      callData,
      paymaster: params.paymaster,
      verifyingPaymaster: params.verifyingPaymaster,
    });
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
  /**
   * Compute the canonical hash a verifying-paymaster signer must sign
   * (audit C2). Matches `SmartAgentPaymaster.getHash(...)` on-chain.
   * Returns the raw keccak256 — callers wrap with EIP-191 ("\\x19Ethereum
   * Signed Message:\\n32" prefix) before signing, which is what
   * `signMessage({ raw })` does by convention on the viem side.
   */
  static computeVerifyingPaymasterHash(args: {
    userOp: Pick<
      PackedUserOperation,
      'sender' | 'nonce' | 'initCode' | 'callData' | 'accountGasLimits' | 'preVerificationGas' | 'gasFees'
    >;
    paymaster: Address;
    chainId: number;
    validUntil: number;
    validAfter: number;
  }): Hex {
    return keccak256(
      encodeAbiParameters(
        [
          { type: 'address' }, // userOp.sender
          { type: 'uint256' }, // userOp.nonce
          { type: 'bytes32' }, // keccak256(userOp.initCode)
          { type: 'bytes32' }, // keccak256(userOp.callData)
          { type: 'bytes32' }, // userOp.accountGasLimits
          { type: 'uint256' }, // userOp.preVerificationGas
          { type: 'bytes32' }, // userOp.gasFees
          { type: 'uint256' }, // chainId
          { type: 'address' }, // paymaster
          { type: 'uint48' },  // validUntil
          { type: 'uint48' },  // validAfter
        ],
        [
          args.userOp.sender,
          args.userOp.nonce,
          keccak256(args.userOp.initCode),
          keccak256(args.userOp.callData),
          args.userOp.accountGasLimits,
          args.userOp.preVerificationGas,
          args.userOp.gasFees,
          BigInt(args.chainId),
          args.paymaster,
          args.validUntil,
          args.validAfter,
        ],
      ),
    );
  }

  async buildDeployUserOp(opts: {
    owner: Address;
    salt: bigint;
    paymaster: Address;
    verificationGasLimit?: bigint;
    preVerificationGas?: bigint;
    paymasterVerificationGasLimit?: bigint;
    /**
     * Verifying-paymaster mode (audit C2). When provided, the client
     * appends `[validUntil(6)][validAfter(6)][sig(65)]` to
     * `paymasterAndData`, where the signature is produced by calling
     * `signFn(hash)` over the EIP-191-wrapped `getHash(...)` digest.
     * The signFn typically wraps a KMS-backed signMessage call.
     *
     * When omitted, `paymasterAndData` is just the standard prefix
     * (paymaster addr + gas limits) — works for paymasters in dev /
     * accept-all mode (local anvil) or allowlist mode.
     */
    verifyingPaymaster?: {
      signFn: (hash: Hex) => Promise<Hex>;
      validUntilSeconds?: number; // default: now + 1h
      validAfterSeconds?: number; // default: 0 (always valid from start)
    };
  }): Promise<{ userOp: PackedUserOperation; userOpHash: Hex; sender: Address }> {
    const sender = await this.getAddress(opts.owner, opts.salt);

    // initCode = factory address (20 bytes) || createAccount(owner, salt) calldata
    const factoryCalldata = encodeFunctionData({
      abi: agentAccountFactoryAbi,
      functionName: 'createAccount',
      args: [opts.owner, opts.salt],
    });
    const initCode = (this.opts.factory + factoryCalldata.slice(2)) as Hex;

    // Gas defaults sized for the actual factory.createAccount cost on
    // Base Sepolia (~232k from cast estimate). Account-side validateUserOp
    // for a fresh account adds ~30-50k, so 350k verificationGasLimit gives
    // 50%+ headroom without inflating the EntryPoint's prefund requirement.
    const verificationGasLimit = opts.verificationGasLimit ?? 350_000n;
    const callGasLimit = 0n; // callData is empty — we only want to deploy.
    const accountGasLimits = packGasLimits(verificationGasLimit, callGasLimit);
    const preVerificationGas = opts.preVerificationGas ?? 60_000n;

    // Gas fees — pull current base fee from the chain. On L2s (Base, OP,
    // Arbitrum) baseFee is typically <0.01 gwei and a small priority tip
    // is plenty. EntryPoint pre-charges totalGas * maxFeePerGas as
    // "prefund" before the op runs — keeping maxFeePerGas low keeps the
    // paymaster's deposit going further per op.
    const block = await this.publicClient.getBlock();
    const baseFeePerGas = block.baseFeePerGas ?? 100_000_000n;
    const maxPriorityFeePerGas = 100_000_000n; // 0.1 gwei
    const maxFeePerGas = baseFeePerGas + maxPriorityFeePerGas * 2n;
    const gasFees = packGasLimits(maxPriorityFeePerGas, maxFeePerGas);

    // paymasterAndData (v0.7+ layout):
    //   [20 bytes paymaster addr][16 bytes paymasterVerificationGasLimit]
    //   [16 bytes paymasterPostOpGasLimit][remaining bytes paymasterData]
    const pmVerifGas = opts.paymasterVerificationGasLimit ?? 50_000n;
    const pmPostOpGas = 0n; // our SmartAgentPaymaster._postOp is a no-op
    const paymasterAndData = await buildPaymasterAndData({
      paymaster: opts.paymaster,
      pmVerifGas,
      pmPostOpGas,
      verifyingPaymaster: opts.verifyingPaymaster,
      userOpFields: { sender, nonce: 0n, initCode, callData: '0x' as Hex, accountGasLimits, preVerificationGas, gasFees },
      chainId: this.opts.chainId,
    });

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
   * Passkey variant of `buildDeployUserOp`: builds a paymaster-sponsored
   * UserOp whose initCode calls `AgentAccountFactory.createAccountWithPasskey(
   * credentialIdDigest, x, y, salt)`. The deployed smart account has NO
   * EOA owner — the WebAuthn credential at (x, y) is the sole signer.
   *
   * The userOpHash returned here must be signed by the passkey
   * (`navigator.credentials.get` over the hash → `0x01 ||
   * abi.encode(Assertion)` blob). demo-a2a's `/session/deploy` dispatches
   * to this variant when `initMethod=passkey`; the server itself never
   * inspects the signature shape.
   */
  async buildDeployUserOpWithPasskey(opts: {
    credentialIdDigest: Hex;
    pubKeyX: bigint;
    pubKeyY: bigint;
    salt: bigint;
    paymaster: Address;
    verificationGasLimit?: bigint;
    preVerificationGas?: bigint;
    paymasterVerificationGasLimit?: bigint;
    /** Audit C2: verifying-paymaster signature. See buildDeployUserOp opts. */
    verifyingPaymaster?: {
      signFn: (hash: Hex) => Promise<Hex>;
      validUntilSeconds?: number;
      validAfterSeconds?: number;
    };
  }): Promise<{ userOp: PackedUserOperation; userOpHash: Hex; sender: Address }> {
    const sender = await this.getAddressForPasskey(
      opts.credentialIdDigest,
      opts.pubKeyX,
      opts.pubKeyY,
      opts.salt,
    );

    const factoryCalldata = encodeFunctionData({
      abi: agentAccountFactoryAbi,
      functionName: 'createAccountWithPasskey',
      args: [opts.credentialIdDigest, opts.pubKeyX, opts.pubKeyY, opts.salt],
    });
    const initCode = (this.opts.factory + factoryCalldata.slice(2)) as Hex;

    // Higher verification budget than the EOA path: validateUserOp runs
    // `_verifyWebAuthn` which calls P256Verifier. On chains with the
    // RIP-7212 precompile (Base mainnet, recent L2s) the verification
    // is ~3k gas; on chains without (anvil, older testnets) the Daimo
    // Solidity fallback uses ~350-400k. The verificationGasLimit also
    // covers _createSenderIfNeeded (factory deploys ERC1967Proxy ~250k
    // + initializeWithPasskey storage writes ~50k). 1.2M is a comfortable
    // ceiling for both paths; the user only pays the gas actually used
    // (paymaster reimburses, no client cost on Base mainnet/Sepolia).
    const verificationGasLimit = opts.verificationGasLimit ?? 1_200_000n;
    const callGasLimit = 0n;
    const accountGasLimits = packGasLimits(verificationGasLimit, callGasLimit);
    const preVerificationGas = opts.preVerificationGas ?? 60_000n;

    const block = await this.publicClient.getBlock();
    const baseFeePerGas = block.baseFeePerGas ?? 100_000_000n;
    const maxPriorityFeePerGas = 100_000_000n;
    const maxFeePerGas = baseFeePerGas + maxPriorityFeePerGas * 2n;
    const gasFees = packGasLimits(maxPriorityFeePerGas, maxFeePerGas);

    const pmVerifGas = opts.paymasterVerificationGasLimit ?? 50_000n;
    const pmPostOpGas = 0n;
    const paymasterAndData = await buildPaymasterAndData({
      paymaster: opts.paymaster,
      pmVerifGas,
      pmPostOpGas,
      verifyingPaymaster: opts.verifyingPaymaster,
      userOpFields: { sender, nonce: 0n, initCode, callData: '0x' as Hex, accountGasLimits, preVerificationGas, gasFees },
      chainId: this.opts.chainId,
    });

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
   * Counterfactual address for a passkey-owned account. Mirrors
   * `getAddress` but for the passkey factory path.
   */
  async getAddressForPasskey(
    credentialIdDigest: Hex,
    x: bigint,
    y: bigint,
    salt: bigint,
  ): Promise<Address> {
    const factory = getContract({
      address: this.opts.factory,
      abi: agentAccountFactoryAbi,
      client: this.publicClient,
    });
    return (await factory.read.getAddressForPasskey([
      credentialIdDigest,
      x,
      y,
      salt,
    ])) as Address;
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

  /**
   * Submit a (signed) post-deploy UserOp via EntryPoint.handleOps. Counterpart
   * to `submitDeployUserOp`. The relayer (bundlerAccount) pays gas; the
   * paymaster reimburses the bundler from its EntryPoint deposit.
   */
  async submitCallUserOp(
    userOp: PackedUserOperation,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bundlerAccount: any,
  ): Promise<{ receipt: TransactionReceipt }> {
    const bundler = new BundlerClient({
      rpcUrl: this.opts.rpcUrl,
      entryPoint: this.opts.entryPoint,
    });
    const receipt = await bundler.sendUserOps([userOp], bundlerAccount.address, bundlerAccount);
    return { receipt };
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
