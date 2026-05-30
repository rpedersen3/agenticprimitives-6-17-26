// Relationships-contract ABIs — source of truth:
// packages/contracts/src/relationships/*.sol (spec 216 / RL Phase 3).
// Hand-typed against `forge inspect` output. Phase 3 lands the
// contracts on chain; SDK clients wire up reads/writes against these
// in Phase 4.

export const agentRelationshipAbi = [
  // ─── Errors ─────────────────────────────────────────────────────
  { type: 'error', name: 'InvalidEdge', inputs: [] },
  { type: 'error', name: 'EdgeAlreadyExists', inputs: [] },
  { type: 'error', name: 'EdgeNotFound', inputs: [] },
  { type: 'error', name: 'RoleAlreadyExists', inputs: [] },
  { type: 'error', name: 'RoleNotFound', inputs: [] },
  { type: 'error', name: 'NotAuthorized', inputs: [] },
  { type: 'error', name: 'InvalidTransition', inputs: [] },

  // ─── Events ─────────────────────────────────────────────────────
  {
    type: 'event', name: 'EdgeProposed',
    inputs: [
      { name: 'edgeId', type: 'bytes32', indexed: true },
      { name: 'subject', type: 'address', indexed: true },
      { name: 'object_', type: 'address', indexed: true },
      { name: 'relationshipType', type: 'bytes32', indexed: false },
      { name: 'createdBy', type: 'address', indexed: false },
    ],
  },
  {
    type: 'event', name: 'EdgeConfirmed',
    inputs: [{ name: 'edgeId', type: 'bytes32', indexed: true }, { name: 'confirmedBy', type: 'address', indexed: true }],
  },
  {
    type: 'event', name: 'EdgeActivated',
    inputs: [{ name: 'edgeId', type: 'bytes32', indexed: true }, { name: 'activatedBy', type: 'address', indexed: true }],
  },
  {
    type: 'event', name: 'EdgeRevoked',
    inputs: [{ name: 'edgeId', type: 'bytes32', indexed: true }, { name: 'revokedBy', type: 'address', indexed: true }],
  },
  {
    type: 'event', name: 'RoleAdded',
    inputs: [
      { name: 'edgeId', type: 'bytes32', indexed: true },
      { name: 'role', type: 'bytes32', indexed: true },
      { name: 'updater', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event', name: 'RoleRemoved',
    inputs: [
      { name: 'edgeId', type: 'bytes32', indexed: true },
      { name: 'role', type: 'bytes32', indexed: true },
      { name: 'updater', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event', name: 'EdgeMetadataUpdated',
    inputs: [
      { name: 'edgeId', type: 'bytes32', indexed: true },
      { name: 'metadataURI', type: 'string', indexed: false },
      { name: 'metadataHash', type: 'bytes32', indexed: false },
      { name: 'updater', type: 'address', indexed: true },
    ],
  },

  // ─── Edge-ID derivation ─────────────────────────────────────────
  {
    type: 'function', name: 'computeEdgeId', stateMutability: 'pure',
    inputs: [
      { name: 'subject', type: 'address' },
      { name: 'object_', type: 'address' },
      { name: 'relationshipType', type: 'bytes32' },
    ], outputs: [{ type: 'bytes32' }],
  },

  // ─── Writes ─────────────────────────────────────────────────────
  {
    type: 'function', name: 'proposeEdge', stateMutability: 'nonpayable',
    inputs: [
      { name: 'subject', type: 'address' },
      { name: 'object_', type: 'address' },
      { name: 'relationshipType', type: 'bytes32' },
      { name: 'initialRoles', type: 'bytes32[]' },
      { name: 'metadataURI', type: 'string' },
      { name: 'metadataHash', type: 'bytes32' },
    ],
    outputs: [{ name: 'edgeId', type: 'bytes32' }],
  },
  { type: 'function', name: 'confirmEdge', stateMutability: 'nonpayable',
    inputs: [{ name: 'edgeId', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'activateEdge', stateMutability: 'nonpayable',
    inputs: [{ name: 'edgeId', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'revokeEdge', stateMutability: 'nonpayable',
    inputs: [{ name: 'edgeId', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'addRole', stateMutability: 'nonpayable',
    inputs: [{ name: 'edgeId', type: 'bytes32' }, { name: 'role', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'removeRole', stateMutability: 'nonpayable',
    inputs: [{ name: 'edgeId', type: 'bytes32' }, { name: 'role', type: 'bytes32' }], outputs: [] },
  {
    type: 'function', name: 'setMetadata', stateMutability: 'nonpayable',
    inputs: [
      { name: 'edgeId', type: 'bytes32' },
      { name: 'metadataURI', type: 'string' },
      { name: 'metadataHash', type: 'bytes32' },
    ], outputs: [],
  },

  // ─── Reads ──────────────────────────────────────────────────────
  {
    type: 'function', name: 'getEdge', stateMutability: 'view',
    inputs: [{ name: 'edgeId', type: 'bytes32' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'edgeId', type: 'bytes32' },
        { name: 'subject', type: 'address' },
        { name: 'object_', type: 'address' },
        { name: 'relationshipType', type: 'bytes32' },
        { name: 'status', type: 'uint8' },
        { name: 'createdBy', type: 'address' },
        { name: 'createdAt', type: 'uint64' },
        { name: 'updatedAt', type: 'uint64' },
        { name: 'metadataURI', type: 'string' },
        { name: 'metadataHash', type: 'bytes32' },
      ],
    }],
  },
  { type: 'function', name: 'getRoles', stateMutability: 'view',
    inputs: [{ name: 'edgeId', type: 'bytes32' }], outputs: [{ type: 'bytes32[]' }] },
  { type: 'function', name: 'hasRole', stateMutability: 'view',
    inputs: [{ name: 'edgeId', type: 'bytes32' }, { name: 'role', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'getEdgesBySubject', stateMutability: 'view',
    inputs: [{ name: 'subject', type: 'address' }], outputs: [{ type: 'bytes32[]' }] },
  { type: 'function', name: 'getEdgesByObject', stateMutability: 'view',
    inputs: [{ name: 'object_', type: 'address' }], outputs: [{ type: 'bytes32[]' }] },
  {
    type: 'function', name: 'getEdgeByTriple', stateMutability: 'view',
    inputs: [
      { name: 'subject', type: 'address' },
      { name: 'object_', type: 'address' },
      { name: 'relationshipType', type: 'bytes32' },
    ], outputs: [{ type: 'bytes32' }],
  },
  { type: 'function', name: 'edgeExists', stateMutability: 'view',
    inputs: [{ name: 'edgeId', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
] as const;

export const relationshipTypeRegistryAbi = [
  { type: 'error', name: 'NotGovernor', inputs: [] },
  { type: 'error', name: 'TypeExists', inputs: [] },
  { type: 'error', name: 'TypeNotFound', inputs: [] },
  { type: 'error', name: 'ZeroGovernor', inputs: [] },

  {
    type: 'event', name: 'TypeRegistered',
    inputs: [
      { name: 'relationshipType', type: 'bytes32', indexed: true },
      { name: 'label', type: 'string', indexed: false },
      { name: 'isHierarchical', type: 'bool', indexed: false },
      { name: 'isTransitive', type: 'bool', indexed: false },
      { name: 'isSymmetric', type: 'bool', indexed: false },
    ],
  },

  { type: 'function', name: 'governor', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },

  {
    type: 'function', name: 'registerType', stateMutability: 'nonpayable',
    inputs: [
      { name: 'relationshipType', type: 'bytes32' },
      { name: 'label', type: 'string' },
      { name: 'hierarchical', type: 'bool' },
      { name: 'transitive', type: 'bool' },
      { name: 'symmetric', type: 'bool' },
    ], outputs: [],
  },

  { type: 'function', name: 'isRegistered', stateMutability: 'view',
    inputs: [{ name: 'relationshipType', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'isActive', stateMutability: 'view',
    inputs: [{ name: 'relationshipType', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'isHierarchical', stateMutability: 'view',
    inputs: [{ name: 'relationshipType', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'isTransitive', stateMutability: 'view',
    inputs: [{ name: 'relationshipType', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'isSymmetric', stateMutability: 'view',
    inputs: [{ name: 'relationshipType', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  {
    type: 'function', name: 'getTypeSemantics', stateMutability: 'view',
    inputs: [{ name: 'relationshipType', type: 'bytes32' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'relationshipType', type: 'bytes32' },
        { name: 'label', type: 'string' },
        { name: 'isHierarchical', type: 'bool' },
        { name: 'isTransitive', type: 'bool' },
        { name: 'isSymmetric', type: 'bool' },
        { name: 'active', type: 'bool' },
        { name: 'registeredAt', type: 'uint256' },
      ],
    }],
  },
  { type: 'function', name: 'typeCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'getAllTypeIds', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32[]' }] },
] as const;
