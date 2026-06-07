# @agenticprimitives/content-primitives

Verifiable Content Substrate — name, resolve, commit, entitlement-gate, and cite
content that lives off-platform and is controlled by third-party rights holders.

It is **content-agnostic** ([ADR-0033](../../docs/architecture/decisions/0033-content-agnostic-verifiable-content-firewall.md)):
a referenced unit of content (e.g. a Bible verse) is **not** a Smart Agent, and
this package never embeds a translation, a faith term, or any rendering text.
Bible verses are its first usage domain ([spec 267](../../specs/267-scripture-demo-vertical.md)),
not its vocabulary.

## Model (FRBR)

| FRBR | Type | Notes |
| --- | --- | --- |
| Work | `CanonicalLocus` | scheme-anchored deterministic `locusId`; never registered |
| Manifestation | `CorpusManifest` | issuer-owned, Merkle `corpusRoot`, signed |
| Item | `ContentDescriptor` | commitment + `retrievalPointer` + issuer signature — **never text** |
| — | `Entitlement` / `CitationAssertion` | W3C VC 2.0 subjects |

## Quick start

```ts
import {
  buildCanonicalLocus, corpusRef, contentCommitment,
  buildContentDescriptor, verifyContentDescriptor,
  evaluateEntitlement, buildCitationAssertion,
} from '@agenticprimitives/content-primitives';

// 1. App supplies the reference grammar (kept out of the package — R4).
const bibleVerse = { id: 'bible-verse', normalize: (p: string) => /* OSIS */ p };
const locus = buildCanonicalLocus(bibleVerse, 'John 3:16'); // -> { locusId, path: 'John.3.16' }

// 2. Issuer commits to off-platform text + signs a descriptor (no text on-chain — R3).
const commitment = contentCommitment(renderingText); // keccak256, off-platform
const descriptor = await buildContentDescriptor(
  { locusId: locus.locusId, corpusRef: ref, contentType: 'bible-verse',
    commitment, proofPolicy: 'signature', accessPolicy: 'public',
    retrievalPointer: 'content://bible-verse/bsb/John.3.16', issuer },
  issuerSign, // signs descriptorHash via the issuer SA (ERC-1271)
);

// 3. Reader verifies (signature injected — ADR-0006) + gates + cites.
const ok = await verifyContentDescriptor(descriptor, { verifySignature });
const gate = evaluateEntitlement(descriptor.accessPolicy, descriptor.corpusRef);
```

Full SDK + phased roadmap: [spec 266](../../specs/266-verifiable-content-substrate.md).
ZK proofs and paid access are reserved (Phase 4/5) and throw until implemented.
