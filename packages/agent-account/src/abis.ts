// Minimal ABI fragments for the on-chain calls AgentAccountClient makes.
// Source of truth: apps/contracts/src/AgentAccountFactory.sol + AgentAccount.sol.

export const agentAccountFactoryAbi = [
  {
    type: 'function',
    name: 'getAddress',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'salt', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'createAccount',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'salt', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'accountImplementation',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  // Passkey-owned accounts (spec 130) — analogous shape to createAccount.
  {
    type: 'function',
    name: 'getAddressForPasskey',
    stateMutability: 'view',
    inputs: [
      { name: 'credentialIdDigest', type: 'bytes32' },
      { name: 'x', type: 'uint256' },
      { name: 'y', type: 'uint256' },
      { name: 'salt', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'createAccountWithPasskey',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'credentialIdDigest', type: 'bytes32' },
      { name: 'x', type: 'uint256' },
      { name: 'y', type: 'uint256' },
      { name: 'salt', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
  // Spec 207 / 209 mode-aware deploy path. Source:
  // apps/contracts/src/AgentAccountFactory.sol#createAccountWithMode.
  {
    type: 'function',
    name: 'createAccountWithMode',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'mode', type: 'uint8' },
          { name: 'custodians', type: 'address[]' },
          { name: 'trustees', type: 'address[]' },
          { name: 'initialPasskeyCredentialIdDigest', type: 'bytes32' },
          { name: 'initialPasskeyX', type: 'uint256' },
          { name: 'initialPasskeyY', type: 'uint256' },
        ],
      },
      { name: 'validator', type: 'address' },
      { name: 'salt', type: 'uint256' },
    ],
    outputs: [{ name: 'account', type: 'address' }],
  },
  // Variant that takes an optional custom T4 timelock (seconds).
  // Pass 0 for the spec default (1h). Useful for demo accounts that
  // want immediate execute-after-propose. T5 + T6 timelocks stay at
  // spec defaults regardless (24h / 48h).
  {
    type: 'function',
    name: 'createAccountWithModeCustomSafetyDelay',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'mode', type: 'uint8' },
          { name: 'custodians', type: 'address[]' },
          { name: 'trustees', type: 'address[]' },
          { name: 'initialPasskeyCredentialIdDigest', type: 'bytes32' },
          { name: 'initialPasskeyX', type: 'uint256' },
          { name: 'initialPasskeyY', type: 'uint256' },
        ],
      },
      { name: 'validator', type: 'address' },
      { name: 'safetyDelaySeconds', type: 'uint32' },
      { name: 'salt', type: 'uint256' },
    ],
    outputs: [{ name: 'account', type: 'address' }],
  },
  {
    type: 'function',
    name: 'getAddressForMode',
    stateMutability: 'view',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'mode', type: 'uint8' },
          { name: 'custodians', type: 'address[]' },
          { name: 'trustees', type: 'address[]' },
          { name: 'initialPasskeyCredentialIdDigest', type: 'bytes32' },
          { name: 'initialPasskeyX', type: 'uint256' },
          { name: 'initialPasskeyY', type: 'uint256' },
        ],
      },
      { name: 'salt', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'event',
    name: 'AgentAccountCreatedWithMode',
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'validator', type: 'address', indexed: true },
      { name: 'mode', type: 'uint8', indexed: true },
      { name: 'nCustodians', type: 'uint256', indexed: false },
      { name: 'nTrustees', type: 'uint256', indexed: false },
      { name: 'salt', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const agentAccountAbi = [
  {
    type: 'function',
    name: 'isValidSignature',
    stateMutability: 'view',
    inputs: [
      { name: 'hash', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bytes4' }],
  },
  {
    type: 'function',
    name: 'acceptSessionDelegation',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'sessionDelegationHash', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'hasAcceptedSessionDelegation',
    stateMutability: 'view',
    inputs: [{ name: 'sessionDelegationHash', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
  { type: 'function', name: 'isCustodian', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'custodianCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'factory', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'delegationManager', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const;

// custodyPolicyAbi was relocated to `@agenticprimitives/custody` per
// spec 213 § 2.6 (phase 6g.3). Source of truth lives there now.

/**
 * ApprovedHashRegistry (apps/contracts/src/ApprovedHashRegistry.sol).
 * The v=1 path companion — passkey-only or hardware-wallet signers
 * pre-approve a hash with one tx instead of producing an off-chain
 * ECDSA sig. `QuorumEnforcer.beforeHook` (and the
 * `_verifyQuorum(..., guardianMode=true)` path in AgentAccount) check
 * `isApproved(signer, hash)` for v=1 slots in the packed blob.
 */
export const approvedHashRegistryAbi = [
  {
    type: 'function',
    name: 'approveHash',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'hash', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revokeHash',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'hash', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'isApproved',
    stateMutability: 'view',
    inputs: [
      { name: 'signer', type: 'address' },
      { name: 'hash', type: 'bytes32' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

/** ERC-1271 magic value returned by isValidSignature on success. */
export const ERC1271_MAGIC_VALUE = '0x1626ba7e' as const;

/**
 * Minimal EntryPoint ABI for our bundler client + UserOp hashing.
 * Source: account-abstraction/contracts/core/EntryPoint.sol (v0.9).
 */
export const entryPointAbi = [
  {
    type: 'function',
    name: 'getUserOpHash',
    stateMutability: 'view',
    inputs: [
      {
        name: 'userOp',
        type: 'tuple',
        components: [
          { name: 'sender', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'initCode', type: 'bytes' },
          { name: 'callData', type: 'bytes' },
          { name: 'accountGasLimits', type: 'bytes32' },
          { name: 'preVerificationGas', type: 'uint256' },
          { name: 'gasFees', type: 'bytes32' },
          { name: 'paymasterAndData', type: 'bytes' },
          { name: 'signature', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'handleOps',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'ops',
        type: 'tuple[]',
        components: [
          { name: 'sender', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'initCode', type: 'bytes' },
          { name: 'callData', type: 'bytes' },
          { name: 'accountGasLimits', type: 'bytes32' },
          { name: 'preVerificationGas', type: 'uint256' },
          { name: 'gasFees', type: 'bytes32' },
          { name: 'paymasterAndData', type: 'bytes' },
          { name: 'signature', type: 'bytes' },
        ],
      },
      { name: 'beneficiary', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getNonce',
    stateMutability: 'view',
    inputs: [
      { name: 'sender', type: 'address' },
      { name: 'key', type: 'uint192' },
    ],
    outputs: [{ name: 'nonce', type: 'uint256' }],
  },
  // EntryPoint custom errors — declaring them lets viem decode the
  // revert (e.g. "AA24 signature error", "AA13 initCode failed or OOG")
  // when handleOps reverts during simulation or execution.
  {
    type: 'error',
    name: 'FailedOp',
    inputs: [
      { name: 'opIndex', type: 'uint256' },
      { name: 'reason', type: 'string' },
    ],
  },
  {
    type: 'error',
    name: 'FailedOpWithRevert',
    inputs: [
      { name: 'opIndex', type: 'uint256' },
      { name: 'reason', type: 'string' },
      { name: 'inner', type: 'bytes' },
    ],
  },
] as const;
