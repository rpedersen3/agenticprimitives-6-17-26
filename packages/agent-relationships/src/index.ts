// @agenticprimitives/agent-relationships — public API.
//
// See:
//   - capability.manifest.json — boundary
//   - CLAUDE.md — doctrine
//   - specs/216-agent-relationships.md — the contract
//   - docs/architecture/decisions/0007-agent-identity-stack-three-packages.md

export {
  RELATIONSHIP_TYPE,
  ROLE,
  hashRelationshipType,
  hashRole,
} from './constants';

export { computeEdgeId } from './edge-id';

export {
  TYPE_SEMANTICS,
  type RelationshipTypeSemantics,
} from './taxonomy';

export {
  InvalidEdgeError,
  UnauthorizedActorError,
  UnknownRelationshipTypeError,
} from './errors';

export {
  EdgeStatus,
  type RelationshipType,
  type Role,
  type Edge,
  type ProposeEdgeInput,
  type ConfirmEdgeInput,
  type RevokeEdgeInput,
  type SetRolesInput,
  type AgentRelationshipsClientOpts,
} from './types';

export { AgentRelationshipsClient, type WriteContext } from './client';

// Phase 3 contract ABIs (live at deployed addresses recorded in
// apps/contracts/deployments-<network>.json).
export {
  agentRelationshipAbi,
  relationshipTypeRegistryAbi,
} from './abis';

// Phase 4 pure call builders. Compose into AgentAccount.execute /
// CustodyPolicy ceremonies / ERC-4337 UserOps as needed.
export {
  buildProposeEdgeCall,
  buildConfirmEdgeCall,
  buildActivateEdgeCall,
  buildRevokeEdgeCall,
  buildAddRoleCall,
  buildRemoveRoleCall,
  buildSetMetadataCall,
  type ContractCall,
} from './calls';
