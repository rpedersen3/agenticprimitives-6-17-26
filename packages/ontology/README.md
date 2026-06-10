# @agenticprimitives/ontology

**A trust substrate is only as coherent as its vocabulary.** When thirty packages, forty-two contracts, and a knowledge graph all talk about agents, credentials, custody, and delegation, "what exactly is a `CredentialFacet`" cannot have thirty answers. This package is the monorepo-wide formal vocabulary — the off-chain source of truth that the on-chain ontology ([ADR-0009](../../docs/architecture/decisions/0009-on-chain-ontology-shacl-naming.md)) instantiates and that [`identity-directory`](../identity-directory) (spec 223) conforms to.

It is deliberately declarative: it names and constrains, it never authorizes. The vocabulary root depends on nothing — not even `@agenticprimitives/types` — so every other package can reference the same IRIs without inverting the dependency graph.

> Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

See [spec 225](../../specs/225-ontology.md) for the full contract and [ADR-0018](../../docs/architecture/decisions/0018-agenticprimitives-wide-formal-ontology.md) for the decision.

## Layout (T-box / C-box / A-box)

```
context.jsonld   @context — namespace prefix → IRI bindings
tbox/            RDFS/OWL schema (classes + properties), per domain
cbox/            SHACL shapes + SKOS controlled vocabularies (codelists)
abox/            example / fixture instances (tests + golden vectors only)
mappings/        external-standard crosswalks (HCS / ERC-8004, spec 226)
src/index.ts     typed IRI constants + artifact paths
```

T-box = terminology, C-box = constraints + controlled vocabularies, A-box = instances.

## Usage

```ts
import { NS, CLASS, SHAPE, ARTIFACTS, artifactPath } from '@agenticprimitives/ontology';

CLASS.CanonicalAgentId; // "https://agenticprimitives.dev/ns/core#CanonicalAgentId"
artifactPath(ARTIFACTS.tbox[0]); // absolute path to tbox/core.ttl — load into a SPARQL store
```

Two entry points, split on purpose:

- **Main entry (browser-safe)** — pure IRI constants: `NS`, `CLASS`, `PREDICATE`, `SHAPE`, `ONTOLOGY_VERSION`. No Node builtins; this is what `identity-directory` (and through it, browser apps) imports.
- **`/artifacts` subpath (Node-only)** — `ARTIFACTS` + `artifactPath(rel)` to resolve the shipped TTL/JSON-LD files for a SPARQL loader or SHACL engine. Server-side only.

## How it's different

Generic SKOS/SHACL toolchains manage vocabularies as documents — governed in an editor, detached from the systems that depend on them, drifting the moment runtime code changes. Here the vocabulary is load-bearing and lockstep-checked in three directions:

1. **On chain** — a shape or predicate here must match its on-chain counterpart in `OntologyTermRegistry` / `ShapeRegistry` (spec 225 §8); drift is logged as a finding, not tolerated as skew.
2. **In TypeScript** — the IRIs mirror the branded types in [`types`](../types) (`CanonicalAgentId`, `Assurance`, …). One brand; this package names the IRI, never redefines the type.
3. **Across standards** — `mappings/*.ttl` carries explicit crosswalks to external agent-identity standards (HCS, ERC-8004) instead of informal "roughly corresponds to" prose.

And it ships light: no heavy RDF/SHACL libraries in the published surface — consumers wire their own engines against the artifacts.

## Scope

Bounded to the agent-trust core — identity, credential, custody, delegation, audit, naming, org — plus the substrate-spine T-box class definitions (spec 225 §11.5). Runtime SHACL shapes for spine capabilities live in their owning packages; vertical vocabulary is out of scope entirely ([ADR-0021](../../docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md)).

## What this is NOT

- Not the TS types — `@agenticprimitives/types` owns `CanonicalAgentId`, `Assurance`, etc.; this package names the IRIs. One brand.
- Not the runtime CAIP-10 builder — that is `@agenticprimitives/agent-profile`.
- Not an authority — it names and validates; it never grants custody or mints identity.

## Status

**Phase 1 implemented** — the T/C/A-box artifacts, mappings, and the declarative TS surface ship today. SHACL-engine validation over instances and the live A-box knowledge graph (a SPARQL store — Ontotext GraphDB reference, projected by `identity-directory`) are Phase 2, wired by consumers per spec 225 §11 — and even then the ontology stays a validator, never an authority.

> Testnet/pilot-ready. Production launch is gated on the public checklist in the root README — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).

**Authoritative spec:** [`specs/225-ontology.md`](../../specs/225-ontology.md). Bounded surface: `CLAUDE.md` + `capability.manifest.json`.

## Build

```bash
pnpm --filter @agenticprimitives/ontology typecheck
pnpm --filter @agenticprimitives/ontology test
pnpm --filter @agenticprimitives/ontology build
```
