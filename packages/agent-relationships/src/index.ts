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

export { AgentRelationshipsClient } from './client';
