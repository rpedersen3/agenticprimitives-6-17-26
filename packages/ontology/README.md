# @agenticprimitives/ontology

The **monorepo-wide formal vocabulary** for agentic primitives — the off-chain
source of truth that the on-chain ontology ([ADR-0009](../../docs/architecture/decisions/0009-on-chain-ontology-shacl-naming.md))
instantiates and that [`identity-directory`](../identity-directory) (spec 223)
conforms to.

See [spec 225](../../specs/225-ontology.md) for the full contract and
[ADR-0018](../../docs/architecture/decisions/0018-agenticprimitives-wide-formal-ontology.md)
for the decision.

## Layout (T-box / C-box / A-box)

```
context.jsonld   @context — namespace prefix → IRI bindings
tbox/            RDFS/OWL schema (classes + properties), per domain
cbox/            SHACL shapes + SKOS controlled vocabularies (codelists)
abox/            example / fixture instances (tests + golden vectors only)
src/index.ts     typed IRI constants + artifact paths
```

This mirrors the reference ontology work
(`agentictrustlabs/smart-agent/docs/ontology`): T-box = terminology, C-box =
constraints + controlled vocabularies, A-box = instances.

## Usage

```ts
import { NS, CLASS, SHAPE, ARTIFACTS, artifactPath } from '@agenticprimitives/ontology';

CLASS.CanonicalAgentId; // "https://agenticprimitives.dev/ns/core#CanonicalAgentId"
artifactPath(ARTIFACTS.tbox[0]); // absolute path to tbox/core.ttl — load into a SPARQL store
```

The package is **declarative**: it ships the vocabulary artifacts and exposes
their IRIs/paths. It contains no runtime auth/policy logic. SHACL-engine
validation over instances, and the live A-box knowledge graph (a SPARQL store —
Ontotext GraphDB reference), are wired by consumers in Phase 2 (spec 225 §11).

## Scope (Phase 1)

Bounded to the agent-trust core: identity, credential, custody, delegation,
audit, naming, org. Marketplace / intents / geo are out of scope (spec 225 §11).

## What this is NOT

- Not the TS types — `@agenticprimitives/types` owns `CanonicalAgentId`,
  `Assurance`, etc.; this package names the IRIs. One brand.
- Not the runtime CAIP-10 builder — that is `@agenticprimitives/agent-profile`.
- Not an authority — it names + validates; it never grants custody or mints
  identity.
