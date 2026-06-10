# @agenticprimitives/content-primitives

The verifiable content substrate — name, resolve, commit, entitlement-gate, and cite content that lives off-platform and is controlled by third-party rights holders.

Agents increasingly act on content they do not own: quoting a licensed text, citing a canonical passage, gating access to a rights-held corpus. The naive approaches all fail — copy the text and you violate the license; trust the platform and the citation is unverifiable; mint every passage an identity and the identity layer drowns. This package takes the third path: content is **never an agent and never stored**. A unit of content gets a deterministic, scheme-anchored address; an issuer (who IS a Smart Agent) signs a commitment to it; readers verify the signature, evaluate the entitlement, and cite the result — all without the text ever entering the substrate ([ADR-0033](../../docs/architecture/decisions/0033-content-agnostic-verifiable-content-firewall.md)).

The package is strictly content-agnostic: no rendering text in any descriptor or commitment we store (R3), no licensed material in the repo (R1), and the reference grammar is app-injected, never hardcoded (R4). Trust derives from the issuer's signature and access policy, never a platform claim (R5).

Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

## Model (FRBR)

| FRBR | Type | Notes |
| --- | --- | --- |
| Work | `CanonicalLocus` | scheme-anchored deterministic `locusId`; never registered |
| Manifestation | `CorpusManifest` | issuer-owned, Merkle `corpusRoot`, signed |
| Item | `ContentDescriptor` | commitment + `retrievalPointer` + issuer signature — **never text** |
| — | `Entitlement` / `CitationAssertion` | W3C VC 2.0 subjects |

The FRBR Work/Item split is why this is a new substrate and not another naming-record type: a content locus is an address computed from a reference scheme, while only issuers, corpora owners, and parties are Smart Agents (ADR-0010 still governs *them*).

## Quick start

```ts
import {
  buildCanonicalLocus, corpusRef, contentCommitment,
  buildContentDescriptor, verifyContentDescriptor,
  evaluateEntitlement, buildCitationAssertion,
} from '@agenticprimitives/content-primitives';

// 1. App supplies the reference grammar (kept out of the package — R4).
const clauseScheme = { id: 'standard-clause', normalize: (p: string) => /* canonical form */ p };
const locus = buildCanonicalLocus(clauseScheme, 'Part 4, Section 2'); // -> { locusId, path: 'Part4.Section2' }

// 2. Issuer commits to off-platform text + signs a descriptor (no text on-chain — R3).
const commitment = contentCommitment(renderingText); // keccak256, off-platform
const descriptor = await buildContentDescriptor(
  { locusId: locus.locusId, corpusRef: ref, contentType: 'standard-clause',
    commitment, proofPolicy: 'signature', accessPolicy: 'public',
    retrievalPointer: 'content://standard-clause/v3/Part4.Section2', issuer },
  issuerSign, // signs descriptorHash via the issuer SA (ERC-1271)
);

// 3. Reader verifies (signature injected — ADR-0006) + gates + cites.
const ok = await verifyContentDescriptor(descriptor, { verifySignature });
const gate = evaluateEntitlement(descriptor.accessPolicy, descriptor.corpusRef);
```

Entitlement evaluation is fail-closed; Merkle helpers ship under the `/merkle` subpath; ERC-1271 signature verification is dependency-injected so the package stays at the base of the graph.

## Status

Phases 1–3 (naming, commitment, descriptor verification, entitlement gating, citation) are implemented and tested. **ZK proofs and paid access are reserved (Phase 4/5) and throw until implemented** — the full SDK surface and phased roadmap live in [spec 266](../../specs/266-verifiable-content-substrate.md) (see [`spec.md`](./spec.md)).

Testnet/pilot-ready. Production launch is gated on the public checklist in the root README — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).

## Build

```bash
pnpm --filter @agenticprimitives/content-primitives typecheck
pnpm --filter @agenticprimitives/content-primitives test
pnpm --filter @agenticprimitives/content-primitives build
```
