// @agenticprimitives/agent-naming — public API.
//
// See:
//   - capability.manifest.json — boundary
//   - CLAUDE.md — doctrine
//   - specs/215-agent-naming.md — the contract

export { AGENT_TLD, type AgentTld } from './constants';
export { normalizeAgentName, normalizeLabel, isValidAgentName } from './normalize';
export { labelhash, namehash, ZERO_NODE } from './namehash';
export {
  InvalidNameError,
  NameNotFoundError,
  UnauthorizedNameOwnerError,
} from './errors';
export type {
  AgentKind,
  AgentNameRecords,
  RegisterSubnameInput,
  SetPrimaryNameInput,
  SetAgentRecordsInput,
  SetSubregistryInput,
  AgentNamingClientOpts,
} from './types';
export { AgentNamingClient, type WriteContext } from './client';

// Phase 4 pure call builders (subpath `@agenticprimitives/agent-naming/custody`
// re-exported from top-level for convenience).
export {
  buildRegisterSubnameCall,
  buildRotateNameOwnerCall,
  buildRotateNameResolverCall,
  buildSetSubregistryCall,
  buildSetPrimaryNameCall,
  buildSetStringAttributeCall,
  buildSetAddressAttributeCall,
  buildSetBytes32AttributeCall,
  buildRecordCalls,
  buildSubregistryRegisterCall,
  type ContractCall,
} from './custody';

// Phase 3 contract ABIs (live at deployed addresses recorded in
// packages/contracts/deployments-<network>.json). ADR-0009 pivot: the
// resolver inherits the shared `AttributeStorage` + ontology stack.
export {
  agentNameRegistryAbi,
  agentNameAttributeResolverAbi,
  agentNameUniversalResolverAbi,
  ontologyTermRegistryAbi,
  shapeRegistryAbi,
  permissionlessSubregistryAbi,
} from './abis';

// Ontology predicate ids (bytes32 mirror of AgentNamePredicates.sol) +
// CAIP-10 helpers + typed encoder / decoder.
export {
  PREDICATE_ID,
  AGENT_KIND_ID,
  CLASS_AGENT_NAME,
  AGENT_KIND_ENUM,
  CAIP10_NAMESPACE_ALLOWLIST,
  encodeRecords,
  decodeRecords,
  type PredicateName,
  type EncodedRecord,
  type DecodeInput,
} from './records';
