// @agenticprimitives/agent-identity — public API.
//
// See:
//   - capability.manifest.json — boundary
//   - CLAUDE.md — doctrine
//   - specs/217-agent-identity.md — the contract
//   - docs/architecture/decisions/0007-agent-identity-stack-three-packages.md
//   - docs/architecture/decisions/0008-caip10-nativeid-record-predicate.md

export {
  CAIP10_NAMESPACE_ALLOWLIST,
  AGENT_CARD_SCHEMA_VERSION,
} from './constants';

export {
  buildCaip10Address,
  parseCaip10,
  isValidCaip10,
  type Caip10Parts,
} from './caip10';

export {
  canonicalProfileJson,
  profileContentHash,
} from './profile';

export {
  InvalidProfileError,
  ProfileHashMismatchError,
  EndpointVerificationError,
  InvalidCaip10Error,
} from './errors';

export type {
  ProfileType,
  Caip10Address,
  VerificationMethod,
  AiAgentProfile,
  McpServerProfile,
  MultisigProfile,
  ServiceProfile,
  AgentCard,
  AgentIdentityClientOpts,
  PublishProfileInput,
} from './types';

export { AgentIdentityClient } from './client';
