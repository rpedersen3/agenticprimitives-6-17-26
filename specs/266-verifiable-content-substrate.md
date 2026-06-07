# Spec 266 — Verifiable Content Substrate

> **v2 (2026-06-07) — canonical-locus refinement (supersedes the §2.1 string-hash
> model below).** The canonical id is no longer `keccak(scheme:path)`. It is a
> **deterministic, domain-separated hash of a schema-validated, scheme-independent
> envelope**:
>
> ```
> canonicalId = keccak256( "ap:canonical-locus-id:v1\0" || JCS(envelope) )
> envelope    = { idScheme:'ap-locus-id-v1', contentDomain, locusProfile, canonicalLocus }
> ```
>
> `canonicalLocus` carries **controlled tokens only** (e.g. `work:'bible.book.john',
> canon:'bible.protestant-66', versification:'kjv-v1', locusType:'verse', chapter,
> verse`) — never display labels, OSIS/USFM strings, or user input (JCS does NOT
> Unicode-normalize). The vertical extension **validates the locus before hashing**
> and normalizes every surface grammar (OSIS/USFM/"Jn 3.16") to one canonical
> locus → one id. The id moves ONLY on a deliberate `locusProfile`/`versification`/
> `canon`/`locusType` change (the governance seam); it does NOT move on new
> aliases, descriptors, translations, pointers, or key rotation. Registry-free,
> reproducible, no allocator. Keccak is the single `ap-locus-id-v1` hash
> (EVM-anchorable for Phase 3) — not two encodings.
>
> **Four distinct, domain-separated identity layers (do not collapse):**
> `CanonicalLocusId` (`ap:canonical-locus-id:v1`) · `ContentDescriptorId` =
> `descriptorHash` (`ap:content-descriptor:v1`) · `ArtifactCommitment` =
> `contentCommitment` (SHA-256 of `canonical-text-v1`-normalized body) ·
> `CitationAssertionId` (the VC's JCS hash).
>
> **Also in v2:** candidate resolution (`resolveCandidates` returns MANY
> descriptors per locus, screened by a `TrustProfileConfig` + constraints — never
> one "official" answer; a descriptor is a policy INPUT, not a grant); structured
> frozen commitment object `{type, normalization, algorithm, value}`; lean
> descriptor (`status`/`revocationRef`/validity/`work`/`selector`); the
> `ProofPolicy` enum (`issuer-signature-v1` / `-and-hash-v1` /
> `merkle-membership-v1` wired, rest reserved); trust profiles; one shared
> canonicalization stack (`jcsCanonicalize` from `verifiable-credentials` — RFC
> 8785, reused so descriptor/locus ids never drift from VC hashes); and the
> scripture vertical now lives in the **`domains/scripture-content-extension`**
> package (the `domains/` tier, NOT `packages/` — spec 267 / ADR-0033). The
> ContentDescriptor pattern (named thing + signed descriptor + commitment +
> off-chain artifact + policy + audit) is the content analog of `skills`/`geo`
> definition+claim and `agreements` commitments — the same Agentic Primitives
> shape, projected per domain. See §13 (threat model).

**Status:** v0 (Phase 1 — generic ontology namespace + pure SDK + spec). No
contracts, no ZK, no payments in Phase 1 (interfaces reserved).
**Owners:** `@agenticprimitives/ontology` (the `apcnt:` formal vocabulary) +
`@agenticprimitives/content-primitives` (the runtime SDK, **net-new**).
**Architecture commitment:** [ADR-0033 — content-agnostic verifiable-content
firewall](../docs/architecture/decisions/0033-content-agnostic-verifiable-content-firewall.md).
**Adapted from:** the `agent-naming` resolution-layer shape (spec 215 / ADR-0006)
and the `skills` definition-vs-claim substrate (spec 251) — **patterns ported,
not the agent-binding** (see §11).
**Standards aligned (spec 226):** FRBR (Work/Expression/Manifestation/Item),
OSIS/USFM (reference grammar), PROV-O (citation provenance), W3C VC 2.0
(entitlements), CAIP-10 (issuer id), RFC 8785 JCS (canonical descriptor hash).

---

## 0. The architectural shape (read first)

This substrate names, resolves, and verifies **content** that lives off-platform
and is controlled by third-party rights holders. It is the generic primitive
behind "deliver verse X in translation Y with cryptographic trust" — but it
knows nothing about Bibles. Scripture is its **first usage domain** (spec 267),
not its vocabulary.

The one idea that drives the whole design:

> **A referenced unit of content is not an Agent.** The platform's canonical-
> identifier rule (ADR-0010: "every name is a facet of a Smart Agent address")
> applies to the *parties* (issuers, readers, resolver agents) — NOT to the
> *content*. A content coordinate (a verse reference) is **scheme-anchored**: a
> deterministic id computed from a normalized reference, never registered,
> never owning or owned by an SA. Issuers and corpora ARE Smart Agents, so
> `agent-naming` + ADR-0010 still govern them.

Trust in a rendering flows from the **issuer's signature + access policy on a
descriptor**, never from the platform holding or knowing the text (R5).

## 1. Hard rules (binding; CI-enforced where automatable)

- **R1 — No licensed content, anywhere.** No package, app, test, fixture,
  example, or doc may reference, embed, normalize, hash, or commit any
  *copyrighted* work or its edition token (NIV/ESV/NASB/NLT/NKJV/MSG/…).
  Enforced by `pnpm check:no-licensed-content` (deny-list of well-known
  copyrighted edition tokens) + the existing faith-vocab gate in
  `check:no-domain-in-packages`.
- **R2 — One public-domain translation in the demo, pluggable.** The demo ships
  exactly one CC0/public-domain edition (Berean Standard Bible). Adding an
  edition is **data + config** (a manifest + descriptor set + registry entry),
  never a code change (spec 267).
- **R3 — No content text on-chain, ever.** The commitment layer (and any future
  contract) stores only hashes / Merkle roots / descriptors / signatures /
  retrieval pointers. `ContentDescriptor` carries a `retrievalPointer`, never
  inline text.
- **R4 — Content-agnostic core.** The `apcnt:` ontology namespace and the
  `verifiable-content` package carry **zero** vertical/faith vocabulary.
  `contentType` and the reference *scheme* are opaque, app-injected strings.
- **R5 — Trust = issuer signature + access policy.** The platform is mechanical:
  it resolves names, computes commitments, verifies signatures, and gates on
  policy. It never asserts that a rendering is "correct."

## 2. Object model (FRBR, faith-free)

| FRBR | `apcnt:` class | What it is | Anchored to | On-chain footprint |
| --- | --- | --- | --- | --- |
| Work | `CanonicalLocus` | An edition-independent coordinate into a structured corpus (a "passage address"). Identified by a deterministic `locusId`. | a **scheme** (not an Agent) | none — pure compute |
| Expression / Manifestation | `CorpusManifest` | A versioned, committed body of renderings published by an issuer. | an **issuer Smart Agent** | `corpusRoot` + `manifestHash` only |
| Item | `ContentDescriptor` | The deliverable trust leaf for one (corpus, locus): commitment + pointer + issuer signature + policy. **Points AT off-chain text; never contains it.** | issuer signature (ERC-1271) | `commitment` only (descriptor itself is off-chain) |
| — | `CitationAssertion` | "Agent A cited locus X from corpus C; commitment matched; under entitlement E." The AI-safe citation record. | attestation + audit | optional attestation UID |
| — | `Entitlement` | A VC/attestation: "subject S may access corpus C under terms T." Gates the resolve/retrieve path. | issuer | optional attestation UID |

### 2.1 Reference (Work) — scheme-anchored, deterministic

A reference is `(scheme, path)`, e.g. `("bible-verse", "John.3.16")`. Both come
from the **app**; the substrate treats them opaquely. Normalization +
`locusId` are the namehash-analog:

```
normalizeReference(scheme, path) → canonical string  (NFC, scheme-supplied rules)
locusId = keccak256(utf8(`${scheme}:${normalized}`))  → bytes32
```

Deterministic, pure, browser/Worker/Node-safe. **No registration.** Two
references that normalize equal MUST produce identical `locusId` (golden
vectors). The substrate ships the hashing; the **scheme rules** (book table,
chapter:verse grammar) are an app-supplied `ReferenceScheme` adapter.

### 2.2 Corpus (Manifestation) — issuer-owned, committed

```ts
interface CorpusManifest {
  corpusRef: Hex;          // = keccak256(utf8(`${issuer}/${edition}/${version}`))
  issuer: Address;         // issuer Smart Agent (canonical id; ADR-0010)
  edition: string;         // opaque app label (e.g. a PD edition code)
  version: string;         // edition version/year
  scheme: string;          // the reference scheme this corpus renders
  corpusRoot: Hex;         // Merkle root over the per-locus descriptor commitments
  accessPolicy: AccessPolicy;   // 'public' | 'licensed' | 'private'
  proofPolicy: ProofPolicy;     // 'signature' | 'merkle-inclusion' | 'zk' (zk reserved)
  licenseTermsHash: Hex;   // keccak256 of the off-chain license terms doc (R5)
  metadataUri?: string;    // off-chain manifest JSON pointer
}
```

The issuer Smart Agent signs `manifestHash = jcsHash(manifest)` (ERC-1271). This
is the precedent set by `aps:Skill.ontologyMerkleRoot` (spec 251) generalized to
content corpora.

### 2.3 Descriptor (Item) — the deliverable, text-free

```ts
interface ContentDescriptor {
  locusId: Hex;            // §2.1
  corpusRef: Hex;          // §2.2
  contentType: string;     // opaque app type, e.g. 'bible-verse'
  commitment: Hex;         // keccak256 of the canonicalized rendering text (off-chain)
  proofPolicy: ProofPolicy;
  accessPolicy: AccessPolicy;
  retrievalPointer: string;// URI/locator for the off-chain text (NEVER the text — R3)
  issuer: Address;
  signature: Hex;          // issuer ERC-1271 over descriptorHash (RFC 8785 JCS)
}
```

`commitment` binds the descriptor to a specific rendering **without revealing
it**: the holder of the text proves `keccak256(canonicalize(text)) ===
commitment`. For `proofPolicy='merkle-inclusion'`, the descriptor's
`commitment` is a leaf whose inclusion under `corpusRoot` is provable.

### 2.4 Citation + Entitlement

`CitationAssertion` and `Entitlement` are W3C VC 2.0 credentials issued/verified
via the existing `verifiable-credentials` + `attestations` packages — this spec
only defines their `credentialSubject` shapes and the `evaluateEntitlement`
gate. They are **optional** for `accessPolicy='public'` corpora.

## 3. Resolution flow ("resolve passage X in edition Y")

1. Resolve issuer/corpus: `agent-naming.resolveName(issuerName)` → issuer SA;
   read its corpus-directory record → `corpusRef`. (App may also pass `corpusRef`
   directly.)
2. `locusId = computeLocusId(scheme, path)` (§2.1).
3. Look up `ContentDescriptor` by `(corpusRef, locusId)` from the issuer's
   descriptor store (off-chain; the MCP server in spec 267 owns one).
4. `verifyContentDescriptor` — checks issuer ERC-1271 signature + (for
   merkle-inclusion) inclusion under `corpusRoot`.
5. Gate: `evaluateEntitlement(accessPolicy, entitlement?)` via `tool-policy`.
   `public` → allow; `licensed`/`private` → require a valid `Entitlement`.
6. On allow, return the descriptor → client fetches text from `retrievalPointer`
   → verifies `commitment` → `buildCitationAssertion(...)` + audit row.

The substrate's read path obeys ADR-0012 (no `eth_getLogs`) and ADR-0013 (no
silent fallbacks): one mechanism per lookup; empty is an answer.

## 4. Public API — `@agenticprimitives/content-primitives` (Phase 1)

```ts
// Pure, no I/O
export interface ReferenceScheme {            // app-supplied adapter
  id: string;
  normalize(path: string): string;            // throws InvalidReferenceError
}
export function computeLocusId(scheme: string, normalizedPath: string): Hex;

export function corpusRef(issuer: Address, edition: string, version: string): Hex;

// Merkle (net-new; repo had only flat keccak commitments in `agreements`)
export function leafHash(descriptorCommitment: Hex): Hex;
export function buildCorpusTree(leaves: Hex[]): { root: Hex; layers: Hex[][] };
export function merkleProof(tree: { layers: Hex[][] }, index: number): Hex[];
export function verifyInclusion(leaf: Hex, proof: Hex[], root: Hex): boolean;

// Descriptors
export function descriptorHash(d: Omit<ContentDescriptor, 'signature'>): Hex; // RFC 8785 JCS
export function buildContentDescriptor(input: BuildDescriptorInput, sign: SignFn): Promise<ContentDescriptor>;
export function verifyContentDescriptor(
  d: ContentDescriptor,
  opts: { account: AgentAccountClient; corpusRoot?: Hex; inclusionProof?: Hex[] },
): Promise<{ ok: boolean; reason?: string }>;

// Commitment over the actual (off-chain) rendering
export function contentCommitment(text: string): Hex;      // keccak256(canonicalize(text))
export function verifyCommitment(text: string, commitment: Hex): boolean;

// Entitlement gate + citation
export function evaluateEntitlement(
  accessPolicy: AccessPolicy,
  entitlement?: VerifiableCredential,
): { decision: 'allow' | 'deny'; reason?: string };
export function buildCitationAssertion(input: CitationInput): VerifiableCredential;

export class InvalidReferenceError extends Error {}
export class CommitmentMismatchError extends Error {}

// Reserved (throw `Error('verifiable-content: phase N')` in Phase 1)
export function buildInclusionZkProof(/* ... */): Promise<never>; // ZK phase
export function bindPaymentMandate(/* ... */): never;             // payments phase
```

**Allowed imports:** `@agenticprimitives/types`, `@agenticprimitives/agent-account`
(ERC-1271 verify), `@agenticprimitives/verifiable-credentials` +
`@agenticprimitives/attestations` (entitlement/citation envelopes), `viem`.
**Forbidden imports:** `apps/*`, any faith/vertical literal, `agent-naming`
(apps compose naming + this package directly, mirroring spec 215 §3's refusal of
a `agent-naming → delegation` edge).

## 5. Ontology additions — `packages/ontology` (`apcnt:`)

New namespace `apcnt: https://agenticprimitives.dev/ns/content#`. This is
monorepo-wide generic substrate (like `aps:`/`apg:`, spec 251) — **in scope** for
the ontology package, subject to R4 (zero faith vocabulary).

- `tbox/content.ttl`: classes `CanonicalLocus`, `CorpusManifest`,
  `ContentDescriptor`, `CitationAssertion`, `Entitlement`; predicates
  `locusOf`, `renderedBy`, `commitsTo`, `corpusRoot`, `accessPolicy`,
  `proofPolicy`, `issuedBy`, `citesLocus`, `underEntitlement`, `retrievalPointer`.
- `cbox/content-vocabulary.ttl`: SKOS codelists `accessPolicy {public, licensed,
  private}` and `proofPolicy {signature, merkle-inclusion, zk}`; SHACL
  `ContentDescriptorShape` (requires `commitsTo`, `issuedBy`, `retrievalPointer`;
  forbids any text literal — encodes R3).
- `src/index.ts`: add `apcnt` to `NS`; add the classes to `CLASS`, predicates to
  `PREDICATE`, `ContentDescriptor` shape to `SHAPE`. `context.jsonld` +
  `ARTIFACTS` updated. Codelists stay in `.ttl` (no TS duplication).

## 6. Phase plan (mirrors agent-naming's SDK-before-contracts cadence)

| Phase | Scope | Status |
| --- | --- | --- |
| **1** | This spec + ADR-0033 + `apcnt:` ontology + `verifiable-content` pure SDK (locusId, Merkle, descriptor build/verify, commitment, entitlement, citation) with golden-vector tests. ZK/payment fns reserved (throw). | this turn |
| **2** | Scripture demo vertical (spec 267): demo-bible MCP/a2a/web against BSB, off-chain descriptor store + corpus root. | next |
| **3** | `ContentCorpusRegistry` contract (stores `corpusRoot` + `manifestHash` per `corpusRef`, issuer-SA-gated via CustodyPolicy). On-chain inclusion verification. | later |
| **4** | ZK inclusion proofs (`proofPolicy='zk'`) + "AI-cited-correctly" selective proofs. | later |
| **5** | Paid access — bind `payments` mandates to entitlement issuance. | later |

## 7. Security invariants (Phase 1)

- **Deterministic locus.** Equal-normalizing references → identical `locusId`
  (golden vectors).
- **Text-free on-chain / in-commitment.** No code path puts rendering text into a
  descriptor, a commitment preimage stored on-platform, or a contract (R3).
- **Issuer-bound descriptors.** `verifyContentDescriptor` fails closed unless the
  issuer's ERC-1271 signature over the JCS descriptor hash verifies.
- **Fail-closed gating.** `evaluateEntitlement` returns `deny` for `licensed`/
  `private` without a valid entitlement; unknown `accessPolicy` → `deny`.
- **No licensed reference.** No fixture/test/example names a copyrighted edition
  (R1; CI-enforced).

## 8. Reference: smart-agent patterns to port (required section)

`smart-agent` (branch `003-intent-marketplace-proposal`) has **no content-
addressing analog** — verses-as-content is net to this codebase. We port
*patterns*, not contracts:

- **Namehash determinism** (`packages/sdk/src/naming.ts`) → `computeLocusId`
  (same keccak recursion idea, applied to a content scheme).
- **Registry/resolver + AttributeStorage governance** (spec 215 §Phase 3 /
  ADR-0009) → the Phase-3 `ContentCorpusRegistry` (issuer-SA-gated writes,
  predicate-active checks).
- **Definition-vs-claim split** (`skills`, spec 251: public on-chain definition +
  `ontologyMerkleRoot`, off-chain vault claim) → `CorpusManifest` (public,
  `corpusRoot`) vs `ContentDescriptor`/`Entitlement` (off-chain, issuer-signed).

**Deliberate divergence:** content loci are **scheme-anchored, not SA-anchored**.
A locus has no owner and is never registered; only corpora (issuer-owned) and
parties are Smart Agents. This is the FRBR Work/Item split, and it is the reason
this is a new substrate rather than an `agent-naming` record type.

## 9. Out of scope (Phase 1)

On-chain registry; ZK proofs; payments; multi-edition discovery/intent-matching;
full-text search/indexing (an app concern); any specific translation's data
(spec 267 owns the single PD seed).

## 13. Threat model + conformance (v2)

The deterministic canonical-locus design removes the central allocator but adds
identity-integrity threats the extension MUST defend + test:

| Threat | Mitigation (Phase 1) |
| --- | --- |
| **Alias-equivalence bugs** (OSIS vs USFM should match) | Normalize all surface forms to ONE controlled-token locus; conformance test asserts equal ids. |
| **Profile / versification drift** | `locusProfile` + `versification` + `canon` are inside the hashed envelope; a silent change yields a *different, visible* id (test). |
| **Controlled-vocabulary drift** | Book → `bible.book.<osis>` via a frozen table; surface tokens never enter the hash. |
| **Unknown-field malleability** | Extension builds a closed, schema-validated locus; unknown fields never reach JCS. |
| **Number-encoding bugs** | chapter/verse must be small positive **integers** (no floats/strings/NaN) — rejected at the locus builder. |
| **Unicode / homograph attacks** | Aliases are US-ASCII only (rejected pre-parse); canonical tokens are controlled ASCII. |
| **Canon/versification collision** | Both are explicit fields → same book/ch/vs under different models hash differently. |
| **Cross-version confusion** | `…locus.v1` vs `…locus.v2` produce visibly different ids. |
| **Cross-primitive collision** | Distinct domain separators per layer (`canonical-locus-id` / `content-descriptor` / …). |
| **Fake issuer / replay-after-revoke** | `verifyContentDescriptor` fails closed on issuer ERC-1271 + `status!=='active'` + validity window; trust-profile issuer allowlist. |
| **Policy downgrade / over-trust of rights** | `accessPolicy`/`rightsStatus` are policy INPUTS; `evaluateEntitlement` + `resolveCandidates` decide; descriptors grant nothing (R5). |
| **Licensed-content / access-pattern leakage** | No text on-chain or in stored commitment preimage (R3); no copyrighted edition in source (R1, `check:no-licensed-content`). |

**Phase-1 conformance vectors (shipped as tests in `scripture-content-extension`):**
`John 3:16` = `john.3.16` = `Jn 3:16` = `OSIS:John.3.16` = `USFM:JHN 3:16` =
`scripture:john.3.16` → **same** id; `John 3:16` ≠ `John 3:15` ≠ `1John 3:16` ≠
(different versification) ≠ (different `locusProfile`); and unknown book /
translation-prefix / non-ASCII / out-of-range / non-integer → **reject**.
