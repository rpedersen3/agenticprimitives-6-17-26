// @agenticprimitives/agent-naming — public API.
//
// See:
//   - capability.manifest.json — boundary
//   - CLAUDE.md — doctrine
//   - specs/215-agent-naming.md — the contract

export { AGENT_TLD, type AgentTld } from './constants';
export { normalizeAgentName, isValidAgentName } from './normalize';
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
export { AgentNamingClient } from './client';
