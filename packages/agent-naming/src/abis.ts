// Naming-contract ABIs — source of truth: apps/contracts/src/naming/*.sol
// and apps/contracts/src/ontology/*.sol (spec 215 / NS Phase 3,
// ADR-0009 ontology pivot). Hand-typed against `forge inspect` output
// so callers get full viem type-inference without runtime JSON loads.
//
// Convention matches packages/agent-account/src/abis.ts +
// packages/custody/src/abi.ts — typed `as const` arrays.

// ─── AgentNameRegistry ─────────────────────────────────────────────

export const agentNameRegistryAbi = [
  { type: 'error', name: 'NotAuthorized', inputs: [] },
  { type: 'error', name: 'NodeAlreadyExists', inputs: [] },
  { type: 'error', name: 'NodeNotFound', inputs: [] },
  { type: 'error', name: 'ParentNotFound', inputs: [] },
  { type: 'error', name: 'NameExpired', inputs: [] },
  { type: 'error', name: 'RootAlreadyInitialized', inputs: [] },
  { type: 'error', name: 'EmptyLabel', inputs: [] },
  { type: 'error', name: 'ZeroOwner', inputs: [] },

  {
    type: 'event', name: 'RootInitialized',
    inputs: [
      { name: 'rootNode', type: 'bytes32', indexed: true },
      { name: 'label', type: 'string', indexed: false },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'kind', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event', name: 'NameRegistered',
    inputs: [
      { name: 'node', type: 'bytes32', indexed: true },
      { name: 'parent', type: 'bytes32', indexed: true },
      { name: 'label', type: 'string', indexed: false },
      { name: 'owner', type: 'address', indexed: false },
      { name: 'resolver', type: 'address', indexed: false },
      { name: 'expiry', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event', name: 'OwnerChanged',
    inputs: [
      { name: 'node', type: 'bytes32', indexed: true },
      { name: 'newOwner', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event', name: 'ResolverChanged',
    inputs: [
      { name: 'node', type: 'bytes32', indexed: true },
      { name: 'resolver', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event', name: 'SubregistryChanged',
    inputs: [
      { name: 'node', type: 'bytes32', indexed: true },
      { name: 'subregistry', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event', name: 'NameRenewed',
    inputs: [
      { name: 'node', type: 'bytes32', indexed: true },
      { name: 'newExpiry', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event', name: 'PrimaryNameSet',
    inputs: [
      { name: 'agent', type: 'address', indexed: true },
      { name: 'node', type: 'bytes32', indexed: true },
    ],
  },
  {
    type: 'event', name: 'PrimaryNameCleared',
    inputs: [{ name: 'agent', type: 'address', indexed: true }],
  },

  { type: 'function', name: 'namehashRoot', stateMutability: 'pure',
    inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'AGENT_ROOT', stateMutability: 'pure',
    inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'KIND_AGENT', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'bytes32' }] },

  {
    type: 'function', name: 'initializeRoot', stateMutability: 'nonpayable',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'rootOwner', type: 'address' },
      { name: 'resolverContract', type: 'address' },
      { name: 'kind', type: 'bytes32' },
    ],
    outputs: [{ name: 'rootNode', type: 'bytes32' }],
  },
  { type: 'function', name: 'getRoots', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'bytes32[]' }] },
  { type: 'function', name: 'rootByLabel', stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'isRoot', stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'rootKind', stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'bytes32' }] },

  {
    type: 'function', name: 'register', stateMutability: 'nonpayable',
    inputs: [
      { name: 'parentNode', type: 'bytes32' },
      { name: 'label', type: 'string' },
      { name: 'newOwner', type: 'address' },
      { name: 'resolverContract', type: 'address' },
      { name: 'expiry', type: 'uint64' },
    ],
    outputs: [{ name: 'childNode', type: 'bytes32' }],
  },

  { type: 'function', name: 'setOwner', stateMutability: 'nonpayable',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'newOwner', type: 'address' }], outputs: [] },
  { type: 'function', name: 'setResolver', stateMutability: 'nonpayable',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'resolverContract', type: 'address' }], outputs: [] },
  { type: 'function', name: 'setSubregistry', stateMutability: 'nonpayable',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'subregistryContract', type: 'address' }], outputs: [] },
  { type: 'function', name: 'renew', stateMutability: 'nonpayable',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'newExpiry', type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'setPrimaryName', stateMutability: 'nonpayable',
    inputs: [{ name: 'node', type: 'bytes32' }], outputs: [] },

  { type: 'function', name: 'owner',        stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'resolver',     stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'subregistry',  stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'parent',       stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'labelhash',    stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'expiry',       stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'recordExists', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'registeredAt', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'isExpired',    stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'childNode',    stateMutability: 'view',
    inputs: [{ name: 'parentNode', type: 'bytes32' }, { name: 'lh', type: 'bytes32' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'childCount',   stateMutability: 'view', inputs: [{ name: 'parentNode', type: 'bytes32' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'childLabelhashes', stateMutability: 'view', inputs: [{ name: 'parentNode', type: 'bytes32' }], outputs: [{ type: 'bytes32[]' }] },
  { type: 'function', name: 'primaryName',  stateMutability: 'view', inputs: [{ name: 'agent', type: 'address' }], outputs: [{ type: 'bytes32' }] },
] as const;

// ─── AgentNameAttributeResolver (ontology-backed typed records) ────

export const agentNameAttributeResolverAbi = [
  { type: 'error', name: 'NotAuthorized', inputs: [] },
  { type: 'error', name: 'NodeNotFound', inputs: [] },
  { type: 'error', name: 'PredicateNotActive', inputs: [] },
  { type: 'error', name: 'AttributeNotSet', inputs: [] },

  {
    type: 'event', name: 'AttributeSet',
    inputs: [
      { name: 'subject', type: 'bytes32', indexed: true },
      { name: 'predicate', type: 'bytes32', indexed: true },
      { name: 'datatype', type: 'uint8', indexed: false },
      { name: 'version', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event', name: 'AttributeUnset',
    inputs: [
      { name: 'subject', type: 'bytes32', indexed: true },
      { name: 'predicate', type: 'bytes32', indexed: true },
      { name: 'version', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event', name: 'AttributeAppended',
    inputs: [
      { name: 'subject', type: 'bytes32', indexed: true },
      { name: 'predicate', type: 'bytes32', indexed: true },
      { name: 'datatype', type: 'uint8', indexed: false },
      { name: 'version', type: 'uint64', indexed: false },
    ],
  },
  { type: 'event', name: 'SubjectFirstSeen', inputs: [{ name: 'subject', type: 'bytes32', indexed: true }] },

  { type: 'function', name: 'REGISTRY', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'ONTOLOGY', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },

  // ─── Typed setters (owner-gated, predicate-active-checked) ────────
  { type: 'function', name: 'setStringAttribute', stateMutability: 'nonpayable',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }, { name: 'value', type: 'string' }],
    outputs: [] },
  { type: 'function', name: 'setAddressAttribute', stateMutability: 'nonpayable',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }, { name: 'value', type: 'address' }],
    outputs: [] },
  { type: 'function', name: 'setBoolAttribute', stateMutability: 'nonpayable',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }, { name: 'value', type: 'bool' }],
    outputs: [] },
  { type: 'function', name: 'setUintAttribute', stateMutability: 'nonpayable',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }, { name: 'value', type: 'uint256' }],
    outputs: [] },
  { type: 'function', name: 'setBytes32Attribute', stateMutability: 'nonpayable',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }, { name: 'value', type: 'bytes32' }],
    outputs: [] },
  { type: 'function', name: 'setStringArrayAttribute', stateMutability: 'nonpayable',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }, { name: 'values', type: 'string[]' }],
    outputs: [] },
  { type: 'function', name: 'setAddressArrayAttribute', stateMutability: 'nonpayable',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }, { name: 'values', type: 'address[]' }],
    outputs: [] },
  { type: 'function', name: 'setBytes32ArrayAttribute', stateMutability: 'nonpayable',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }, { name: 'values', type: 'bytes32[]' }],
    outputs: [] },
  { type: 'function', name: 'unsetAttribute', stateMutability: 'nonpayable',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }],
    outputs: [] },

  // ─── Typed getters ─────────────────────────────────────────────────
  { type: 'function', name: 'getString',   stateMutability: 'view', inputs: [{ name: 'subject', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'getAddress',  stateMutability: 'view', inputs: [{ name: 'subject', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'getBool',     stateMutability: 'view', inputs: [{ name: 'subject', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'getUint',     stateMutability: 'view', inputs: [{ name: 'subject', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'getBytes32',  stateMutability: 'view', inputs: [{ name: 'subject', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'getStringArr',  stateMutability: 'view', inputs: [{ name: 'subject', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'string[]' }] },
  { type: 'function', name: 'getAddressArr', stateMutability: 'view', inputs: [{ name: 'subject', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'address[]' }] },
  { type: 'function', name: 'getBytes32Arr', stateMutability: 'view', inputs: [{ name: 'subject', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'bytes32[]' }] },

  // ─── Indexing / metadata ───────────────────────────────────────────
  { type: 'function', name: 'predicatesOf',    stateMutability: 'view', inputs: [{ name: 'subject', type: 'bytes32' }], outputs: [{ type: 'bytes32[]' }] },
  { type: 'function', name: 'datatypeOf',      stateMutability: 'view', inputs: [{ name: 'subject', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'updatedAt',       stateMutability: 'view', inputs: [{ name: 'subject', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'isSet',           stateMutability: 'view', inputs: [{ name: 'subject', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'subjectVersion',  stateMutability: 'view', inputs: [{ name: 'subject', type: 'bytes32' }], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'allSubjects',     stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32[]' }] },
  { type: 'function', name: 'subjectCount',    stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

// ─── AgentNameUniversalResolver ────────────────────────────────────

// ─── PermissionlessSubregistry (demo.agent permissionless child registration) ──

export const permissionlessSubregistryAbi = [
  { type: 'error', name: 'AlreadyClaimed',
    inputs: [{ name: 'existingNode', type: 'bytes32' }] },
  { type: 'error', name: 'LabelTooShort', inputs: [] },
  { type: 'error', name: 'EmptyLabel', inputs: [] },
  { type: 'error', name: 'ZeroNewOwner', inputs: [] },

  {
    type: 'event', name: 'NameClaimed',
    inputs: [
      { name: 'caller', type: 'address', indexed: true },
      { name: 'childNode', type: 'bytes32', indexed: true },
      { name: 'label', type: 'string', indexed: false },
      { name: 'newOwner', type: 'address', indexed: false },
    ],
  },

  { type: 'function', name: 'REGISTRY', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'PARENT_NODE', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'DEFAULT_RESOLVER', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'MIN_LABEL_LENGTH', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },

  {
    type: 'function', name: 'register', stateMutability: 'nonpayable',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'newOwner', type: 'address' },
    ],
    outputs: [{ name: 'childNode', type: 'bytes32' }],
  },

  { type: 'function', name: 'claimedBy', stateMutability: 'view',
    inputs: [{ name: 'caller', type: 'address' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'hasClaimed', stateMutability: 'view',
    inputs: [{ name: 'caller', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'claimCount', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

export const agentNameUniversalResolverAbi = [
  { type: 'function', name: 'REGISTRY', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },

  { type: 'function', name: 'resolveName', stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'resolveString', stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'resolveBytes32', stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'resolveAddress', stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'resolveStringBatch', stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'predicates', type: 'bytes32[]' }], outputs: [{ type: 'string[]' }] },
  { type: 'function', name: 'reverseResolve', stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }], outputs: [{ type: 'bytes32' }] },
  {
    type: 'function', name: 'getChildren', stateMutability: 'view',
    inputs: [{ name: 'parentNode', type: 'bytes32' }],
    outputs: [{ type: 'bytes32[]', name: 'childNodes' }, { type: 'address[]', name: 'owners' }],
  },
] as const;

// ─── OntologyTermRegistry (shared trust-fabric vocabulary) ─────────

export const ontologyTermRegistryAbi = [
  { type: 'error', name: 'NotGovernor', inputs: [] },
  { type: 'error', name: 'TermExists', inputs: [] },
  { type: 'error', name: 'TermNotFound', inputs: [] },
  { type: 'error', name: 'ZeroGovernor', inputs: [] },

  {
    type: 'event', name: 'TermRegistered',
    inputs: [
      { name: 'id', type: 'bytes32', indexed: true },
      { name: 'curie', type: 'string', indexed: false },
      { name: 'uri', type: 'string', indexed: false },
    ],
  },
  { type: 'event', name: 'TermDeactivated', inputs: [{ name: 'id', type: 'bytes32', indexed: true }] },
  { type: 'event', name: 'TermActivated',   inputs: [{ name: 'id', type: 'bytes32', indexed: true }] },
  {
    type: 'event', name: 'GovernorTransferred',
    inputs: [
      { name: 'oldGovernor', type: 'address', indexed: true },
      { name: 'newGovernor', type: 'address', indexed: true },
    ],
  },

  { type: 'function', name: 'governor', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'transferGovernor', stateMutability: 'nonpayable',
    inputs: [{ name: 'newGovernor', type: 'address' }], outputs: [] },

  {
    type: 'function', name: 'registerTerm', stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'curie', type: 'string' },
      { name: 'uri', type: 'string' },
      { name: 'label', type: 'string' },
      { name: 'datatype', type: 'string' },
    ], outputs: [],
  },
  {
    type: 'function', name: 'registerTermBatch', stateMutability: 'nonpayable',
    inputs: [
      { name: 'ids', type: 'bytes32[]' },
      { name: 'curies', type: 'string[]' },
      { name: 'uris', type: 'string[]' },
      { name: 'labels', type: 'string[]' },
      { name: 'datatypes', type: 'string[]' },
    ], outputs: [],
  },
  { type: 'function', name: 'deactivateTerm', stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'activateTerm', stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'bytes32' }], outputs: [] },

  {
    type: 'function', name: 'getTerm', stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'id', type: 'bytes32' },
        { name: 'curie', type: 'string' },
        { name: 'uri', type: 'string' },
        { name: 'label', type: 'string' },
        { name: 'datatype', type: 'string' },
        { name: 'active', type: 'bool' },
        { name: 'registeredAt', type: 'uint256' },
      ],
    }],
  },
  { type: 'function', name: 'isRegistered', stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'isActive', stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'termCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'getAllTermIds', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32[]' }] },
] as const;

// ─── ShapeRegistry (SHACL-style shape validation) ──────────────────

export const shapeRegistryAbi = [
  { type: 'error', name: 'NotGovernor', inputs: [] },
  { type: 'error', name: 'ShapeAlreadyDefined', inputs: [] },
  { type: 'error', name: 'ShapeNotDefined', inputs: [] },
  { type: 'error', name: 'ShapeNotActive', inputs: [] },
  { type: 'error', name: 'MissingRequiredProperty',
    inputs: [{ name: 'predicate', type: 'bytes32' }] },
  { type: 'error', name: 'WrongDatatype',
    inputs: [{ name: 'predicate', type: 'bytes32' }, { name: 'actual', type: 'uint8' }, { name: 'expected', type: 'uint8' }] },
  { type: 'error', name: 'EnumValueNotAllowed',
    inputs: [{ name: 'predicate', type: 'bytes32' }, { name: 'actualValue', type: 'bytes32' }] },
  { type: 'error', name: 'EnumSetEmpty', inputs: [] },
  { type: 'error', name: 'ZeroGovernor', inputs: [] },

  {
    type: 'event', name: 'ShapeDefined',
    inputs: [
      { name: 'classId', type: 'bytes32', indexed: true },
      { name: 'version', type: 'uint16', indexed: false },
      { name: 'shapeURI', type: 'string', indexed: false },
      { name: 'shapeHash', type: 'bytes32', indexed: false },
    ],
  },

  { type: 'function', name: 'governor', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },

  { type: 'function', name: 'isValid', stateMutability: 'view',
    inputs: [{ name: 'classId', type: 'bytes32' }, { name: 'subject', type: 'bytes32' }, { name: 'store', type: 'address' }],
    outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'validateSubject', stateMutability: 'view',
    inputs: [{ name: 'classId', type: 'bytes32' }, { name: 'subject', type: 'bytes32' }, { name: 'store', type: 'address' }],
    outputs: [] },

  {
    type: 'function', name: 'getShape', stateMutability: 'view',
    inputs: [{ name: 'classId', type: 'bytes32' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'classId', type: 'bytes32' },
        { name: 'shapeURI', type: 'string' },
        { name: 'shapeHash', type: 'bytes32' },
        { name: 'version', type: 'uint16' },
        { name: 'active', type: 'bool' },
        { name: 'exists', type: 'bool' },
      ],
    }],
  },
  {
    type: 'function', name: 'getProperties', stateMutability: 'view',
    inputs: [{ name: 'classId', type: 'bytes32' }],
    outputs: [{
      type: 'tuple[]',
      components: [
        { name: 'predicate', type: 'bytes32' },
        { name: 'expectedDatatype', type: 'uint8' },
        { name: 'cardinality', type: 'uint8' },
        { name: 'enumSetId', type: 'bytes32' },
        { name: 'expectedClass', type: 'bytes32' },
      ],
    }],
  },
] as const;
