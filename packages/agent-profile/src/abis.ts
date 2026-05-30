// Identity-contract ABIs — source of truth:
// packages/contracts/src/identity/*.sol (spec 217 / ID Phase 3).
// AgentProfileResolver inherits the shared AttributeStorage from the
// NS Phase 3 ontology stack; predicates registered in
// OntologyTermRegistry govern what can be written.

export const agentProfileResolverAbi = [
  { type: 'error', name: 'NotAgentOwner', inputs: [] },
  { type: 'error', name: 'AlreadyRegistered', inputs: [] },
  { type: 'error', name: 'NotRegistered', inputs: [] },
  // From AttributeStorage base.
  { type: 'error', name: 'PredicateNotActive', inputs: [] },
  { type: 'error', name: 'AttributeNotSet', inputs: [] },

  {
    type: 'event', name: 'AgentRegistered',
    inputs: [
      { name: 'agent', type: 'address', indexed: true },
      { name: 'displayName', type: 'string', indexed: false },
      { name: 'agentKind', type: 'bytes32', indexed: true },
    ],
  },
  {
    type: 'event', name: 'MetadataUpdated',
    inputs: [
      { name: 'agent', type: 'address', indexed: true },
      { name: 'metadataURI', type: 'string', indexed: false },
      { name: 'metadataHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event', name: 'PropertySet',
    inputs: [
      { name: 'agent', type: 'address', indexed: true },
      { name: 'predicate', type: 'bytes32', indexed: true },
    ],
  },
  // From AttributeStorage base.
  {
    type: 'event', name: 'AttributeSet',
    inputs: [
      { name: 'subject', type: 'bytes32', indexed: true },
      { name: 'predicate', type: 'bytes32', indexed: true },
      { name: 'datatype', type: 'uint8', indexed: false },
      { name: 'version', type: 'uint64', indexed: false },
    ],
  },

  { type: 'function', name: 'ONTOLOGY', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },

  // ─── Writes ─────────────────────────────────────────────────────
  {
    type: 'function', name: 'register', stateMutability: 'nonpayable',
    inputs: [
      { name: 'agent', type: 'address' },
      { name: 'displayName', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'agentKind', type: 'bytes32' },
      { name: 'profileSchemaURI', type: 'string' },
    ], outputs: [],
  },
  {
    type: 'function', name: 'setMetadata', stateMutability: 'nonpayable',
    inputs: [
      { name: 'agent', type: 'address' },
      { name: 'metadataURI', type: 'string' },
      { name: 'metadataHash', type: 'bytes32' },
    ], outputs: [],
  },
  { type: 'function', name: 'setStringProperty', stateMutability: 'nonpayable',
    inputs: [{ name: 'agent', type: 'address' }, { name: 'predicate', type: 'bytes32' }, { name: 'value', type: 'string' }], outputs: [] },
  { type: 'function', name: 'setAddressProperty', stateMutability: 'nonpayable',
    inputs: [{ name: 'agent', type: 'address' }, { name: 'predicate', type: 'bytes32' }, { name: 'value', type: 'address' }], outputs: [] },
  { type: 'function', name: 'setBoolProperty', stateMutability: 'nonpayable',
    inputs: [{ name: 'agent', type: 'address' }, { name: 'predicate', type: 'bytes32' }, { name: 'value', type: 'bool' }], outputs: [] },
  { type: 'function', name: 'setBytes32Property', stateMutability: 'nonpayable',
    inputs: [{ name: 'agent', type: 'address' }, { name: 'predicate', type: 'bytes32' }, { name: 'value', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'setUintProperty', stateMutability: 'nonpayable',
    inputs: [{ name: 'agent', type: 'address' }, { name: 'predicate', type: 'bytes32' }, { name: 'value', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'setActive', stateMutability: 'nonpayable',
    inputs: [{ name: 'agent', type: 'address' }, { name: 'active', type: 'bool' }], outputs: [] },

  // ─── Reads ──────────────────────────────────────────────────────
  { type: 'function', name: 'isRegistered', stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'getStringProperty', stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'getAddressProperty', stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'getBoolProperty', stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'getBytes32Property', stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'getUintProperty', stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'getPredicateKeys', stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }], outputs: [{ type: 'bytes32[]' }] },
  { type: 'function', name: 'agentCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'getAllAgents', stateMutability: 'view', inputs: [], outputs: [{ type: 'address[]' }] },
  { type: 'function', name: 'subjectFor', stateMutability: 'pure',
    inputs: [{ name: 'agent', type: 'address' }], outputs: [{ type: 'bytes32' }] },
] as const;
