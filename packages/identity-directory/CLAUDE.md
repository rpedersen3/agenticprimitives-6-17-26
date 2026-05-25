# @agenticprimitives/identity-directory — Claude guide

## Read model, NOT authority
This package answers "which agent(s) does this name / credential / OIDC subject
resolve to, and on what evidence?" ([ADR-0015](../../docs/architecture/decisions/0015-identity-directory-is-an-evidence-backed-read-model.md);
[spec 223](../../specs/223-identity-directory.md)). It **never** mints identity,
grants custody, or authorizes anything — authority is re-read on-chain by the
consumer (the broker's step-up; spec 224 §8). It accelerates discovery, not trust.

## What this package owns
- The **domain model**: `Evidence` (provenance + `Assurance` + `blockNumber`),
  `AgentWithEvidence`, `Resolution`, `AgentView`, `EvidenceLink`, `CredentialFacet`.
- The **ports**: `NamingPort`, `OnChainReadPort`, `IndexerPort` (interfaces only —
  implemented in [`identity-directory-adapters`](../identity-directory-adapters)).
- The **query API** (`createDirectory(ports, opts)` → `IdentityDirectory`):
  `resolveByName` / `resolveByCredential` / `resolveByOidcSubject` / `agent`.
- The **assurance ordering** (`ASSURANCE_ORDER`, `compareAssurance`, `maxAssurance`).
- Keys on `CanonicalAgentId` (CAIP-10, types); conforms to the `@agenticprimitives/ontology` IRIs.

## What this package does NOT own
- **Port implementations** → `identity-directory-adapters` (the only package
  allowed to import `agent-naming`). The core imports NO source SDK.
- **OIDC verification** (id_token) → `connect-auth` (ADR-0017). The broker verifies
  the claim and calls `resolveByOidcSubject(iss, sub)` with the verified subject.
- **Session minting / the broker** → `connect` (spec 224).
- **Custody / credential rotation** → `account-custody` (spec 221).
- **The runtime CAIP-10 builder** → `agent-profile`.

## Vocabulary
**Owns:** `Evidence`, `EvidenceSource`, `Assurance` (ordering), `Resolution`,
`AgentWithEvidence`, `AgentView`, `EvidenceLink`, the three ports, `createDirectory`.
**"resolution"** here = read-model lookup (name/credential/oidc → agents + evidence),
NOT delegation verification. See [`docs/architecture/vocabulary-map.md`](../../docs/architecture/vocabulary-map.md).
**Does not use:** `Delegation`, `Caveat`, `evaluatePolicy`, `withDelegation`,
`SessionManager`, `buildCaip10Address`.

## Read these first (in order)
1. `capability.manifest.json` — boundary (types + audit + ontology only).
2. `../../specs/223-identity-directory.md` — the contract (ports, convergence, doctrine).
3. `src/types.ts` (domain + ports) then `src/directory.ts` (the resolution logic).

## Stable public exports
- Types: `Evidence`, `EvidenceSource`, `AgentRecord`, `CredentialFacet`,
  `AgentWithEvidence`, `Resolution`, `AgentView`, `EvidenceLink`; ports
  `OnChainReadPort` / `NamingPort` / `IndexerPort`; `DirectoryPorts`,
  `DirectoryOpts`, `IdentityDirectory`.
- Values: `createDirectory`, `ASSURANCE_ORDER`, `compareAssurance`, `maxAssurance`.

## Allowed imports
`@agenticprimitives/types`, `@agenticprimitives/audit`, `@agenticprimitives/ontology`.
Nothing else — NOT `agent-naming` (that is the adapters package's job).

## Forbidden imports
- `apps/*`
- `agent-naming` / `agent-profile` / `agent-relationships` (facet-registry firewall;
  reach naming via `NamingPort`, implemented in the adapters package).
- Every other `@agenticprimitives/*` (back-edges / downstream).

## Drift triggers — STOP and route
- "Import `agent-naming` / `viem` / an indexer SDK here" — **STOP.** Port impls go
  in `identity-directory-adapters`; the core declares ports only.
- "Verify an OIDC id_token / a passkey assertion here" — **STOP.** That is
  `connect-auth`; the broker passes a verified subject in.
- "Issue a session / grant custody from a resolution" — **STOP.** The directory is
  not authority (ADR-0015); sessions are `connect`, custody is `account-custody`.
- "Add an `eth_getLogs` walk to find candidates" — **STOP.** Indexed reads go
  through `IndexerPort` (ADR-0012); `try X catch Y` fallback violates ADR-0013.

## Before you write code
- [ ] Is the change in the domain model, the ports, or the resolution composition?
- [ ] Did I avoid importing any source SDK (it belongs in the adapters package)?
- [ ] For a session-relevant query, is the **OnChainReadPort authoritative** and the
      indexer only proposing? Is an empty authoritative result terminal?
- [ ] Does a `null`/empty port result stay terminal (no escalation to another port)?
- [ ] Did I update `specs/223-identity-directory.md` if the ports/API changed?

## Security invariants (DO NOT BREAK)
- **Not authority.** Resolution output is never the gate for custody/value; the
  consumer re-reads on-chain (ADR-0015).
- **On-chain confirms.** `resolveByCredential`/`resolveByOidcSubject` upgrade to
  `onchain-confirmed` ONLY when the credential is in the agent's CURRENT on-chain
  set; a revoked credential is dropped (audit P1-3).
- **No fallback / no getLogs.** One mechanism per query; empty is the answer
  (ADR-0013); indexed reads via `IndexerPort` only (ADR-0012).

## Validate the package
```bash
pnpm --filter @agenticprimitives/identity-directory typecheck
pnpm --filter @agenticprimitives/identity-directory test
pnpm check:forbidden-terms
```

## Common task routing
- New resolution query → `src/directory.ts` + a port method on `src/types.ts`;
  designate its authoritative port.
- New evidence source → extend `EvidenceSource` + the relevant port.
- New port implementation → `identity-directory-adapters`, NOT here.

## Capabilities this package participates in
- **Identity resolution / knowledge graph** — pairs with `ontology` (vocabulary)
  + `agent-naming` (via `NamingPort`) + `connect` (consumer). Audit: emits
  `identity-directory.resolve*` when an `AuditSink` is supplied.
- Index: [`docs/architecture/cross-cutting-capabilities.md`](../../docs/architecture/cross-cutting-capabilities.md).

## Generated files (ignore)
`dist/`, `node_modules/`, `coverage/`, `*.tsbuildinfo`.
