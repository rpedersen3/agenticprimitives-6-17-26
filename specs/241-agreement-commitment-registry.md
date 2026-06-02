# Spec 241 — Agreement Registry

**Status:** draft, 2026-06-02.
**Owner:** demo-jp.
**Number assignments (locked):** spec **239** = Intent Spine, spec **241** = this doc (Agreement Registry), spec **242** = Verifiable Credentials + Attestations. The demo-jp upgrade trio is 239 / 241 / 242. 237 + 238 are unrelated existing waves; 240 is the native-platform-strategy wave.
**Owns spine layer:** 8 Agreement/Commitment (per [ADR-0024](../docs/architecture/decisions/0024-intent-coordination-substrate.md) Decision 2). Owns `AgreementCredential` shape per PD-22.
**Companion docs:** [apps/demo-jp/docs/information-architecture.md](../apps/demo-jp/docs/information-architecture.md) (§4c, §5.6, §10 commitment math, §10b joint assertion shape, §16, §17); [apps/demo-jp/docs/packages.md](../apps/demo-jp/docs/packages.md) (§2, §3.1, §4 SDK breakdown); [spec 239 — Intent Marketplace](239-intent-spine.md) (upstream — produces the Commitment input); [spec 242 — Verifiable Credentials + Attestations](242-trust-credentials-and-public-assertions.md) (peer — `AttestationRegistry` consumes this spec's `agreementCommitment` via `isAssertableCommitment` gateway); [spec 243 — Payments](243-payments.md); [spec 244 — Fulfillment](244-fulfillment.md).
**Architecture-of-record:** [coordination-substrate.md](../docs/architecture/coordination-substrate.md) (15-layer Layer 8); [privacy-and-self-sovereign-identity.md](../docs/architecture/privacy-and-self-sovereign-identity.md) (commitment-only + epoch-bucket privacy; D-45 stealth-address opt-in); [ADR-0023](../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md) (downstream attestation registry); [ADR-0024](../docs/architecture/decisions/0024-intent-coordination-substrate.md) (substrate decisions); [ADR-0013 — No Silent Fallbacks](../docs/architecture/decisions/0013-no-silent-fallbacks.md); [ADR-0019 — Relying Site = Scoped Delegation](../docs/architecture/decisions/0019-relying-site-authority-is-a-scoped-delegation.md); [ADR-0021 — Generic Packages vs White-Label Apps](../docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md); [spec 225 — Ontology](225-ontology.md).

## 1. Purpose

The third leg of the demo-jp upgrade trio. With spec 239 ending at a dual-signed Commitment and spec 242 defining the credential envelope + public-assertion registry, **spec 241** defines:

- The on-chain `AgreementRegistry` contract.
- The commitment math from IA §10 (`agreementCommitment` derived from party commitments + issuer commitment + schemaHash + agreement salt).
- The issuance flow: Global Church (the issuer) takes a dual-signed Commitment from spec 239, verifies, issues an `AgreementCredential` (shape from spec 242), and writes the commitment row.
- The status-update lifecycle (active / completed / revoked / disputed / expired) with nullifier replay protection.
- The bilateral-consent gateway for joint assertions that crosses into spec 242's `AttestationRegistry`.
- The SDK package `@agenticprimitives/agreements`.

Out of W1: ZK proofs over the registry (L-4), `issuerGroupRoot` mode (L-2), the Plan/Case/WorkItem operational layer downstream of fulfillment (L-18), HCS mirror (L-6).

## 2. Reference: smart-agent patterns to port (REQUIRED)

Per CLAUDE.md ("Always check smart-agent first"), this spec ports the agreement / commitment patterns from `/home/barb/smart-agent` (branch `003-intent-marketplace-proposal`).

### 2.1 Patterns ported wholesale

| Pattern | smart-agent location | Why we port | Where it lands here |
|---|---|---|---|
| ExchangeAgreement / FulfillmentCommitment / ClaimRight three-class split | `/docs/specs/marketplace-lifecycle-alignment.md` § 5 | Smart-agent's rejected-design #2: a single `Entitlement` row conflates the contract (Agreement), the promise (Commitment), and the entitlement (ClaimRight). Different lifecycles. We carry the distinction at the ontology layer; W1 collapses Commitment + Agreement into one on-chain row because their lifecycles are unified for demo-jp (a Commitment that gets issued IS the Agreement). Spec 241 reserves room to split if a future use case demands. | §4.2, §4.3 |
| Commitment-only registry (no party identities on-chain) | `/docs/information-architecture/10-intent-marketplace-classification.md` § 2 (anonymous pledges, private grant proposals) | The privacy substrate is that parties don't appear on-chain in the agreement row; only the commitment hash + issuer + schemaHash + epoch bucket. | §4.4, §5 |
| Nullifier set for replay prevention on status transitions | smart-agent's signal-spec nullifier pattern (Semaphore-derived) | Each status transition consumes a unique nullifier so the same party can't replay a "revoke" or "complete" action twice. | §5.5 |
| Epoch-bucket timestamps (timing-correlation damping) | `/docs/information-architecture/10-intent-marketplace-classification.md` § 3 (visibility cascade implications) | Exact `block.timestamp` would let a watcher correlate registry writes with parties' off-chain activity. Bucketing to floor(timestamp / EPOCH_SECONDS) breaks the correlation without breaking ordering. | §4.4, §13.3 |
| Issuer attestation as EIP-712 over the commitment | `/packages/credential-registry/` (smart-agent's VC ↔ on-chain attestation pattern) | The issuer signs an EIP-712 hash over the commitment + schema + issuance metadata; the contract verifies via ERC-1271 against the issuer's SA. | §5.2 |
| Status transitions via signed gateway calls | smart-agent's claim-right state transitions (active → completed → settled) | Each status change requires the actor's signature (issuer or either party, depending on transition), verified via ERC-1271. | §5.4 |
| Owner-routed canonical state (P4) | `/docs/information-architecture/10-intent-marketplace-classification.md` § 1 invariant P4 | The commitment row holds only hashes and pointers; canonical agreement bytes + party signatures live in the parties' vaults. | §6 |
| Same compositional pattern as `account-custody` scheduled changes | `/packages/contracts/src/custody/CustodyPolicy.sol` (already in repo) — schedule then apply with quorum sigs | Our existing custody-policy pattern (schedule → wait T → apply with party sigs) is the structural cousin of agreement issuance + status update. Borrow the typed-data + sig-slot encoding patterns. | §5 |
| Cross-stack EIP-712 typehash equality test | repo's existing pattern from PR #85 (`packages/delegation/test/integration/cross-stack-typehashes.test.ts`) | TS and Solidity hash the same envelope to the same bytes. | §11.5 |

### 2.2 Patterns deliberately NOT ported (with reasoning)

| smart-agent pattern | Why we diverge here |
|---|---|
| Three-class on-chain split (ExchangeAgreement + FulfillmentCommitment + ClaimRight as separate rows) | W1 collapses to one row per agreement. Smart-agent itself ships a v0 with a denormalized table and the same justification. Splitting is a future refactor when a single agreement spawns multiple claims (ECFA-style). |
| On-chain operational layer (FulfillmentCase, WorkItem, FulfillmentActivity) | Spec 241 is the social-contract layer (UFO-C). The operational/execution layers are L-18; not in W1. |
| BBS+ selective disclosure over the commitment | L-5 deferred (curve world; spec 242 §13 covers the same reasoning). |
| ZK proof of party-set membership | L-4 deferred. W1 uses opening-secret reveal in the trust-assertion path (spec 242 §6.5), not a ZK proof. |
| Issuer-revocation on-chain (issuer can rewrite a row's status) | Mirrors spec 242 D-18: issuer revocation lives off-chain (credential status list). The on-chain row's status is controlled by the contract's actors per §5.4. |

### 2.3 Architectural alignment

```
Spec 239 (Intent Spine — Direct Lane)
    Intent → MatchInitiation → IntentMatch → Commitment (dual-signed by both parties)
                                                                ↓
                                                  (handed to Global Church via JP)
                                                                ↓
Spec 241 (THIS)
    Global Church verifies the Commitment, issues the AgreementCredential, writes the
    AgreementCommitmentRow to AgreementRegistry
                                                                ↓
                                                  (vault-held credential on both sides)
                                                                ↓
                                              (optional, bilateral consent gate)
                                                                ↓
Spec 242 (Verifiable Credentials + Attestations)
    JointAgreementAssertion submitted to AttestationRegistry; the contract verifies
    via DelegationManager.verifyAuthorization (PD-9), checks the AgreementRegistry
    back-pointer, registers the public claim
```

Spec 241 is the **boundary**: the AgreementCredential shape comes from spec 242 §4.2; the joint-assertion back-pointer (`agreementCommitment` field in `JointAgreementAssertion`) is the integration with spec 242's contract. This spec mandates that boundary explicitly.

## 3. The journey

**Sam** (Adopter Org) and **Maria** (Facilitator Org) have signed a Commitment per spec 239 step I-6, with both `publicDisclosureStance` values bound into the canonical agreement. The Commitment is dual-signed.

1. JP forwards the Commitment to Global Church per IA §4c step 5a/5b.
2. Global Church (Pete-as-custodian-of-GC) reviews:
   - Both signatures resolve via ERC-1271 against Sam's and Maria's SAs.
   - The canonical agreement validates against the on-chain shape (`AgentCollaborationAgreementDescription` registered via spec 225's `ShapeRegistry`).
   - The parties are distinct.
   - The agreement document's `schemaHash` matches what's on-chain.
3. Pete signs a userOp from Global Church SA that:
   - Issues the `AgreementCredential` to both Sam and Maria (per spec 242 §4.1).
   - Calls `AgreementRegistry.register(...)` with the commitment row.
4. The contract:
   - Verifies the issuer's EIP-712 attestation against Global Church SA's ERC-1271.
   - Checks the commitment math (`agreementCommitment` reconstitutes from supplied components).
   - Stores the row.
5. Each party's vault stores the issued `AgreementCredential`. The on-chain row holds `agreementCommitment` + `schemaHash` + `issuer` + `statusCommitment` + `createdEpochBucket`. **No party identities on-chain.**
6. Weeks later: Sam decides to publish. Joint-assertion flow runs against spec 242's `AttestationRegistry`, which back-points to this registry's row.
7. Months later: a status update — Sam and Maria mark the agreement as `Completed`. They construct a status update payload with both signatures and a unique nullifier; the contract verifies and updates `statusCommitment`.

## 4. Architecture

### 4.1 What's on-chain vs vault-held

| Artifact | On-chain | Vault-held |
|---|---|---|
| Canonical agreement document (full body) | NO | YES (both parties + issuer + spec 239 broker JP) |
| Party signatures (Sam + Maria) | NO | YES |
| Issuer EIP-712 attestation signature | YES (referenced by `attestationHash`) | YES (full bytes) |
| `agreementCommitment` | YES | YES (used to recompute by verifier) |
| `schemaHash` | YES | YES |
| `issuer` SA address | YES (Global Church, public per Option A) | YES |
| `statusCommitment` | YES (current state) | YES (status history) |
| Party SA addresses | **NO** (not on chain in the commitment row) | YES |
| Opening secrets (saltA, saltF, agreementSalt) | NO (committed to but never revealed in the commitment row) | YES |
| Status-transition signatures | NO (verified at write time; not stored after) | YES (history) |

### 4.2 Why a single on-chain row per agreement (collapsing the three-class split)

Smart-agent's marketplace-lifecycle-alignment doc distinguishes `ExchangeAgreement` (contract) ⊃ `FulfillmentCommitment` (the promise) ⊃ `ClaimRight` (the entitlement). Different lifecycles in principle.

For demo-jp W1, all three collapse:

- One agreement → one fulfillment commitment → one set of bilateral claim rights.
- No multi-disbursement, no multi-tranche, no partial-fulfillment-by-third-party.
- The Commitment that emerges from spec 239 IS what becomes the on-chain row.

This is also what smart-agent ships in v0 (denormalized table per `/docs/specs/marketplace-lifecycle-alignment.md` § 5). The T-Box keeps the three classes distinct for future-proofing; the runtime collapses them.

**D-37 locked (NEW):** W1 ships a single on-chain row per agreement. The T-Box `AgentCollaborationAgreementDescription` shape includes all three roles (Issuer / AdopterRole / FacilitatorRole) on one Situation. Splitting into separate `ExchangeAgreement` + `FulfillmentCommitment` + `ClaimRight` rows is deferred until a use case demands it.

### 4.3 Commitment math (refresher from IA §10)

```
agreementHash         = H(canonical(agreementDocument))
adopterCommitment     = H(adopterAgentSecret, adopterSA, agreementHash, "adopter", saltA)
facilitatorCommitment = H(facilitatorAgentSecret, facilitatorSA, agreementHash, "facilitator", saltF)
issuerCommitment      = H(issuerSA, agreementHash, issuerSalt)
partySetCommitment    = H(adopterCommitment, facilitatorCommitment)
agreementCommitment   = H(agreementHash, partySetCommitment, issuerCommitment, schemaHash, agreementSalt)
```

`H` = `keccak256` on the abi-encoded tuple (chain-native). `*AgentSecret` is per-(SA, agreement) (per-agreement random per IA D-13).

**Invariant AR-01:** The on-chain `agreementCommitment` MUST equal the result of the above pipeline applied to the supplied components. Contract recomputes at `register()` time using the components in the issuance payload, rejects mismatch.

### 4.4 The on-chain row

```solidity
struct CommitmentRecord {
    bytes32 agreementCommitment;  // root commitment (see §4.3); also the primary key
    bytes32 schemaHash;            // = AgentCollaborationAgreementDescription on-chain shapeHash
    address issuer;                // Global Church SA (public per IA D-11 = Option A)
    bytes32 attestationHash;       // keccak256(canonical(issuer attestation typed-data))
    bytes32 statusCommitment;      // current state commitment; see §5.4
    uint64  createdEpochBucket;    // floor(block.timestamp / EPOCH_SECONDS) — NOT raw timestamp
    uint64  lastTransitionEpochBucket;
    uint8   statusEnum;            // STATE_ACTIVE / STATE_COMPLETED / STATE_REVOKED / STATE_DISPUTED / STATE_EXPIRED
}
```

`EPOCH_SECONDS = 3600` (1 hour) per IA L-3 timing-damping note. Raw timestamp is never stored.

## 5. Contract surface — `AgreementRegistry`

Lives at **`packages/contracts/src/agreement/AgreementRegistry.sol`**.

### 5.1 State

```solidity
contract AgreementRegistry {
    mapping(bytes32 => CommitmentRecord) internal commitments;   // by agreementCommitment
    mapping(bytes32 => bool)             internal nullifierSet;  // replay prevention on status updates

    uint64 constant EPOCH_SECONDS = 3600;

    uint8 constant STATE_ACTIVE    = 0;
    uint8 constant STATE_COMPLETED = 1;
    uint8 constant STATE_REVOKED   = 2;
    uint8 constant STATE_DISPUTED  = 3;
    uint8 constant STATE_EXPIRED   = 4;

    address public immutable delegationManager;  // for PD-9 verifyAuthorization callouts (joint-assertion gateway)
    address public immutable shapeRegistry;      // for schema validation
    address public immutable trustAssertionRegistry;  // back-ref for joint-assertion submissions

    // Events
    event AgreementRegistered(
        bytes32 indexed agreementCommitment,
        address indexed issuer,
        bytes32 schemaHash,
        uint64  createdEpochBucket
    );
    event StatusUpdated(
        bytes32 indexed agreementCommitment,
        uint8 indexed prevStatus,
        uint8 indexed nextStatus,
        bytes32 newStatusCommitment,
        bytes32 nullifier
    );
}
```

### 5.2 `register(...)` — the issuance entrypoint

```solidity
function register(
    AgreementIssuancePayload calldata p
) external {
    // 1. Recompute the commitment locally from the supplied components.
    bytes32 computed = _computeAgreementCommitment(p);
    require(computed == p.agreementCommitment, "AR-01: commitment math mismatch");

    // 2. Verify the issuer's EIP-712 attestation via ERC-1271 against the issuer SA.
    bytes32 attHash = _hashAttestationTypedData(p);
    require(
        IERC1271(p.issuer).isValidSignature(attHash, p.issuerSignature) == ERC1271_MAGIC,
        "AR-02: issuer signature invalid"
    );

    // 3. Verify the schema is registered and active in the on-chain ShapeRegistry.
    Shape memory sh = ShapeRegistry(shapeRegistry).getShape(p.schemaClassId);
    require(sh.active, "AR-03: schema not active");
    require(sh.shapeHash == p.schemaHash, "AR-03: schemaHash mismatch with on-chain registration");

    // 4. Refuse duplicate.
    require(commitments[p.agreementCommitment].issuer == address(0), "AR-04: already registered");

    // 5. Store.
    uint64 bucket = uint64(block.timestamp / EPOCH_SECONDS);
    commitments[p.agreementCommitment] = CommitmentRecord({
        agreementCommitment:        p.agreementCommitment,
        schemaHash:                 p.schemaHash,
        issuer:                     p.issuer,
        attestationHash:            attHash,
        statusCommitment:           _initialStatusCommitment(p.agreementCommitment),
        createdEpochBucket:         bucket,
        lastTransitionEpochBucket:  bucket,
        statusEnum:                 STATE_ACTIVE
    });

    emit AgreementRegistered(p.agreementCommitment, p.issuer, p.schemaHash, bucket);
}
```

`AgreementIssuancePayload` carries all the components needed for the commitment math + the issuer's typed-data signature. Defined in §5.3.

### 5.3 `AgreementIssuancePayload`

```solidity
struct AgreementIssuancePayload {
    // The pre-computed root commitment (must equal the recomputed value).
    bytes32 agreementCommitment;

    // Commitment math components (for the contract to recompute).
    bytes32 agreementHash;            // = keccak256(canonical(agreement document))
    bytes32 adopterCommitment;        // = H(secretA, saA, agreementHash, "adopter", saltA)
    bytes32 facilitatorCommitment;    // = H(secretF, saF, agreementHash, "facilitator", saltF)
    bytes32 issuerCommitment;         // = H(issuerSA, agreementHash, issuerSalt)
    bytes32 schemaHash;               // = on-chain shapeHash for AgentCollaborationAgreementDescription
    bytes32 schemaClassId;            // = keccak256(shapeURI) — points at the ShapeRegistry entry
    bytes32 agreementSalt;            // top-level commitment salt

    // Issuer attestation.
    address issuer;                   // Global Church SA
    bytes32 attestationDomainSeparator;  // EIP-712 domain hash
    bytes32 attestationStructHash;    // EIP-712 struct hash
    bytes   issuerSignature;          // ERC-1271 against `issuer`
}
```

Note: party SA addresses (Sam, Maria) are NOT in the payload. They are committed-to via `adopterCommitment` and `facilitatorCommitment`; the contract verifies the issuer's attestation covers these party-commitments without ever learning the party addresses.

### 5.4 Status transitions

```
                      register
                          │
                          ▼
                    [STATE_ACTIVE]
                    /     │      \
                 either   both    issuer
                 party    party   (off-chain status-list flip; on-chain row stays ACTIVE)
                 marks    sign
                 dispute  fulfilment
                    │        │
                    ▼        ▼
            [STATE_DISPUTED] [STATE_COMPLETED]
                    │
              both parties agree to revoke
                    │
                    ▼
              [STATE_REVOKED]

   ────────────────────────────────────────
   STATE_EXPIRED: derived view (validUntil < now); no signed transition required
                  (clients compute it from the agreement document's validity window
                  + the registry's createdEpochBucket; never stored as a transition).
```

Each non-derived transition is gated by a `StatusUpdatePayload`:

```solidity
function updateStatus(StatusUpdatePayload calldata u) external {
    CommitmentRecord storage rec = commitments[u.agreementCommitment];
    require(rec.issuer != address(0), "AR-05: not registered");
    require(rec.statusEnum != STATE_REVOKED && rec.statusEnum != STATE_COMPLETED, "AR-06: terminal");
    require(_isValidTransition(rec.statusEnum, u.nextStatus), "AR-07: invalid transition");
    require(!nullifierSet[u.nullifier], "AR-08: nullifier reused");

    // Verify the actor signatures appropriate to the transition (see §5.4.1 below).
    _verifyTransitionAuthorization(rec, u);

    nullifierSet[u.nullifier] = true;

    uint8 prev = rec.statusEnum;
    rec.statusEnum = u.nextStatus;
    rec.statusCommitment = u.newStatusCommitment;
    rec.lastTransitionEpochBucket = uint64(block.timestamp / EPOCH_SECONDS);

    emit StatusUpdated(u.agreementCommitment, prev, u.nextStatus, u.newStatusCommitment, u.nullifier);
}

struct StatusUpdatePayload {
    bytes32 agreementCommitment;
    uint8   nextStatus;
    bytes32 newStatusCommitment;
    bytes32 nullifier;             // unique per (agreementCommitment, party, action); replay-prevented
    bytes   actor1Signature;       // ERC-1271 against the appropriate SA per §5.4.1
    bytes   actor2Signature;       // empty when only one signer required
    // Plus whatever opening-secret evidence the transition requires
    // (defined per transition; verified by _verifyTransitionAuthorization)
}
```

#### 5.4.1 Authorization matrix per transition

| Transition | Who must sign | Why |
|---|---|---|
| `ACTIVE → COMPLETED` | BOTH parties (bilateral) | Both parties confirm fulfillment. |
| `ACTIVE → DISPUTED` | EITHER party (unilateral) | A single party should be able to flag a dispute. |
| `DISPUTED → COMPLETED` | BOTH parties (bilateral) | Dispute resolved; both confirm. |
| `DISPUTED → REVOKED` | BOTH parties (bilateral) | Both agree to walk away. |
| `ACTIVE → REVOKED` | BOTH parties (bilateral) | Mutual recission. |

**Note: issuer (Global Church) cannot trigger any on-chain transition** (D-18 holds across both registries). Issuer-side revocation of the underlying credential happens off-chain via the credential status list (spec 242 §10.1). The on-chain registry row stays whatever-it-was; verifiers reconcile.

#### 5.4.2 Nullifier derivation

```
nullifier = keccak256(abi.encode(
    agreementCommitment,
    nextStatus,
    actorRole,               // "adopter" | "facilitator"
    actorSecret              // per-(actor, agreementCommitment) nullifier secret
))
```

The actorSecret is held in the actor's vault. The contract stores the consumed nullifier; it cannot derive the actorSecret from it.

**Invariant AR-09:** A given nullifier MUST be accepted at most once. Replay reverts.

### 5.5 Joint assertion gateway

When a party submits a `JointAgreementAssertion` to spec 242's `AttestationRegistry`, that contract calls back into THIS contract to verify the `agreementCommitment` exists and is in a valid state:

```solidity
function isAssertableCommitment(bytes32 agreementCommitment, address actor) external view returns (bool ok, string memory reason) {
    CommitmentRecord storage rec = commitments[agreementCommitment];
    if (rec.issuer == address(0)) return (false, "AR-10: not registered");
    if (rec.statusEnum == STATE_REVOKED) return (false, "AR-10: revoked");
    // Note: STATE_DISPUTED is intentionally ASSERTABLE — the parties may want to publish
    // the existence of the disputed agreement; the status_commitment carries the dispute fact.
    return (true, "");
}
```

Spec 242's `AttestationRegistry.assertJointAgreement` reads this; if `(false, _)`, it refuses the assertion at the gateway layer with the underlying `reason`. This is the back-pointer integration explicitly mandated by spec 239's hand-off diagram.

## 6. Vault shapes

Per IA §5.6 (per-agreement vault entry). Recap:

```ts
type AgreementVaultEntry = {
  agreementCommitment: Hex;
  schemaHash: Hex;
  schemaClassId: Hex;
  role: 'adopter' | 'facilitator' | 'issuer';
  canonicalAgreement: AgreementDocument;
  agreementHash: Hex;
  signatures: { adopter: Hex; facilitator: Hex; issuer: Hex };
  openingSecrets: { saltA?: Hex; saltF?: Hex; issuerSalt?: Hex; agreementSalt: Hex; secretA?: Hex; secretF?: Hex };
  attestation: { domainSeparator: Hex; structHash: Hex; signature: Hex; canonicalTypedData: object };
  status: { value: 'active' | 'completed' | 'revoked' | 'disputed' | 'expired'; statusCommitment: Hex; updatedAt: number };
  nullifierSecrets: { fulfilled: Hex; revoked: Hex; disputed: Hex };  // per-status pre-derived; consumed as transitions fire
};

// Holder vault key:
//   agenticprimitives:demo-jp:agreement-vault:<agreementCommitment>:<holderSA>
```

Each party + issuer holds one entry per agreement they participated in. The vault is the canonical source of the body; the on-chain row is the public commitment + status pointer.

## 7. SDK package — `@agenticprimitives/agreements`

Lives at **`packages/agreements/`**. Per packages.md §4 (originally drafted for `agreements`).

```
packages/agreements/
  src/
    index.ts                       — public exports
    commitments.ts                 — hashAgreement, computeAgreementCommitment, hash party/issuer/partySet commitments
    nullifiers.ts                  — nullifier derivation per (commitment, role, action, actorSecret)
    typed-data.ts                  — EIP-712 issuer attestation domain + types; status-update domain + types
    abi.ts                         — Solidity ABI mirror (lockstep gate)
    client.ts                      — AgreementRegistryClient (readContract-only)
    issuance.ts                    — build the AgreementIssuancePayload; helper for the issuer's signing flow
    status.ts                      — build StatusUpdatePayload; helper for the actor's signing flow + nullifier consumption
    gateway.ts                     — call into AttestationRegistry's joint-assertion path with the commitment-back-pointer set
    schema-shape.ts                — the SHACL Description for AgentCollaborationAgreementDescription; registered via spec 242's helper
  test/
    unit/
      commitments.test.ts          — cross-stack hash determinism; AR-01 reconstitution
      nullifiers.test.ts           — uniqueness, replay rejection
      typed-data.test.ts           — issuer + status-update domain hashes
      status.test.ts               — transition matrix (§5.4.1) coverage
    integration/
      issuance-end-to-end.test.ts  — issuer signs → register → row appears → status update → status changes
      cross-spec.test.ts           — gateway integration: register here, joint-assert via spec 242's package, verify back-ref
  capability.manifest.json
  CLAUDE.md, AUDIT.md, README.md
  package.json
```

Allowed imports:

```
@agenticprimitives/types
@agenticprimitives/agent-account     (type-only — Address + ERC-1271)
@agenticprimitives/verifiable-credentials (type-only — for AgreementCredential shape from spec 242)
viem
```

Forbidden:

- `@agenticprimitives/attestations` — would couple SDKs even though contracts back-reference each other; we keep the SDK boundary clean and use `gateway.ts` only to construct payloads, never to call directly
- `@agenticprimitives/intent-marketplace` — sibling; intent layer hands off the Commitment but agreements doesn't depend on intent-marketplace for that
- anything JP-specific (vocabulary firewall)

## 8. Cross-spec integration

### 8.1 With spec 239 (Intent Spine)

Spec 239 step I-7 hands off a dual-signed Commitment to JP. JP forwards to Global Church per IA §4c. Global Church builds the `AgreementIssuancePayload` for spec 241 and submits.

The Commitment from spec 239 is mapped to spec 241's payload like so:

| Spec 239 Commitment field | Spec 241 payload field |
|---|---|
| `canonicalAgreement` | Used to compute `agreementHash` |
| `partySignatures.adopter / .facilitator` | Verified by Global Church off-chain BEFORE registering; not on-chain |
| `originatingIntentMatch` | Stored in the issuer's vault for audit; not on-chain |
| Party SA addresses | Used to compute `*Commitment`; not on-chain |
| Per-party `*AgentSecret` + `salt*` | Used to compute `*Commitment`; not on-chain |

Spec 239 doesn't dictate the issuance flow; spec 241 does. They meet at the Commitment shape.

### 8.2 With spec 242 (Verifiable Credentials + Attestations)

Two integration points:

- **Issuance**: spec 242 §4.2 defines `AgreementCredential`. Spec 241's `AgreementIssuancePayload.attestationStructHash` covers the same canonical hash as spec 242 §4.3's `credentialHash`. Same bytes, same hash, by construction.
- **Joint assertion gateway**: spec 242 §6 `AttestationRegistry.assertJointAgreement` calls into spec 241's `isAssertableCommitment(agreementCommitment, actor)`. Spec 242 refuses the assertion if this returns `(false, _)`. The cross-contract back-reference is the only intentional inter-registry dependency.

### 8.3 With `DelegationManager.verifyAuthorization` (PD-9)

Spec 241 does NOT directly call `verifyAuthorization`. The status-update transitions in §5.4 use plain ERC-1271 signature checks (parties sign EIP-712 typed-data). The bilateral-consent / delegation-as-predicate pattern is used **in spec 242's joint-assertion gateway**, not here.

This keeps spec 241's surface minimal and concentrates the delegation-as-predicate dependency in one place.

### 8.4 With the on-chain `ShapeRegistry` (spec 225)

**Drift note (2026-06-02):** the on-chain `ShapeRegistry` (`packages/contracts/src/ontology/ShapeRegistry.sol`) is governance-gated. Spec 241 mandates that the `AgentCollaborationAgreementDescription` shape is registered at chain bootstrap (by the registry's governor) BEFORE any `register()` call to this registry can succeed. The contract's step-3 check (`require(sh.active && sh.shapeHash == p.schemaHash)`) enforces this.

Operational consequence: demo-jp's deploy script runs the SHACL registration (single governor-signed tx) once at first deploy on a new chain. Subsequent app deploys read the on-chain shape and validate. The same registration also covers spec 242's `AgentCollaborationAgreementDescription` (single source of truth — substrate Description is shared between 241 and 242 as it's the same artifact).

## 9. Visibility + privacy posture

The W1 privacy claim is intentionally specific:

> The `AgreementRegistry` row publicly reveals: an `agreementCommitment` hash, the issuer (Global Church), a `schemaHash`, a `statusCommitment`, and two `createdEpochBucket` / `lastTransitionEpochBucket` values. It does NOT reveal either party UNLESS both parties have jointly chosen to surface the agreement via a `JointAgreementAssertion` against spec 242's `AttestationRegistry`.

What this still leaks (L-N items, same as IA §14):

- **Gas-payer correlation**: every registry write comes from demo-a2a's relayer EOA. `L-3` closes via per-issuer relayer rotation.
- **Issuer activity graph**: Global Church writes every agreement in demo-jp. Anyone watching can count agreements. `L-2` closes via `issuerGroupRoot`.
- **Timing damping is partial**: `EPOCH_SECONDS = 3600` is conservative; a low-activity demo with one user-session per hour still reveals approximate timing. Tighter damping (multi-hour buckets) is configurable but trades off audit utility.
- **Status transitions are publicly visible**: the `StatusUpdated` event reveals (commitment, prev, next, statusCommitment, nullifier). A watcher can see "this agreement was completed in epoch X." This is a deliberate trade-off for audit utility.

UI MUST be loud about these in "Issuer / Pete" mode so demo viewers know what's protected and what isn't (same UI affordance as IA §14 calls out).

## 10. Tests + invariants

| Test | Pass criterion |
|---|---|
| **AR-01: commitment-math reconstitution** | Contract recomputes `agreementCommitment` from supplied components; mismatch reverts. |
| **AR-02: issuer signature** | Issuer's EIP-712 attestation verifies via ERC-1271 against the supplied `issuer` SA. |
| **AR-03: schema active + matching** | `ShapeRegistry.getShape(p.schemaClassId).active == true && shapeHash == p.schemaHash`; mismatch reverts. |
| **AR-04: no duplicate registration** | Re-registering the same `agreementCommitment` reverts. |
| **AR-05: status-update on registered row** | Status update against an unregistered commitment reverts. |
| **AR-06: no transitions out of terminal** | After `REVOKED` or `COMPLETED`, further `updateStatus` reverts. |
| **AR-07: valid-transition table** | Only transitions matching §5.4.1 are accepted; others revert. |
| **AR-08: nullifier replay prevented** | The same nullifier MUST NOT succeed twice. |
| **AR-09: actor signature matrix** | For each transition in §5.4.1, the required signers' ERC-1271 sigs MUST be checked; missing-sig MUST revert with the correct reason. |
| **AR-10: issuer cannot self-revoke on-chain** | No code path allows the issuer's signature alone to transition to `REVOKED`. Negative regression. |
| **AR-11: gateway view returns correctly** | `isAssertableCommitment` returns `(false, "not registered")` for unregistered commitments, `(false, "revoked")` for revoked rows, `(true, "")` otherwise. |
| **AR-12: party identities not in calldata** | The `register(...)` calldata MUST NOT contain Sam's or Maria's SA address. Static-analysis test scans the encoded payload bytes. |
| **AR-13: epoch-bucket damping** | `createdEpochBucket == block.timestamp / 3600`; raw timestamp not stored anywhere. |
| **AR-14: cross-stack typehash equality** | `pnpm check:eip712-typehash-equality` covers `AgreementIssuanceAttestation` and `StatusUpdate` domains. |
| **AR-15: vocabulary firewall** | `pnpm check:no-domain-in-packages` + `pnpm check:forbidden-terms` pass against `packages/agreements/` + `packages/contracts/src/agreement/`. |
| **AR-16: cross-spec end-to-end** | Issuer issues a credential per spec 242, registers per spec 241, parties submit joint assertion per spec 242, gateway succeeds. |

### 10.1 End-to-end scenarios

1. **Happy path issuance**: Spec 239 produces a Commitment, GC issues credential + registers commitment, both parties' vaults hold the credential, on-chain row reads back correctly.
2. **Completed**: After registration, both parties sign a `COMPLETED` transition; row updates; nullifiers consumed.
3. **Disputed → Completed**: One party signs `DISPUTED`; row updates. Later, both sign `COMPLETED`; row updates.
4. **Mutual revocation**: Both parties sign `REVOKED`; row updates; further `updateStatus` reverts (AR-06).
5. **Joint assertion via spec 242**: Either party submits a `JointAgreementAssertion`; spec 242's contract calls `isAssertableCommitment`; gateway approves; assertion lands.
6. **Joint assertion blocked by revoked row**: After mutual revocation, spec 242's joint-assertion call fails at gateway (AR-11 reason: "revoked").
7. **Off-chain credential revocation, on-chain row stays**: GC flips status-list bit; spec 241's row remains `ACTIVE`; verifier reconciles per spec 242 §10.2.
8. **Schema drift**: Try to register with a schemaHash that doesn't match the on-chain ShapeRegistry; reverts with AR-03 reason.

## 11. Implementation requirements

### 11.1 Audit emission (fail-hard sinks)

Per the audit pattern locked in PR #84:

- `agreement.issued` — emitted at `register()`. Payload includes commitment + issuer + epoch bucket.
- `agreement.status_updated` — emitted at `updateStatus()`. Payload includes prev/next/nullifier.
- `agreement.gateway_query` — emitted at `isAssertableCommitment()` (informational; helps trace cross-spec calls).

Caller's sink composition (`composeSinks` / `composeFailHardSinks`) governs propagation.

### 11.2 No silent fallbacks (ADR-0013)

- **Schema lookup**: ONE mechanism (`ShapeRegistry.getShape(...)`); if shape inactive or hash-mismatched, revert. No fallback to off-chain canonical.
- **Issuer signature verification**: ONE mechanism (`ERC1271.isValidSignature(...)`). No fallback to recovered-pubkey check.
- **Status transitions**: ONE mechanism per row (the state-machine table); no "if this fails, try the other transition."

### 11.3 Generic packages, no JP vocabulary

`pnpm check:no-domain-in-packages` MUST pass after the package lands. `facilitator`, `adopter`, `FPG`, `MOU`, `Joshua Project` stay out of `packages/agreements/` and `packages/contracts/src/agreement/`. JP-vertical payload schemas (FPG ids, capacity matrices, etc.) live in `apps/demo-jp/src/lib/agreement-payload.ts` and are referenced ONLY via opaque `payload` bytes in the canonical agreement document.

### 11.4 Cross-stack typehash equality

The two EIP-712 domains spec 241 ships:

- `AgreementIssuanceAttestation` — covers the issuer's signed payload.
- `StatusUpdate` — covers the status-transition signed payload.

Both wired into the existing `pnpm check:eip712-typehash-equality` gate (same pattern as PR #85's delegation cross-stack-typehashes test).

### 11.5 Smart-agent canonical-JSON alignment

The `canonicalAgreement` hashing MUST use RFC 8785 JCS (same as spec 242 §4.3). TS + Solidity helpers MUST agree on `agreementHash` byte-for-byte.

## 12. Implementation order

Within the demo-jp upgrade trio, after specs 239 + 241 + 242 are all settled, the implementation order is:

1. `DelegationManager.verifyAuthorization` view-only entrypoint added (PD-9; required by spec 242, indirectly relied on by spec 241's gateway integration). Refactor `_validateDelegation` into a shared internal that both `redeemDelegation` and `verifyAuthorization` call.
2. SHACL Description shape `AgentCollaborationAgreementDescription` registered on-chain via `ShapeRegistry.defineShape(...)` (single governor tx at chain bootstrap).
3. `packages/verifiable-credentials/` lands (spec 242's substrate; spec 241 type-imports from it).
4. `packages/contracts/src/agreement/AgreementRegistry.sol` lands with AR-01..AR-13 tests.
5. `packages/contracts/src/attestation/AttestationRegistry.sol` lands (spec 242).
6. `packages/agreements/` SDK lands.
7. `packages/attestations/` SDK lands (spec 242).
8. Cross-spec integration tests (`AR-16` + spec 242's `TA-14`) pass against both contracts deployed on Base Sepolia.
9. App-side wiring: `apps/demo-jp/src/lib/issue-agreement.ts`, `apps/demo-jp/src/lib/update-agreement-status.ts`, `apps/demo-jp/src/lib/assert-joint-agreement.ts`.
10. UI: Global Church issuer dashboard (Pete) + status-update UX on agreement rows + Joint Agreement Assertion UX (consumed by spec 242).
11. End-to-end scenarios (§10.1) pass against a Base Sepolia deployment.

## 13. Out of scope

| Item | Why | Where it lands |
|---|---|---|
| ZK proofs over the commitment registry | Privacy hardening wave (L-4); W1 uses reveal-on-assert per spec 242 §6.5 | L-4 |
| `issuerGroupRoot` mode (Option B from prior architecture conversation) | Privacy hardening; W1 ships Option A (issuer public) | L-2 |
| Splitting `ExchangeAgreement` / `FulfillmentCommitment` / `ClaimRight` into separate on-chain rows | Single-row collapse per D-37; revisit when a use case demands it | Post-W1 |
| Operational layer (FulfillmentCase, WorkItem, FulfillmentActivity, Outcome events) | Beyond social-contract layer; spec 239 §13 covers same reasoning | L-18 |
| Tighter epoch-bucket damping (configurable bucket size) | W1 hardcodes 3600s; tuning is post-W1 | Post-W1 |
| Issuer-side on-chain revocation entrypoint | D-18 holds across the trio; off-chain credential status only | n/a — locked out |
| Multi-signer issuance (Global Church multi-sig) | Mode-0 EOA-custodied for demo; Global Church custody is Pete's single EOA per IA D-1 | Post-demo |
| Status-list rotation by issuer governance | Out of W1 scope; tied to credential status-list infrastructure | Post-W1 |

## 14. Open questions

None. IA D-1..D-36, D-37 (newly locked above), and PD-1..PD-21 cover the decision space; all locked.

## 15. Implementation notes

### 15.1 Smart-agent files to consult during implementation

| Implementation step | Smart-agent reference |
|---|---|
| ExchangeAgreement / FulfillmentCommitment / ClaimRight ontology layer | `/docs/specs/marketplace-lifecycle-alignment.md` § 5 |
| Marketplace lifecycle handoff (Commitment → Agreement) | `/docs/specs/marketplace-lifecycle-alignment.md` § 2 |
| Owner-routed canonical state (P4) | `/docs/information-architecture/10-intent-marketplace-classification.md` § 1 |
| Visibility cascade interaction with on-chain anchors | `/docs/information-architecture/10-intent-marketplace-classification.md` § 3 |
| Nullifier pattern (Semaphore-derived) | smart-agent's signal-nullifier implementation |
| Three-tier delegation model (consumed indirectly via spec 242) | `/docs/information-architecture/15-delegation-design-architecture.md` |
| RFC 8785 canonical JSON for cross-stack hash determinism | smart-agent's credential-registry canonical-JSON helpers |

### 15.2 The cross-spec implementation dependency

Spec 241 alone is buildable AFTER PD-9 lands (DelegationManager.verifyAuthorization) and AFTER the SHACL Description shape is registered on-chain. Both prerequisites are owned by spec 242's wave (steps 1 + 2 of §12). Spec 241's wave runs in parallel-after-prereqs with spec 242's wave:

```
   PD-9 entrypoint added ──────────┐
                                   ├─→ spec 242 registry + SDK    ─┐
   SHACL Description registered ───┘                                ├─→ cross-spec tests + app wiring
                                                                    │
                              spec 241 registry + SDK ──────────────┘
```

### 15.3 Drift acknowledged

- `ShapeRegistry` is governance-gated, structured-constraint-based, not opaque-bytes (drift verified 2026-06-02). Spec 241's `register(...)` step-3 validation reflects the real surface.
- `DelegationManager.verifyAuthorization` does NOT exist today; PD-9 lifts the internal `_validateDelegation` dispatch into a view-only public entrypoint (drift verified). Spec 241 does NOT directly call it (concentrated in spec 242), but the implementation order in §12 reflects the prerequisite.
- No `nullifier` or `statusCommitment` patterns exist in the current contract source — spec 241's design is genuinely new (drift verified).
