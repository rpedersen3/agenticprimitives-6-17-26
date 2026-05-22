// AgentAccountClient — ERC-4337 substrate. Deterministic address + lazy
// deploy + ERC-1271 verification + UserOp building.
//
// This client delegates CREATE2 math to the factory's
// `getAddressForPersonAgent` / `getAddressForMultiSigSmartAgent` views
// so TS and Solidity stay in lock-step.

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
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Signer } from '@agenticprimitives/identity-auth';
import { agentAccountFactoryAbi, agentAccountAbi, ERC1271_MAGIC_VALUE } from './abis';
import { BundlerClient, packGasLimits, type PackedUserOperation } from './bundler-client';

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

/**
 * Phase 6f.4 — the unified person-agent specification. Mirrors the
 * factory's `createPersonAgent` signature. At least one of
 * `externalCustodians` (non-empty) or `passkey` (non-zero pubkey) must
 * be supplied; both is the mixed-mode account (SIWE wallet plus a
 * passkey on the same Person.PSA).
 */
export interface PersonAgentSpec {
  externalCustodians?: readonly Address[];
  passkey?: {
    credentialIdDigest: Hex;
    x: bigint;
    y: bigint;
  };
  salt: bigint;
}

function _custodiansArg(spec: PersonAgentSpec): readonly Address[] {
  return spec.externalCustodians ?? [];
}
function _credIdArg(spec: PersonAgentSpec): Hex {
  return (spec.passkey?.credentialIdDigest ?? ('0x' + '00'.repeat(32))) as Hex;
}
function _xArg(spec: PersonAgentSpec): bigint {
  return spec.passkey?.x ?? 0n;
}
function _yArg(spec: PersonAgentSpec): bigint {
  return spec.passkey?.y ?? 0n;
}

export class AgentAccountClient {
  private readonly publicClient: PublicClient;
  private readonly opts: AgentAccountClientOpts;

  constructor(opts: AgentAccountClientOpts) {
    this.opts = opts;
    this.publicClient = createPublicClient({ transport: http(opts.rpcUrl) });
  }

  /**
   * Deterministic CREATE2 address for a Person Smart Agent (passkey-only,
   * external-only, or mixed). Delegates to the factory's view so TS +
   * Solidity stay in lock-step.
   */
  async getAddressForPersonAgent(spec: PersonAgentSpec): Promise<Address> {
    const factory = getContract({
      address: this.opts.factory,
      abi: agentAccountFactoryAbi,
      client: this.publicClient,
    });
    return (await factory.read.getAddressForPersonAgent([
      _custodiansArg(spec),
      _credIdArg(spec),
      _xArg(spec),
      _yArg(spec),
      spec.salt,
    ])) as Address;
  }

  /**
   * Deploy a Person.PSA via the factory using a raw bootstrap private key.
   * Idempotent — skips the tx if the predicted address already has code.
   * Prefer `createPersonAgentFromAccount` with a KMS-backed viem account
   * in production (no private-key material in process memory).
   */
  async createPersonAgentFromPrivateKey(
    spec: PersonAgentSpec,
    bootstrapPrivateKey: Hex,
  ): Promise<Address> {
    const account = privateKeyToAccount(bootstrapPrivateKey);
    return this.createPersonAgentFromAccount(spec, account);
  }

  /**
   * Deploy a Person.PSA via the factory using any viem-compatible account.
   * The signer pays gas; the deployed account is custodian-of-spec, not
   * custodian-of-relayer. Idempotent.
   */
  async createPersonAgentFromAccount(
    spec: PersonAgentSpec,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    account: any,
  ): Promise<Address> {
    const predicted = await this.getAddressForPersonAgent(spec);
    if (await this.isDeployed(predicted)) return predicted;

    const wallet = createWalletClient({ account, transport: http(this.opts.rpcUrl) });
    const hash = await wallet.writeContract({
      address: this.opts.factory,
      abi: agentAccountFactoryAbi,
      functionName: 'createPersonAgent',
      args: [
        _custodiansArg(spec),
        _credIdArg(spec),
        _xArg(spec),
        _yArg(spec),
        spec.salt,
      ],
      account,
      chain: null,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return predicted;
  }

  /**
   * On-chain `isCustodian(addr)` query against a deployed AgentAccount.
   * Returns the unified view (external custodians + passkey PIAs). Returns
   * false if the account isn't deployed yet.
   */
  async isCustodian(account: Address, address: Address): Promise<boolean> {
    if (!(await this.isDeployed(account))) return false;
    try {
      const acct = getContract({
        address: account,
        abi: agentAccountAbi,
        client: this.publicClient,
      });
      return (await acct.read.isCustodian([address])) as boolean;
    } catch {
      return false;
    }
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
   * is for calls AFTER deploy: addCustodian, addPasskey, validator.proposeAdmin,
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

    // Gas defaults sized for the WORST-case validateUserOp path: a WebAuthn
    // signature verified by Daimo's pure-Solidity P-256 verifier (~330k gas
    // plus sha256s + base64url decode + clientDataJSON parse). On chains with
    // RIP-7212 deployed at 0x100 the precompile branch costs ~3.5k and the
    // budget is wildly over-provisioned, which is fine.
    //
    // callGasLimit is sized for the most common heavy demo path: an Org or
    // Treasury AgentAccount deploy dispatched as Account.execute(factory,
    // 0, createMultiSigSmartAgent(...)). Factory deploy + custody-policy
    // install lands around 600-700k; 800k leaves headroom.
    //
    // Callers can override either via opts.verificationGasLimit /
    // opts.callGasLimit if they know the call is cheaper (saves paymaster
    // burn) or heavier.
    const verificationGasLimit = opts.verificationGasLimit ?? 500_000n;
    const callGasLimit         = opts.callGasLimit         ?? 800_000n;
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

  /**
   * Build an UNSIGNED ERC-4337 v0.9 UserOperation that deploys a Person.PSA
   * via `factory.createPersonAgent(...)`. Works for any custodian shape
   * (passkey-only, external-only, mixed) — the signature on `userOpHash`
   * uses whatever owner authority the resulting account will accept.
   *
   * Paymaster sponsorship: `paymasterAndData` is set to the configured
   * paymaster. Pass `verifyingPaymaster.signFn` to opt into audit C2's
   * verifying-paymaster signed-attestation mode.
   *
   * Gas defaults are sized for the worst-case validateUserOp path: a
   * WebAuthn passkey-init account verified by Daimo's pure-Solidity P-256
   * fallback (~350-400k) plus ERC1967Proxy deploy + storage writes
   * (~300k). Override via `verificationGasLimit` for cheaper paths.
   */
  async buildDeployUserOpForPersonAgent(opts: {
    spec: PersonAgentSpec;
    paymaster: Address;
    verificationGasLimit?: bigint;
    preVerificationGas?: bigint;
    paymasterVerificationGasLimit?: bigint;
    verifyingPaymaster?: {
      signFn: (hash: Hex) => Promise<Hex>;
      validUntilSeconds?: number;
      validAfterSeconds?: number;
    };
  }): Promise<{ userOp: PackedUserOperation; userOpHash: Hex; sender: Address }> {
    const { spec, paymaster } = opts;
    const sender = await this.getAddressForPersonAgent(spec);

    const factoryCalldata = encodeFunctionData({
      abi: agentAccountFactoryAbi,
      functionName: 'createPersonAgent',
      args: [
        _custodiansArg(spec),
        _credIdArg(spec),
        _xArg(spec),
        _yArg(spec),
        spec.salt,
      ],
    });
    const initCode = (this.opts.factory + factoryCalldata.slice(2)) as Hex;

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
      paymaster,
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
   * Counterfactual address for a multi-sig Smart Agent (Org / Treasury /
   * any account with a CustodyPolicy module). The init-params bundle
   * carries the initial custodian set + initial passkey + mode etc.;
   * factory derivation matches the actual deploy bytecode exactly.
   */
  async getAddressForMultiSigSmartAgent(
    params: {
      mode: number;
      custodians: readonly Address[];
      trustees: readonly Address[];
      initialPasskeyCredentialIdDigest: Hex;
      initialPasskeyX: bigint;
      initialPasskeyY: bigint;
    },
    salt: bigint,
  ): Promise<Address> {
    const factory = getContract({
      address: this.opts.factory,
      abi: agentAccountFactoryAbi,
      client: this.publicClient,
    });
    return (await factory.read.getAddressForMultiSigSmartAgent([
      params,
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

}
