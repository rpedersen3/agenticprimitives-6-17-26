// CustodyPolicy ABI — source of truth: packages/contracts/src/custody/CustodyPolicy.sol
// (spec 207 / 209 / 213).
//
// This is the typed-data + chain-call surface a custody UI needs. All
// callers should import from here rather than declaring the ABI inline.

export const custodyPolicyAbi = [
  // ─── Mutating: schedule / apply / cancel ─────────────────────────────
  {
    type: 'function',
    name: 'scheduleCustodyChange',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'action', type: 'uint8' },
      { name: 'args', type: 'bytes' },
      { name: 'quorumSigs', type: 'bytes' },
    ],
    outputs: [{ name: 'changeId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'applyCustodyChange',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'changeId', type: 'uint256' },
      { name: 'quorumSigs', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancelScheduledChange',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'changeId', type: 'uint256' },
      { name: 'quorumSigs', type: 'bytes' },
    ],
    outputs: [],
  },
  // ─── Views ──────────────────────────────────────────────────────────
  { type: 'function', name: 'isInstalledOn',        stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'domainSeparator',      stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'custodyMode',          stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'approvalsRequired',    stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }, { name: 'tier', type: 'uint8' }], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'recoveryApprovals',    stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 't3HighValueCeiling',   stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'safetyDelay',          stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }, { name: 'tier', type: 'uint8' }], outputs: [{ type: 'uint32' }] },
  { type: 'function', name: 'isTrustee',            stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }, { name: 'signer', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'trusteeCount',         stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'scheduledChangeCount', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'defaultApprovals',     stateMutability: 'pure', inputs: [{ name: 'nCustodians', type: 'uint8' }, { name: 'tier', type: 'uint8' }], outputs: [{ type: 'uint8' }] },
  {
    type: 'function',
    name: 'getScheduledChange',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }, { name: 'changeId', type: 'uint256' }],
    outputs: [
      { name: 'action', type: 'uint8' },
      { name: 'args', type: 'bytes' },
      { name: 'proposedAt', type: 'uint64' },
      { name: 'eta', type: 'uint64' },
      { name: 'proposer', type: 'address' },
      { name: 'executed', type: 'bool' },
      { name: 'cancelled', type: 'bool' },
    ],
  },
  // ─── Events ─────────────────────────────────────────────────────────
  {
    type: 'event',
    name: 'CustodyChangeScheduled',
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'changeId', type: 'uint256', indexed: true },
      { name: 'action', type: 'uint8', indexed: true },
      { name: 'eta', type: 'uint64', indexed: false },
      { name: 'proposer', type: 'address', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'CustodyChangeApplied',
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'changeId', type: 'uint256', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'ScheduledChangeCancelled',
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'changeId', type: 'uint256', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'CustodyPolicyInstalled',
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'mode', type: 'uint8', indexed: false },
      { name: 'recoveryApprovals', type: 'uint8', indexed: false },
    ],
  },
] as const;
