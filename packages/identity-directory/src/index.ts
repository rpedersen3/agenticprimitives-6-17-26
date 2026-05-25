// @agenticprimitives/identity-directory — evidence-backed read model (spec 223).
//
// Public surface: the domain model, the ports (implemented in
// identity-directory-adapters), the assurance ordering, and createDirectory.
//
// See:
//   - capability.manifest.json — boundary (types + audit + ontology only)
//   - ../../specs/223-identity-directory.md — the contract
//   - ../../docs/architecture/decisions/0015-identity-directory-is-an-evidence-backed-read-model.md

export type {
  EvidenceSource,
  Evidence,
  AgentRecord,
  CredentialFacet,
  AgentWithEvidence,
  Resolution,
  AgentView,
  EvidenceLink,
  OnChainReadPort,
  NamingPort,
  IndexerPort,
  DirectoryPorts,
  DirectoryOpts,
  IdentityDirectory,
} from './types';

export { ASSURANCE_ORDER, compareAssurance, maxAssurance } from './types';

export { createDirectory } from './directory';
