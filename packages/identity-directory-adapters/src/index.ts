// @agenticprimitives/identity-directory-adapters — port implementations.
//
// The composition layer that wires identity-directory's ports to real sources.
// The ONE package allowed to import agent-naming (spec 100 §4 / ADR-0015); kept
// out of the directory core so the read model stays source-agnostic.
//
// See:
//   - capability.manifest.json — boundary
//   - ../../specs/223-identity-directory.md — the contract
//   - ../identity-directory — the ports these implement

export { toCanonicalAgentId, addressOf, EIP155_NAMESPACE } from './caip10';
export { makeNamingPort, type NamingReads } from './naming';
export { makeOnChainReadPort, viemExists, type OnChainReaders } from './onchain';
export { createInMemoryIndexer, type IndexerEntry } from './indexer';
