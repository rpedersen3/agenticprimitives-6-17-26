# Spec 242 — Verifiable Credentials + Attestations (Agentic Trust)

**Status:** draft, 2026-06-02.
**Owner:** demo-jp.
**Number assignments:** spec **239** = Intent Spine, spec **241** = Agreement Registry (not yet drafted), spec **242** = this doc. The demo-jp upgrade trio is 239 / 241 / 242. 237 + 238 are unrelated existing waves.
**Owns spine layers:** 12 Artifact/Evidence (substrate), 13 Outcome, 14 Validation, 15 TrustUpdate — all as credential types in the same `AttestationRegistry` per [ADR-0023](../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md).
**Companion docs:** [apps/demo-jp/docs/information-architecture.md](../apps/demo-jp/docs/information-architecture.md) (§3a, §4a, §4b, §5.7, §9b, §10b); [apps/demo-jp/docs/packages.md](../apps/demo-jp/docs/packages.md) (§2, §3.2, §4a, §4b); [spec 239 — Intent Marketplace](239-intent-spine.md), [spec 241 — Agreement Registry](241-agreement-commitment-registry.md), [spec 243 — Payments](243-payments.md), [spec 244 — Fulfillment](244-fulfillment.md).
**Architecture-of-record:** [coordination-substrate.md](../docs/architecture/coordination-substrate.md) (15-layer reference; layers 12–15); [privacy-and-self-sovereign-identity.md](../docs/architecture/privacy-and-self-sovereign-identity.md) (D-42 per-field DisclosurePolicy; D-44 proof-type plurality; D-46 vault residency); [ADR-0023](../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md) (locks the `AttestationRegistry.sol` contract surface — supersedes any older surface notes below); [ADR-0024](../docs/architecture/decisions/0024-intent-coordination-substrate.md) (substrate decisions; Decision 2 = layers 12–15 are credential types not separate contracts); [ADR-0013](../docs/architecture/decisions/0013-no-silent-fallbacks.md), [ADR-0019](../docs/architecture/decisions/0019-relying-site-authority-is-a-scoped-delegation.md), [ADR-0021](../docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md).
**Industry references (mapped):** [EAS](https://docs.attest.org/) (deterministic UID, refUID, EIP-712 + ERC-1271 delegation, 4-indexed-topic events — ADOPTED); [Verax](https://docs.ver.ax/) (subject-as-flexible-bytes — ADOPTED; Portal + Module patterns — REJECTED); [W3C VC 2.0](https://www.w3.org/TR/vc-data-model-2.0/) + [VC StatusList2021](https://www.w3.org/TR/vc-status-list/) (envelope substrate); [ERC-5851](https://eips.ethereum.org/EIPS/eip-5851) (on-chain VC reference). Full adoption/divergence/addition matrix in [ADR-0023](../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md).

## 1. Purpose

`demo-jp` needs a **trust-signal substrate** with two cleanly separated tiers:

| Tier | What | Where it lives | Who reads |
|---|---|---|---|
| **Trust Credential** | A W3C-VC-shaped artifact issued by an authoritative agent (JP for Associations; Global Church for Agreements), held in the subject's vault. | Subject's vault (off-chain). | Whoever the holder shows it to. |
| **Trust Assertion** (optional) | A public on-chain claim by the holder: "I hold a credential of type T issued by issuer I, with hash H." | `AttestationRegistry` contract (on-chain). | Anyone. |

This spec covers the **whole trust surface**:

- The W3C-VC envelope + Eip712Signature2026 issuer signature.
- The DOLCE+DnS Situation pattern for credential subjects.
- SHACL Description shapes registered via `ontology.ShapeRegistry`.
- The `AttestationRegistry` contract surface (2 assertion variants + holder-only revocation).
- The bilateral-consent + delegation-as-permission-predicate path for joint agreement assertions (IA D-22 + D-23).
- Holder-only revocation semantics (IA D-18) + reconcilable issuer credential-status (off-chain).
- The two packages `@agenticprimitives/verifiable-credentials` and `@agenticprimitives/attestations`.

Out of W1: BBS+ selective-disclosure presentations (L-5), `issuerGroupRoot` Option B (L-2), additional credential types beyond Association + Agreement (L-10), sealed-mailbox credential delivery (L-11), third-party joint assertions (L-12), PrivateZK visibility tier (L-16).

## 2. Reference: smart-agent patterns to port (REQUIRED)

Per CLAUDE.md ("Always check smart-agent first"), spec 242 ports the credential + attestation patterns from `/home/barb/smart-agent` (branch `003-intent-marketplace-proposal`).

### 2.1 Patterns ported wholesale

| Pattern | smart-agent location | Why we port | Where it lands here |
|---|---|---|---|
| W3C VC envelope + Eip712 signature | smart-agent's credential infrastructure across `/packages/credential-registry/`, `/packages/sdk/src/credentials.ts` | The canonical VC shape with an EIP-712 issuer proof binds cleanly to our ERC-1271 / userOp signing model. | §4, §6 |
| DOLCE+DnS Situation as `credentialSubject` | `/docs/specs/marketplace-lifecycle-alignment.md` (UFO-C social-contract layer: `ExchangeAgreement` ⩭ `ufo:SocialRelator`) + smart-agent's recipe of reifying relationships as Situations | The reified-relationship pattern (Situation satisfying Description with Roles + Participants) is the lingua franca of the agentic ontology stack. Lets a single credential type generalize across domains. | §5 |
| Owner-routed credential vault (P4: no duplication) | `/docs/information-architecture/10-intent-marketplace-classification.md` § 1 invariant P4 | The credential body lives in the subject's MCP (demo-jp: localStorage). On-chain assertions reference the hash; full body NEVER lives on-chain except where the holder explicitly chooses public visibility on the assertion. | §6.4, §8 |
| Holder-controls-public-disclosure | `/docs/specs/marketplace-lifecycle-alignment.md` (`ClaimRight` lives in the claim-holder's MCP) | The holder decides whether to make a credential public (via Trust Assertion). Issuer governs CREDENTIAL status (revocation list) but cannot reach in and erase the holder's ASSERTION. | §8.3, §10 |
| Holder-only revocation of public claims | smart-agent's claim-right ownership model | Once a holder makes a public claim, only they can take it down. Issuer revoking the underlying credential changes its STATUS but doesn't remove the holder's CLAIM from the public surface. Verifier reconciles. | §10 |
| Delegation as authorization predicate (not as execution path) | smart-agent's cross-delegation pattern in `/docs/information-architecture/15-delegation-design-architecture.md` (Tier-3) | The delegation primitive is a signed scoped grant. We REUSE the EIP-712 + caveat-enforcer infrastructure to enforce bilateral consent on joint assertions without redeeming the delegation as cross-account execution. | §9 |
| Visibility tiers (5-tier model) | `/docs/information-architecture/10-intent-marketplace-classification.md` § 3 | Same five tiers as spec 239 (Public / PublicCoarse / PrivateCommitment / PrivateZK / OffchainOnly). Credentials default to private-commitment; assertions are public by construction. | §8.1 |
| SHACL invariants on credential structure | smart-agent ontology audit `/docs/ontology/INTENT_MARKETPLACE_AUDIT.md` + cbox shapes | Cardinality + range constraints on credential envelope, Situation shape, assertion shape. | §11 |
| Status-list-based credential revocation | smart-agent's revocation list pattern (W3C Status List 2021 compatible) | Issuer publishes a revocation status list; verifier checks both the on-chain assertion AND the status list. Decouples public claim from current validity. | §10 |

### 2.2 Patterns deliberately NOT ported (with reasoning)

| smart-agent pattern | Why we diverge here |
|---|---|
| AnonCreds + BBS+ selective-disclosure presentations | Out of W1; deferred to L-5. Would introduce BLS12-381 curve infrastructure alongside our P-256 passkey + secp256k1 EOA stack — two curve worlds. Defer until selective disclosure is product-justified. |
| ZK-proof-of-credential-existence (PrivateZK tier) | Deferred to L-16. Requires ZK overlay (L-4); independent of this spec. |
| MCP-server-side credential delivery (sealed mailbox between SAs) | demo-jp ships in-process credential delivery for W1 (issuer hands cred to holder via direct call within the same browser session). Sealed-mailbox between Org SAs is L-11. |
| HCS-N mirror of the assertion registry | Out of W1; deferred until after `hcs-standards-advisor` review of the assertion shape against HCS-2 / HCS-20. |
| Issuer credential-revocation registry on-chain | Issuer revocation lives off-chain (status list); the on-chain assertion stays. Smart-agent ships both patterns; for W1 we ship only off-chain status to keep the issuer free of on-chain dependencies. |

### 2.3 Architectural alignment

The trust feature sits in the UFO-C social-contract layer of the ontology stack, alongside `ExchangeAgreement` / `FulfillmentCommitment` / `ClaimRight`:

```
Intent Spine (spec 239) — Marketplace layer (ValueFlows)
       ↓
Commitment (spec 239's hand-off into 241)
       ↓
Agreement Credential (THIS SPEC, issued by Global Church) — UFO-C social-contract
       ↓
Agreement Commitment on-chain (spec 241)
       ↓ (optional)
Joint Agreement Assertion (THIS SPEC, on-chain)
```

Association credentials sit parallel to that flow:

```
Org onboarding (IA §4a)
       ↓
JpAssociationCredential (THIS SPEC, issued by JP)
       ↓ (optional)
Association Assertion (THIS SPEC, on-chain)
```

## 3. The journey

### 3.1 Association credential journey

**Maria** controls a Facilitator Org SA. She onboards with JP per IA §4a:

1. Maria deploys her Org SA and registers `frontier-path-network.impact`.
2. Maria fills in her org's coverage payload (FPGs, capacity matrix, MOU acceptance receipt) and signs an `AssociationRequest`.
3. JP receives the request, reviews (auto-approve in W1 demo), and issues a `JpAssociationCredential` to Maria.
4. Maria's Org vault now holds the full VC. She can present it to any verifier who asks.
5. Maria optionally chooses to publish a `TrustAssertion` — a public on-chain row that says "Frontier Path Network holds a JpFacilitatorAssociationCredential issued by JP, hash X, valid from T1." Maria's website now shows a JP-Verified badge that resolves on-chain.
6. A skeptical verifier reads the on-chain assertion, asks Maria for the VC body off-chain, recomputes `keccak256(canonical(VC))`, checks it equals the on-chain `credentialHash`, verifies JP's EIP-712 signature via JP SA's ERC-1271, and **also** checks JP's off-chain credential status list to make sure the credential hasn't been revoked.

### 3.2 Agreement credential + joint assertion journey

**Sam** (Adopter Org) and **Maria** sign a Commitment per spec 239 §4d. Both signed the canonical agreement with `publicDisclosureStance: pre-authorized`:

1. JP forwards the dual-signed Commitment to Global Church.
2. Global Church verifies, issues an `AgreementCredential` to BOTH parties, writes the commitment to spec 241's `AgreementRegistry`.
3. Each party's vault now holds the full VC.
4. Some weeks later, Sam decides to publish their joint partnership. Sam composes a `JointAgreementAssertion`. Because both stances were `pre-authorized` at creation, no fresh delegations are needed.
5. Sam submits the assertion. The on-chain row names BOTH Sam and Maria as parties (bilateral by construction per IA D-22).
6. A verifier reads the joint assertion, reads the commitment-registry row it references, checks both parties' reveal proofs reconstitute the commitment, and verifies Global Church's signature on the underlying credential.

### 3.3 What if Maria's stance was `requires-fresh-consent`?

Same flow as 3.2 step 4, except Sam must first request a fresh delegation from Maria authorizing this specific assertion. Maria reviews, signs a scoped `assertJointAgreement` delegation pinned via `CalldataHashEnforcer` to the exact assertion bytes (per IA D-23). Sam attaches it to the submission. The on-chain row still names both parties; the registry verifies Maria's delegation as the authorization predicate (no cross-account execution; D-23 locked).

### 3.4 What if Maria's stance was `strictly-confidential`?

Sam cannot publish a joint assertion at all. The registry refuses at the contract layer (per IA D-22 vocabulary). Sam can still privately show their own copy of the credential off-chain to any verifier of their choosing — but the on-chain public surface remains empty.

## 4. The credential envelope

### 4.1 W3C VC shape with Eip712Signature2026 proof

```jsonc
{
  "@context": [
    "https://www.w3.org/2018/credentials/v1",
    "https://agenticprimitives.org/context/v1"
  ],
  "type": ["VerifiableCredential", "<CredentialClass>"],
  "issuer": "did:agent:<issuer>.impact",
  "issuanceDate": "2026-06-01T00:00:00Z",
  "credentialSubject": {
    // DOLCE+DnS Situation — see §5
  },
  "credentialSchema": {
    "id": "did:shape:<ShapeName>:v1",
    "type": "ShaclShape",
    "schemaHash": "0x..."           // keccak256 of canonical SHACL bytes
  },
  "credentialStatus": {
    "id": "https://<issuer>/credentials/status-list/v1#<index>",
    "type": "StatusList2021Entry",
    "statusPurpose": "revocation",
    "statusListIndex": "<int>",
    "statusListCredential": "https://<issuer>/credentials/status-list/v1"
  },
  "proof": {
    "type": "Eip712Signature2026",
    "verificationMethod": "did:agent:<issuer>.impact#erc1271",
    "created": "2026-06-01T00:00:00Z",
    "domain": {
      "name": "<CredentialClass>",
      "version": "1",
      "chainId": 84532
    },
    "primaryType": "<CredentialClass>",
    "signature": "0x..."             // EIP-712 over canonical(credential without proof)
  }
}
```

### 4.2 Two concrete credential classes for W1

| Class | Issuer | Subject | Holder | Used in |
|---|---|---|---|---|
| `JpAssociationCredential` | JP SA | Facilitator Org SA or Adopter Org SA | The Org's vault | IA §4a onboarding |
| `AgreementCredential` | Global Church SA | Both party SAs | Each party's vault | IA §4c + spec 241 issuance |

Both are instances of the W3C VC envelope above; they differ in their `type` discriminator, their `credentialSubject` Situation shape, and the issuer/subject roles.

### 4.3 Canonical JSON for hashing

The credential hash MUST be deterministic across stacks. Smart-agent uses a JCS-compatible canonical JSON (RFC 8785). We adopt the same:

```ts
function credentialHash(credentialWithoutProof: object): Hex {
  const canonical = canonicalJSON(credentialWithoutProof);  // RFC 8785
  return keccak256(canonical);
}
```

Three hashes flow on-chain (assertion registry references all three):

```
credentialHash = keccak256(canonical(credential WITHOUT proof field))
situationHash  = keccak256(canonical(credentialSubject))
schemaHash     = keccak256(canonical(SHACL Description))   // ontology-registered
```

**Invariant CR-01:** `credentialHash` MUST be reproducible from the canonical bytes of `(credential without proof)` independent of property ordering, whitespace, or string-escape variants. TypeScript implementation + Solidity helper (for in-contract verification when needed) MUST agree byte-for-byte. Cross-stack test gate.

### 4.4 EIP-712 typed-data domain

Each credential class has its own EIP-712 domain:

```
domain = {
  name:    "<CredentialClass>",      // e.g. "JpAssociationCredential", "AgreementCredential"
  version: "1",
  chainId: 84532,                    // Base Sepolia
  // verifyingContract intentionally omitted — the credential is off-chain;
  // verification is via the issuer's ERC-1271 implementation on the SA
}
```

The issuer signs the EIP-712 hash of `(credential without proof)`. The proof field carries the resulting signature.

**Invariant CR-02:** The on-chain `schemaHash` MUST equal the hash of the SHACL Description registered via `ontology.ShapeRegistry`. SDK helper `verifyCredential(...)` looks up the schema via the registry and rejects credentials whose `credentialSchema.id` resolves to a different bytes hash than the EIP-712-signed `schemaHash`.

## 5. The DOLCE+DnS Situation pattern for `credentialSubject`

### 5.1 Description / Situation / Roles / Participants

```turtle
# Description (defines the social/normative frame)
demo:JpFacilitatorAssociationDescription
  rdfs:subClassOf dul:Description ;
  dul:defines     demo:JpRelator, demo:Member, demo:AssociationKind ;
  dul:requires    [
    sh:property  demo:JpRelator     ; sh:hasValue jp.impact ;
    sh:property  demo:Member        ; sh:class    sa:OrgAgent ;
    sh:property  demo:AssociationKind ; sh:in (demo:Facilitator demo:Adopter) ;
  ] .

# Situation (specific instance satisfying the Description)
<credentialSubject>
  a               dul:Situation ;
  dul:satisfies   demo:JpFacilitatorAssociationDescription ;
  dul:hasParticipant
    [ a demo:Participant ; demo:role demo:JpRelator ; demo:agent jp.impact ] ,
    [ a demo:Participant ; demo:role demo:Member    ; demo:agent <Org-SA> ] ;
  demo:associationKind demo:Facilitator ;
  demo:validFrom       "2026-06-01T00:00:00Z" ;
  demo:validUntil      null .
```

### 5.2 The same pattern for AgreementCredential

```turtle
demo:AgentCollaborationAgreementDescription
  rdfs:subClassOf dul:Description ;
  dul:defines     demo:AdopterRole, demo:FacilitatorRole, demo:IssuerRole, demo:TermsHash ;
  dul:requires    [
    sh:property  demo:AdopterRole       ; sh:class sa:Agent ;
    sh:property  demo:FacilitatorRole   ; sh:class sa:Agent ;
    sh:property  demo:IssuerRole        ; sh:hasValue global-church.impact ;
    sh:property  demo:TermsHash         ; sh:datatype xsd:hexBinary ;
  ] .

<credentialSubject>
  a              dul:Situation ;
  dul:satisfies  demo:AgentCollaborationAgreementDescription ;
  dul:hasParticipant
    [ a demo:Participant ; demo:role demo:AdopterRole      ; demo:agent <Adopter-SA>    ],
    [ a demo:Participant ; demo:role demo:FacilitatorRole  ; demo:agent <Facilitator-SA>],
    [ a demo:Participant ; demo:role demo:IssuerRole        ; demo:agent global-church.impact ] ;
  demo:termsHash         "0x..." ;
  demo:validFrom         "2026-06-01T00:00:00Z" ;
  demo:validUntil        "2027-06-01T00:00:00Z" ;
  demo:publicDisclosureStance  { adopter: "pre-authorized", facilitator: "requires-fresh-consent" } .
```

### 5.3 SHACL Description shapes — generic vs JP-vertical

| Description shape | Lives in | Owns it |
|---|---|---|
| `AgentCollaborationAgreementDescription` | Package `@agenticprimitives/verifiable-credentials` (generic substrate) | Spec 242 + spec 241 share custody |
| `JpFacilitatorAssociationDescription` | App `apps/demo-jp/src/lib/jp-shapes.ts` (JP-vertical — vocabulary firewall) | demo-jp app |
| `JpAdopterAssociationDescription` | Same | demo-jp app |

The generic substrate ships the `Description` + `Situation` + `Participant` + `Role` base classes; JP-vertical Descriptions inherit. ADR-0021 vocabulary firewall: `Facilitator`, `Adopter`, `FPG`, `MOU` words stay in the app layer.

### 5.4 Schema registration

**Drift note (2026-06-02):** the on-chain `ShapeRegistry` (`packages/contracts/src/ontology/ShapeRegistry.sol`) is **governance-gated** and uses **structured `PropertyConstraint[]`** plus a `shapeURI` string and a `shapeHash` byte32 commitment — NOT opaque-SHACL-bytes registration. PD-12's convention is refined accordingly:

- Off-chain `credentialSchema.id` is the **`shapeURI`** string (e.g. `"https://agenticprimitives.org/ontology/credentials#AgentCollaborationAgreementDescription"`).
- Off-chain `credentialSchema.schemaHash` is `keccak256(canonical(SHACL))`.
- On-chain `ShapeRegistry._shapes[classId].shapeURI` equals the off-chain `credentialSchema.id`.
- On-chain `_shapes[classId].shapeHash` equals the off-chain `credentialSchema.schemaHash`.
- `classId = keccak256(shapeURI)` (deterministic — verifier recomputes locally).

`packages/verifiable-credentials/src/schema-registration.ts` exports the registration helper:

```ts
async function registerCredentialSchema(opts: {
  shaclSource: string;               // raw SHACL turtle
  shapeURI: string;                  // e.g. https://agenticprimitives.org/ontology/credentials#...
  propertyConstraints: PropertyConstraint[];  // SHACL → constraints lowering done off-chain
  registry: Address;
  governor: WalletClient;            // governance-gated; only governor can call defineShape
}): Promise<{ classId: Hex; shapeHash: Hex; txHash: Hex }> {
  const shaclBytes = canonicalizeShacl(opts.shaclSource);
  const shapeHash  = keccak256(shaclBytes);
  const classId    = keccak256(toUtf8Bytes(opts.shapeURI));
  // governor calls ShapeRegistry.defineShape(classId, propertyConstraints, shapeURI, shapeHash)
  const txHash = await opts.governor.writeContract({
    address: opts.registry,
    abi: ShapeRegistryAbi,
    functionName: 'defineShape',
    args: [classId, opts.propertyConstraints, opts.shapeURI, shapeHash],
  });
  return { classId, shapeHash, txHash };
}
```

Because registration is governance-gated, it's **one-time at chain bootstrap**, not per-app-deploy. demo-jp's first-deploy script includes a single governor-signed transaction that registers `AgentCollaborationAgreementDescription` (substrate) and the two JP-vertical Descriptions (`JpFacilitatorAssociationDescription`, `JpAdopterAssociationDescription`). Subsequent app deploys read the on-chain shape; they don't re-register.

**Invariant CR-03 (refined):** A credential's `credentialSchema.id` MUST equal the on-chain `_shapes[classId].shapeURI` where `classId = keccak256(credentialSchema.id)`, AND `credentialSchema.schemaHash` MUST equal `_shapes[classId].shapeHash`, AND off-chain `keccak256(canonical SHACL)` MUST equal `credentialSchema.schemaHash`. Three-way lockstep. SDK `verifyCredential()` enforces.

## 6. The `AttestationRegistry` contract

Lives at **`packages/contracts/src/attestation/AttestationRegistry.sol`**.

### 6.1 Public surface

```solidity
contract AttestationRegistry {
    // --- ASSOCIATION ASSERTIONS (holder of the credential surfaces it publicly) ---

    struct AssociationAssertion {
        address subject;              // the holder/asserter (= credentialSubject's Member role)
        bytes32 credentialType;       // keccak256("JpFacilitatorAssociationCredential:v1") etc.
        address issuer;               // public per Option A (e.g. JP SA)
        bytes32 credentialHash;       // keccak256(canonical(VC without proof))
        bytes32 schemaHash;           // keccak256(canonical(SHACL Description))
        uint64  validFrom;
        uint64  validUntil;           // 0 = open-ended
        uint64  assertedAtEpochBucket;
        bytes32 statusCommitment;     // committed status field; updated on holder-revoke
    }

    function assertAssociation(AssociationAssertion calldata a) external;
    function revokeOwnAssociation(bytes32 assertionId) external;
    function isActive(bytes32 assertionId) external view returns (bool);
    function getAssertion(bytes32 assertionId) external view returns (AssociationAssertion memory);

    // --- JOINT AGREEMENT ASSERTIONS (bilateral per IA D-22) ---

    struct JointAgreementAssertion {
        address adopter;              // both parties named on-chain
        address facilitator;
        bytes32 credentialType;       // keccak256("AgreementCredential:v1")
        address issuer;               // Global Church SA
        bytes32 credentialHash;
        bytes32 agreementCommitment;  // back-ref into AgreementRegistry (spec 241)
        bytes32 adopterRevealProof;
        bytes32 facilitatorRevealProof;
        bytes   adopterConsent;       // empty when pre-authorized; delegation when fresh-consent
        bytes   facilitatorConsent;   // same; either side
        uint64  assertedAtEpochBucket;
        bytes32 statusCommitment;
    }

    function assertJointAgreement(JointAgreementAssertion calldata a) external;
    function revokeOwnJointAgreement(bytes32 assertionId) external;        // either party can revoke (D-26)

    // --- View ---

    function assertionIdOf(...) external pure returns (bytes32);
    function nullifierConsumed(bytes32 nullifier) external view returns (bool);

    // --- Events ---

    event AssociationAsserted(bytes32 indexed assertionId, address indexed subject, address indexed issuer, bytes32 credentialType);
    event AssociationRevoked(bytes32 indexed assertionId, address indexed revoker);
    event JointAgreementAsserted(bytes32 indexed assertionId, address indexed adopter, address indexed facilitator, bytes32 agreementCommitment);
    event JointAgreementRevoked(bytes32 indexed assertionId, address indexed revoker);
}
```

### 6.2 What's NOT in the surface

- **No `issuerRevoke` function** anywhere. IA D-18 locked: only the holder can take down their on-chain assertion. Issuer revocation lives off-chain via the credential status list (§10).
- **No upgrade authority.** PD-2 locked: non-upgradeable in W1. New deployments per version.
- **No batch ops** (multi-assertion submit, bulk revoke). Smart-agent doesn't ship batched-revocation either; per-assertion calls keep audit emission per-row.
- **No third-party assertion function.** L-12 deferred; not in W1's contract surface.

### 6.3 `assertionId` derivation

```
For AssociationAssertion:
    assertionId = keccak256(abi.encode(
        subject,
        credentialType,
        issuer,
        credentialHash
    ))

For JointAgreementAssertion:
    assertionId = keccak256(abi.encode(
        adopter,
        facilitator,
        credentialType,
        issuer,
        credentialHash,
        agreementCommitment
    ))
```

**Invariant TA-01:** A given (subject, credentialType, issuer, credentialHash) tuple MUST have at most one ACTIVE association assertion at a time. Re-asserting after revocation is allowed (new row with same id, statusCommitment changes via nullifier path).

**Invariant TA-02:** A given (adopter, facilitator, credentialType, issuer, credentialHash, agreementCommitment) tuple MUST have at most one ACTIVE joint assertion at a time.

### 6.4 Storage shape

```solidity
mapping(bytes32 => AssociationAssertion)     internal associationAssertions;
mapping(bytes32 => JointAgreementAssertion)  internal jointAgreementAssertions;
mapping(bytes32 => bool)                     internal nullifierSet;
mapping(bytes32 => uint256)                  internal assertionStatusVersion;  // monotonic per assertion
```

### 6.5 Verification logic — joint agreement consent paths

```solidity
function assertJointAgreement(JointAgreementAssertion calldata a) external {
    // 0. Read stance tuple bound in the credential.
    // Practically: caller submits (adopterStance, facilitatorStance, adopterStanceSig, facilitatorStanceSig);
    //              contract verifies both ERC-1271 sigs cover (commitmentHash, stancesTuple),
    //              confirming the stances are what the credential bound at agreement-time.

    // 1. Refuse strictly-confidential.
    require(adopterStance != STRICTLY_CONFIDENTIAL, "adopter strictly confidential");
    require(facilitatorStance != STRICTLY_CONFIDENTIAL, "facilitator strictly confidential");

    // 2. For each party, either accept pre-authorization or validate fresh delegation.
    if (adopterStance == PRE_AUTHORIZED) {
        require(a.adopterConsent.length == 0, "pre-authorized: no fresh consent");
    } else {
        // requires-fresh-consent: validate via DelegationManager (PD-9 entrypoint).
        DelegationManager(dm).verifyAuthorization(
            decodeDelegation(a.adopterConsent),
            /* delegator   */ a.adopter,
            /* targetCheck */ address(this),
            /* method      */ this.assertJointAgreement.selector,
            /* calldataPin */ keccak256(msg.data),
            /* now         */ block.timestamp
        );
    }
    if (facilitatorStance == PRE_AUTHORIZED) {
        require(a.facilitatorConsent.length == 0, "pre-authorized: no fresh consent");
    } else {
        DelegationManager(dm).verifyAuthorization(decodeDelegation(a.facilitatorConsent), /* ...same shape... */);
    }

    // 3. Verify reveal proofs reconstitute the agreementCommitment in AgreementRegistry.
    require(verifyRevealAgainstCommitment(a), "reveal proof mismatch");

    // 4. Insert; emit JointAgreementAsserted; increment statusVersion.
    bytes32 id = jointAgreementAssertionId(a);
    require(!isActiveJoint(id), "TA-02: already active");
    jointAgreementAssertions[id] = a;
    assertionStatusVersion[id] += 1;
    emit JointAgreementAsserted(id, a.adopter, a.facilitator, a.agreementCommitment);
}
```

### 6.6 Holder/party revocation

```solidity
function revokeOwnAssociation(bytes32 assertionId) external {
    AssociationAssertion storage a = associationAssertions[assertionId];
    require(msg.sender == a.subject, "TA-revoker: not the holder");
    require(isActive(assertionId), "TA-revoker: already revoked");
    a.statusCommitment = REVOKED;
    assertionStatusVersion[assertionId] += 1;
    emit AssociationRevoked(assertionId, msg.sender);
}

function revokeOwnJointAgreement(bytes32 assertionId) external {
    JointAgreementAssertion storage a = jointAgreementAssertions[assertionId];
    require(msg.sender == a.adopter || msg.sender == a.facilitator, "TA-revoker: not a party");
    require(isActiveJoint(assertionId), "TA-revoker: already revoked");
    a.statusCommitment = REVOKED;
    assertionStatusVersion[assertionId] += 1;
    emit JointAgreementRevoked(assertionId, msg.sender);
}
```

D-26 locked: either party of a joint assertion can unilaterally revoke. Re-asserting requires re-obtaining bilateral consent per D-22.

## 7. Package surface

### 7.1 `@agenticprimitives/verifiable-credentials`

```
packages/verifiable-credentials/
  src/
    index.ts
    vc-envelope.ts                — W3C-VC types + RFC 8785 canonical JSON + credentialHash()
    eip712-signature.ts           — Eip712Signature2026 proof type; signing + verifying helpers
    situation.ts                  — DOLCE+DnS Situation / Description / Roles / Participants types
    schema-registration.ts        — register a Description SHACL shape via ontology.ShapeRegistry (PD-12 convention)
    vault-store.ts                — generic vault-side load/store helpers per holder/per credentialType
    verifier.ts                   — verifier-side validation: signature → recompute hashes → status-list check
    abi.ts                        — type-only re-exports of any ABI needed for ShapeRegistry reads
  test/
    unit/
      vc-envelope.test.ts         — canonical JSON determinism (cross-stack); credentialHash round-trip
      situation.test.ts           — DOLCE+DnS shape conformance against the base SHACL shapes
      verifier.test.ts            — 12 cases: ok / bad-sig / bad-schema / status-revoked / expired / unknown-issuer / ...
  capability.manifest.json
  CLAUDE.md, AUDIT.md, README.md
  package.json
```

Allowed imports:
- `@agenticprimitives/types`
- `@agenticprimitives/agent-account` (type-only — Address types)
- `viem` (canonical encoding + crypto)

Forbidden:
- `@agenticprimitives/attestations` (sibling)
- `@agenticprimitives/agreements` (sibling)
- anything JP-specific (vocabulary firewall)

### 7.2 `@agenticprimitives/attestations`

```
packages/attestations/
  src/
    index.ts
    typed-data.ts                 — EIP-712 domain + types for AssociationAssertion + JointAgreementAssertion
    abi.ts                        — Solidity ABI mirror (lockstep gate)
    client.ts                     — TrustAssertionClient (readContract for status + record reads)
    encoders.ts                   — encodeAssociationAssertion, encodeJointAgreementAssertion
    bilateral-consent.ts          — helpers for building / verifying / packing the delegation-as-permission predicate (D-23)
    revocation.ts                 — holder-revoke encoder + either-party-revoke encoder for joint
                                    NO issuer-revoke encoder (D-18)
    assertion-id.ts               — assertionIdOf computations (matches contract §6.3)
  test/
    unit/
      typed-data.test.ts          — round-trip + cross-stack typehash equality
      bilateral-consent.test.ts   — pre-authorized vs. requires-fresh-consent path coverage
      revocation.test.ts          — replay-prevention via the nullifier set
      issuer-cannot-revoke.test.ts — explicit regression: any encoder that produces an issuer-revoke call MUST not exist
  capability.manifest.json
  CLAUDE.md, AUDIT.md, README.md
  package.json
```

Allowed imports:
- `@agenticprimitives/types`
- `@agenticprimitives/agent-account` (type-only)
- `@agenticprimitives/delegation` (type-only — bilateral-consent predicate shape)
- `@agenticprimitives/verifiable-credentials` (type-only — credential type identifiers + hash)
- `viem`

Forbidden:
- `@agenticprimitives/agreements` (sibling — the contracts reference each other at the contract layer; SDKs do not)
- anything JP-specific

### 7.3 Dependency graph slot

Per packages.md §7:

```
agent-account → verifiable-credentials → agreements (type-only) → attestations
                  ▲                       ▲                            ▲
                  │ (type-only)           │ (type-only)                 │
                  │                       │                             │
              (sibling level, all under agent-account; intent-marketplace slots between as well)
```

## 8. Visibility, vault storage, and the owner-routed canonical state

### 8.1 Default visibility tiers per artifact

| Artifact | Default visibility | Why |
|---|---|---|
| `JpAssociationCredential` (full body) | `PrivateCommitment` | Vault-held; never on-chain unless holder asserts |
| `AgreementCredential` (full body) | `PrivateCommitment` | Same |
| Association Assertion (row on-chain) | `Public` | The whole point of an assertion is public visibility |
| Joint Agreement Assertion (row on-chain) | `Public` | Same |
| Credential status list | `Public` (off-chain at issuer's URI) | W3C StatusList2021 convention |

### 8.2 Vault key conventions

```
agenticprimitives:demo-jp:trust-credential:<holderSA>:<credentialType>:<credentialHash>
agenticprimitives:demo-jp:trust-assertion:<assertionId>            (mirror of on-chain row for fast UI)
```

The holder's vault is the canonical source of the credential body. The on-chain assertion is a public POINTER plus hash. Verifiers MUST fetch the body from the holder (off-chain) AND check the on-chain hash matches AND check the off-chain status list. Three reads, one mechanism each per ADR-0013.

### 8.3 Visibility doesn't move once set

Once a credential is issued at `PrivateCommitment`, the holder cannot retroactively change the credential's visibility without re-issuance. The holder CAN, separately, surface a public assertion of that credential — but the credential body itself stays at private. Symmetric: the issuer cannot retroactively change a credential to public visibility either. The credential is immutable once signed.

## 9. Bilateral consent via delegation (joint agreement path)

The `requires-fresh-consent` path is implemented as a reuse of the existing `@agenticprimitives/delegation` primitive, NOT as a one-off "permission" object (D-23 locked).

### 9.1 Delegation shape for joint-assertion consent

```ts
const consentDelegation = {
  delegator: consentingPartySA,     // adopter or facilitator
  delegate:  submitterSA,           // whoever physically submits (could be third-party relayer)
  authority: ROOT_AUTHORITY,
  caveats: [
    {
      enforcer: AllowedTargetsEnforcer,
      terms:    encode(AttestationRegistry.address)
    },
    {
      enforcer: AllowedMethodsEnforcer,
      terms:    encode([AttestationRegistry.assertJointAgreement.selector])
    },
    {
      enforcer: TimestampEnforcer,
      terms:    encode(validAfter, validUntil)
    },
    {
      enforcer: CalldataHashEnforcer,
      terms:    encode(keccak256(exact_assertion_calldata))
    }
  ],
  salt: random32(),
  signature: consentingParty.signEip712(delegationHash)
};
```

### 9.2 `DelegationManager.verifyAuthorization` (PD-9 new entrypoint)

**Drift note (2026-06-02):** `DelegationManager.sol` confirmed to NOT have a `verifyAuthorization` entrypoint today. The closest existing internal is `_validateDelegation(...)` which dispatches caveat enforcers and verifies the EIP-712 signature; the public surface today exposes only `redeemDelegation(...)`, `revokeDelegationByOwner(...)`, `isRevoked(...)`, and `hashDelegation(...)`. PD-9 lifts the internal dispatch into a public view-only function:

```solidity
function verifyAuthorization(
    Delegation calldata d,
    address delegator,         // who must have signed
    address target,            // expected target
    bytes4  method,            // expected selector
    bytes32 calldataPin,       // keccak256 of the exact calldata
    uint256 nowTs              // for TimestampEnforcer
) external view returns (bool ok, string memory reason);
```

The view-only entrypoint does NOT redeem the delegation as cross-account execution. It runs the **same** EIP-712 sig + caveat-enforcer dispatch (`_validateDelegation`) the normal redemption path runs; returns ok/reason. `AttestationRegistry.assertJointAgreement` calls this once per `requires-fresh-consent` party.

Implementation note: factor the existing `_validateDelegation` body into a shared internal that both `redeemDelegation` and `verifyAuthorization` call, so behavior parity is guaranteed by construction (not just by tests).

**Invariant TA-03:** `DelegationManager.verifyAuthorization` MUST share its caveat-enforcer dispatch with the normal redemption path (same shared internal). Drift between the two paths is forbidden. Tested by a regression test that asserts a malicious caveat rejected by redemption is also rejected by verifyAuthorization, and vice versa.

### 9.3 What this gives us

| Property | Delivered by |
|---|---|
| Bilateral consent on `requires-fresh-consent` | One delegation per consenting party with `CalldataHashEnforcer` pinning |
| Time-windowed authorization | `TimestampEnforcer` caveat |
| Replay prevention | `CalldataHashEnforcer` (each assertion gets unique bytes); `assertionStatusVersion` monotonic |
| Revocation of consent | `DelegationManager.revoke(delegationHash)` — standard primitive |
| Audit trail | `DelegationManager`'s existing audit-emission sinks |

## 10. Revocation semantics — the holder/issuer split

### 10.1 Two surfaces, two flows (IA D-18 locked)

| Surface | Who controls | How |
|---|---|---|
| **Off-chain credential status** | Issuer | W3C StatusList2021 list at `https://<issuer>/credentials/status-list/v1`; the credential's `credentialStatus.statusListIndex` points to a bit in that list. Issuer flips the bit; verifiers re-check on every verification. |
| **On-chain trust assertion** | Holder (or either party for joint) | `revokeOwnAssociation(assertionId)` / `revokeOwnJointAgreement(assertionId)` |

These are intentionally decoupled. The issuer cannot reach in and erase the holder's on-chain assertion; the holder cannot fake a revocation of the issuer's credential.

### 10.2 The verifier reconciles

A correct verifier MUST check BOTH:

```ts
async function verifyTrustClaim(assertionId: bytes32, holder: Address): Promise<VerificationResult> {
  // 1. Read on-chain assertion (AttestationRegistry)
  const assertion = await registry.getAssertion(assertionId);
  if (assertion.statusCommitment === REVOKED) return { valid: false, reason: 'assertion revoked by holder' };

  // 2. Fetch the credential body from the holder off-chain
  const vc = await holder.presentCredential(assertion.credentialType);

  // 3. Check the credential's hash matches the on-chain assertion
  const computedHash = credentialHash(vc);
  if (computedHash !== assertion.credentialHash) return { valid: false, reason: 'credential hash mismatch' };

  // 4. Verify issuer's EIP-712 signature on the credential
  const sigValid = await verifyIssuerSig(vc, assertion.issuer);
  if (!sigValid) return { valid: false, reason: 'issuer signature invalid' };

  // 5. Check the schema matches the ontology registration (CR-03)
  const schemaOk = await verifySchemaRegistration(vc);
  if (!schemaOk) return { valid: false, reason: 'schema not registered or hash mismatch' };

  // 6. Check off-chain credential status list (issuer-controlled)
  const status = await fetchCredentialStatus(vc.credentialStatus);
  if (status.revoked) return { valid: false, reason: 'credential revoked by issuer' };

  return { valid: true };
}
```

Step 6 is what catches stale assertions: the holder may have asserted a credential publicly, and not self-revoked, BUT the issuer revoked the underlying credential. The verifier sees the on-chain row as ACTIVE but the off-chain status as REVOKED — verification returns invalid. This is the reconciliation the IA promised.

### 10.3 What the holder MUST do when they receive a revocation notice

Best-practice UX (demo-jp implements this):

```
Issuer publishes a revocation entry for credential X
       ↓ (off-chain notification, OR holder polls status list periodically)
Holder's vault flags the credential as revoked
       ↓
Holder's UI surfaces: "Your credential X has been revoked by the issuer. Your public
assertion on-chain is now stale. Recommend: self-revoke the assertion to keep your
public surface honest. [Self-revoke] [Acknowledge]"
       ↓
Holder clicks Self-revoke → revokeOwnAssertion(assertionId) → on-chain row goes inactive
```

This is good citizenship; the contract doesn't enforce it. But the UX nudges toward it.

## 11. Tests + invariants

| Test | Pass criterion |
|---|---|
| **CR-01: credentialHash determinism** | Same VC bytes produce the same keccak256 across ts + Solidity helpers, regardless of property ordering. |
| **CR-02: schemaHash equality** | The EIP-712-signed `credentialSchema.schemaHash` equals `keccak256(SHACL bytes registered in ShapeRegistry)`. |
| **CR-03: schema registration round-trip** | A credential's `credentialSchema.id` resolves via registry to SHACL bytes whose hash equals `credentialSchema.schemaHash`. |
| **TA-01: one active association** | Re-asserting the same (subject, type, issuer, credentialHash) while active reverts; revoke + re-assert succeeds. |
| **TA-02: one active joint** | Same for (adopter, facilitator, type, issuer, credentialHash, agreementCommitment). |
| **TA-03: verifyAuthorization parity** | A caveat config that's rejected by redemption is also rejected by `verifyAuthorization`. Run as parallel-path regression. |
| **TA-04: no issuer-revoke entrypoint** | Static check: contract source has NO function that allows a non-subject / non-party to revoke an assertion. Test asserts the ABI surface. |
| **TA-05: bilateral pre-authorized** | Both stances pre-authorized → assertJointAgreement succeeds with both `*Consent` empty. |
| **TA-06: bilateral fresh consent** | Both stances requires-fresh-consent → submission requires both delegations; missing one → revert. |
| **TA-07: strictly-confidential blocks** | Either stance strictly-confidential → submission reverts at top of function. |
| **TA-08: D-26 either party revokes** | Joint assertion: either adopter OR facilitator can self-revoke; non-party MUST revert. |
| **TA-09: holder-only association revoke** | Association assertion: only `subject` can revoke; non-subject reverts. |
| **TA-10: reveal proof reconstitutes commitment** | The `(adopterRevealProof, facilitatorRevealProof)` reconstitutes the `agreementCommitment` reference. Without it, refuse. |
| **TA-11: status-version monotonicity** | `assertionStatusVersion[id]` increases on every state change; no decrement. |
| **TA-12: cross-stack typehash equality** | `pnpm check:eip712-typehash-equality` covers both assertion types. |
| **TA-13: vocabulary firewall** | `pnpm check:no-domain-in-packages` + `pnpm check:forbidden-terms` clean against `verifiable-credentials/` and `attestations/`. |
| **TA-14: verifier reconciles credential status** | Test scenario: assertion ACTIVE on-chain, credential REVOKED off-chain → verifier returns invalid. |

### 11.1 End-to-end test scenarios

1. **Association — happy path**: Org onboards, JP issues, holder asserts publicly, verifier checks (full body fetched off-chain), succeeds.
2. **Association — issuer revoked credential**: same as 1, but issuer flips status-list bit. Verifier returns invalid even though on-chain assertion still active. UI flags holder.
3. **Association — holder revoked**: same as 1, then holder calls revokeOwnAssociation. Verifier returns invalid (assertion revoked).
4. **Joint agreement — both pre-authorized**: Sam + Maria sign with pre-authorized stances. Sam submits joint assertion. Maria's consent field empty. Succeeds.
5. **Joint agreement — Maria requires-fresh-consent**: Sam requests Maria's delegation. Maria signs. Sam submits with delegation attached. Succeeds.
6. **Joint agreement — Maria strictly-confidential**: Sam tries to submit; reverts at TA-07 layer.
7. **Joint agreement — Sam revokes**: After active, Sam calls revokeOwnJointAgreement. Row goes inactive. Verifier returns invalid.
8. **Joint agreement — Maria revokes (party-side, post-Sam-asserted)**: Same as 7 but from Maria's address. Either party can.

## 12. Implementation requirements

### 12.1 Audit emission (fail-hard sinks)

Per the audit pattern locked in PR #84:

- `credential.issued` — emit when issuer (JP or GC) issues a credential.
- `credential.received` — emit in holder's vault when credential is stored.
- `assertion.submitted` — emit when on-chain assertion is registered.
- `assertion.revoked` — emit on holder self-revoke.
- `credential.status.flipped` — emit when verifier observes a status-list change (informational).
- `verification.performed` — emit on each verifier check (with result).

Caller's sink composition (`composeSinks` fail-soft vs. `composeFailHardSinks` fail-hard) governs propagation.

### 12.2 No silent fallbacks (ADR-0013)

Each read path has exactly one mechanism:

- **Credential body fetch**: ONE mechanism (off-chain request to holder; on `404` return failure, do not fall back to on-chain).
- **Issuer signature verification**: ONE mechanism (ERC-1271 via the issuer's SA).
- **Status check**: ONE mechanism (W3C StatusList2021 fetch from the issuer's published URI).
- **Schema verification**: ONE mechanism (ShapeRegistry lookup).

### 12.3 Generic packages, no JP vocabulary

`pnpm check:no-domain-in-packages` MUST pass after both packages land. The vocabulary firewall keeps `facilitator`, `adopter`, `FPG`, `MOU` out of `packages/verifiable-credentials/` and `packages/attestations/`. JP-vertical Description shapes live in `apps/demo-jp/src/lib/jp-shapes.ts`.

## 13. Out of scope

| Item | Why | Where it lands |
|---|---|---|
| BBS+ selective-disclosure presentations | Different curve world (BLS12-381 vs our P-256); defer until product-justified | L-5 |
| `issuerGroupRoot` (Option B from prior architecture conversation) | Requires ZK overlay | L-2 |
| Additional credential types (Endorsement, Reputation, …) | Not needed for W1 demo arc | L-10 |
| Sealed-mailbox facet for credential delivery between Org SAs | Production hardening; W1 is in-process | L-11 |
| Third-party joint-agreement assertions (asserter ∉ parties) | Locked out per D-25; future will require both parties' delegations | L-12 |
| `PrivateZK` visibility tier | ZK overlay first | L-16 |
| AnonCreds for sensitive intents | Tied to sensitive intent-type support | L-17 |
| HCS-N mirror of the registry | After `hcs-standards-advisor` review | L-6 |
| Upgradeable contracts (UUPS) | Per PD-2 locked non-upgradeable | n/a |
| Status-list rotation by issuer governance | Out of W1 — issuer just maintains a single list URI | Post-W1 |

## 14. Open questions

None. IA D-15..D-22, D-25, D-26 + PD-9, PD-11, PD-12, PD-13, PD-14, PD-15 cover the decision space; all locked.

## 15. Implementation notes

### 15.1 Smart-agent files to consult during implementation

| Implementation step | Smart-agent reference |
|---|---|
| W3C VC envelope shape + canonical JSON | smart-agent credential-registry package + sdk credentials.ts |
| EIP-712 signature on VCs | smart-agent's eip712 helpers across packages/sdk |
| DOLCE+DnS Situation / Description / Roles | `/docs/specs/marketplace-lifecycle-alignment.md` (the UFO-C social-contract layer section) |
| Status-list-based credential revocation | smart-agent's W3C StatusList2021 implementation |
| Three-tier delegation (T1/T2/T3) ↔ scoped consent | `/docs/information-architecture/15-delegation-design-architecture.md` |
| Owner-routed vault + no-duplication (P4) | `/docs/information-architecture/10-intent-marketplace-classification.md` § 1 |
| SHACL Description shape registration | smart-agent's ontology registry pattern |

### 15.2 Implementation order (within the demo-jp upgrade trio)

Spec 242 has dependencies and dependents:

```
spec 239 (Intent Spine) ──→ produces Commitment (handoff to 241)
spec 242 (THIS) ──────────→ defines AgreementCredential shape (consumed by 241)
                          ──→ defines AttestationRegistry (referenced by 241's joint assertion path)
spec 241 (Agreement Registry) ──→ writes commitments; consumes Commitment from 239; consumes
                                              AgreementCredential shape from 242
```

So the order within the trio:

1. Spec 239 lands (already done).
2. Spec 242 lands (THIS). Establishes the credential envelope + AttestationRegistry. Locks PD-9 entrypoint on DelegationManager.
3. Spec 241 lands. Defines AgreementRegistry. References both 239 (Commitment hand-off) and 242 (AgreementCredential shape + JointAgreementAssertion back-pointer).
4. Implementation wave plan written.

The bilateral-consent contract path (§9) is the load-bearing integration between 241 and 242 — spec 241 will mandate that joint-assertion submissions for an agreement registered there validate via this spec's AttestationRegistry + DelegationManager.verifyAuthorization path.

### 15.3 Wave-by-wave breakdown for spec 242

Once this spec settles, the implementation lands in this order:

1. SHACL Description shapes for `AgentCollaborationAgreementDescription` (generic) land in `packages/ontology/src/shapes/` (or similar).
2. `DelegationManager.verifyAuthorization` view-only entrypoint added (PD-9).
3. `packages/verifiable-credentials/` lands.
4. `packages/contracts/src/attestation/AttestationRegistry.sol` lands with tests for TA-01..TA-11.
5. `packages/attestations/` lands.
6. Cross-stack typehash equality tests pass (TA-12).
7. Deployment to Base Sepolia; address propagated via `deploy-cloudflare.ts` (PR #91-style pattern).
8. App-side wiring: `apps/demo-jp/src/lib/issue-association.ts`, `apps/demo-jp/src/lib/issue-agreement.ts`, `apps/demo-jp/src/lib/assert-association.ts`, `apps/demo-jp/src/lib/assert-joint-agreement.ts`, plus the verifier helper.
9. UI: Org-onboarding "Issue Association Credential" + "Publish Association" buttons; agreement-side "Publish Joint Assertion" UX with bilateral-consent flow.
10. End-to-end test scenarios from §11.1 pass against a Base Sepolia deployment.
