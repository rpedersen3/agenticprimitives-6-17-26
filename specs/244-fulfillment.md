# Spec 244 — Fulfillment: FulfillmentCase + Task / Message / Artifact

**Status:** Drafted (2026-06-02).
**Owns:** Layers 10–12 of the 15-layer spine ([coordination-substrate.md](../docs/architecture/coordination-substrate.md) §4).
**Architecture-of-record:** [ADR-0024](../docs/architecture/decisions/0024-intent-coordination-substrate.md) (the spine), [ADR-0023](../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md) (EvidenceCredential lives in `AttestationRegistry`).
**Companion specs:** [239](./239-intent-spine.md), [241](./241-agreement-commitment-registry.md), [242](./242-trust-credentials-and-public-assertions.md), [243](./243-payments.md).
**Package:** `@agenticprimitives/fulfillment` (new W1 package per user elevation 2026-06-02).
**Privacy posture:** [privacy-and-self-sovereign-identity.md](../docs/architecture/privacy-and-self-sovereign-identity.md) §4 Layers 10–12.

---

## 0. Why this spec exists

Once two parties have committed to an Agreement (Layer 8), the operational reality begins: someone has to **do the work**. Today's agentic systems collapse this into either:
- A single opaque "task" with no internal state (LangChain / CrewAI / AutoGen task graphs)
- A messaging stream conflating communication and deliverables (chat-as-task)
- A workflow engine far removed from the agreement that authorized it (Temporal / Airflow detached from on-chain)

The [A2A protocol](https://google.github.io/A2A/) got the architectural separation right: **Task** (stateful work), **Message** (communication), **Artifact** (deliverable). The substrate adopts that separation as load-bearing and binds it to the Agreement that authorized the work and the Attestations that capture evidence + outcomes.

`@agenticprimitives/fulfillment` is the package; `FulfillmentCase` is the operational container; `Task`, `Message`, and `Artifact` are the typed primitives inside it.

## 1. Decisions

| ID | Decision | Why |
|---|---|---|
| **PD-24.1** | Package name is `@agenticprimitives/fulfillment` (locked) | Per ADR-0024 Decision 3 |
| **FLF-1** | `FulfillmentCase` is the operational container; one per Agreement (typically) | Maps to spine Layer 10 |
| **FLF-2** | Task / Message / Artifact are first-class + distinct types | Adopted from A2A; conflation is the failure mode |
| **FLF-3** | Tasks have A2A state machine (`submitted` → `working` → `completed` / `failed` / `canceled` / `input-required` / `rejected` / `auth-required`) | A2A-canonical |
| **FLF-4** | Artifacts are hash-anchored; bodies in vaults; assertable as `EvidenceCredential` | Per ADR-0023 + spec 242 |
| **FLF-5** | Outcomes are `OutcomeCredential` VCs, asserted to `AttestationRegistry` | Per ADR-0024 Decision 2 |
| **FLF-6** | `HandoffPolicy` is first-class; cross-agent handoffs require it | OpenAI Agents SDK + A2A pattern |
| **FLF-7** | Progressive commitment lifecycle distinct from A2A task states | The case has a coarser lifecycle than its tasks |
| **FLF-8** | Trace spans emitted per Layer-cross transition | Per ADR-0024 Decision 7 |
| **FLF-9** | Payments bind via `taskId` per spec 243 PMT-3 | Layer 9b ↔ Layer 11 binding |
| **FLF-10** | No new contract; everything is VC-asserted into `AttestationRegistry` | Per ADR-0024 Decision 2 |

## 2. Non-goals

- **NOT a workflow engine.** No DAG scheduling, no retry policy library, no concurrency primitives beyond what A2A specifies. App-layer chooses an execution engine.
- **NOT an LLM orchestrator.** Tasks may be executed by humans, agents, LLMs, contracts, oracles, or hybrids. The substrate is execution-agnostic.
- **NOT a messaging system.** Message-thread storage is in JVs per privacy doc D-46; the substrate types the message envelope, not the transport.
- **NOT a chat UI.** Apps render however they want.
- **NOT a new contract.** Per FLF-10, fulfillment artifacts assert into `AttestationRegistry`.

## 3. Reference: smart-agent + A2A patterns to port

Smart-agent has a partial fulfillment story (post-match → activity → outcome). A2A is the modern reference for Task / Message / Artifact separation. The substrate combines both.

- **Ported from smart-agent as-is.** Activity-and-outcome typed pair; PROV-O grounding of activity → outcome → evidence; visibility tier inheritance from intent.
- **Ported from smart-agent with modification.** Smart-agent's activity is the executable unit; we split into `Task` (stateful unit) + `Activity` (a smaller PROV-O record of one execution step inside a Task). This adds resolution without breaking smart-agent's conceptual model.
- **Ported from A2A as-is.** Task state machine; Task / Message / Artifact separation; AgentCard handoff metadata.
- **Ported from A2A with modification.** A2A Task state machine adapts to W3C VC envelopes for Artifacts; A2A Message authentication adapts to ERC-1271 / SA-signed messages.
- **Ported from OpenAI Agents SDK.** `HandoffPolicy` pattern as first-class authority binding.
- **Diverged.** A2A treats Tasks as black-box delegation between agents; we add `agreementCommitment` + `intentId` + `paymentMandateId` binding so Tasks have on-chain provenance.

## 4. The `FulfillmentCase` operational container

### 4.1 Type definition

```ts
interface FulfillmentCase {
  // Identity
  caseId: Hex32;                              // keccak256(agreementCommitment || nonce)
  agreementCommitment: Hex32;                 // binding to spec 241 row

  // Participants (from the agreement)
  parties: [SAAddress, SAAddress];

  // Lifecycle (progressive commitment per FLF-7)
  lifecycle: FulfillmentLifecycle;            // 'drafted' | 'clarified' | 'expressed' | 'acknowledged' | 'proposed' | 'accepted' | 'committed' | 'in_progress' | 'fulfilled' | 'validated' | 'archived'
  lifecycleHistory: LifecycleTransition[];    // signed transitions
  currentLifecycleEpochBucket: number;

  // Components
  taskIds: Hex32[];                           // ordered or DAG (per FulfillmentTopology)
  topology: FulfillmentTopology;              // 'linear' | 'parallel' | 'dag'
  topologySpec?: TopologySpec;                // edge list if 'dag'

  // Authority
  handoffPolicy: HandoffPolicy;
  permissionGrants: PermissionGrantRef[];     // delegations from parties to executors

  // Privacy
  visibility: VisibilityTier;                 // inherits from agreement; per-party-asserted
  vaultRef: JointVaultRef;                    // JV for shared artifacts/messages

  // Payment binding (FLF-9)
  paymentMandateIds: Hex32[];                 // mandates bound to this case

  // Audit
  traceSpanRoot: Hex32;                       // root of the IntentTraceSpan tree

  // Status
  outcomeAssertionUid?: Hex32;                // set when fulfilled + outcome asserted (Layer 13)
  validationAssertionUids: Hex32[];           // validations attached (Layer 14)
}
```

### 4.2 Lifecycle state machine

```
drafted → clarified → expressed → acknowledged → proposed → accepted → committed → in_progress → fulfilled → validated → archived
                                                                                   ↓
                                                                                  (canceled / disputed → archived)
```

Transition rules:

| From | To | Required signer(s) |
|---|---|---|
| `drafted` | `clarified` | Either party |
| `clarified` | `expressed` | Either party |
| `expressed` | `acknowledged` | Counterparty (FLF-7 acknowledgement) |
| `acknowledged` | `proposed` | Either party with proposal |
| `proposed` | `accepted` | Counterparty signature |
| `accepted` | `committed` | Both parties (matches spec 241 commitment) |
| `committed` | `in_progress` | Executor SA (the party doing the work) |
| `in_progress` | `fulfilled` | Executor SA |
| `fulfilled` | `validated` | Validator (per Layer 14) |
| `validated` | `archived` | Either party after timeout |
| any | `canceled` / `disputed` | Per [spec 241](./241-agreement-commitment-registry.md) status transition rules |

**Hard rule (FLF-7.1).** The `FulfillmentCase` lifecycle and the underlying `AgreementCommitment` status (per spec 241) are **distinct but synchronized**. `case.lifecycle = 'archived'` → spec 241 status MAY be `COMPLETED` (if `validated` was reached) or `DISPUTED` (if disputed); never `ACTIVE`.

## 5. The `Task` primitive

### 5.1 Type definition (A2A-derived)

```ts
interface Task {
  // Identity
  taskId: Hex32;
  caseId: Hex32;                              // parent FulfillmentCase

  // A2A state machine
  state: TaskState;                           // 'submitted' | 'working' | 'completed' | 'failed' | 'canceled' | 'input-required' | 'rejected' | 'auth-required'
  stateHistory: TaskStateTransition[];

  // Execution
  assignee: SAAddress;                        // the SA executing this task
  assigneeKind: 'person' | 'org' | 'agent' | 'oracle' | 'hybrid';
  assigneeProfileRef: AgentProfileRef;        // signed AgentCard / ERC-8004 ref

  // Input
  inputSpec: TaskInputSpec;
  inputHash: Hex32;                           // hash of the input payload

  // Output
  outputSpec: TaskOutputSpec;                 // contract for valid output
  artifactIds: Hex32[];                       // artifacts produced
  messageThreadId?: Hex32;                    // optional message thread for this task

  // Constraints
  deadline?: number;                          // unix epoch
  maxRetries: number;                         // default 1
  paymentMandateRef?: Hex32;                  // payment bound to this task per FLF-9

  // Authority
  permissionGrantRef: Hex32;                  // delegation authorizing the assignee
  handoffPolicy?: HandoffPolicy;              // overrides case-level policy if present

  // Audit
  traceSpanIds: Hex32[];                      // spans emitted while working this task
}
```

### 5.2 Task state semantics

| State | Meaning | Allowed transitions |
|---|---|---|
| `submitted` | Task received, awaiting work | `working`, `rejected`, `auth-required` |
| `working` | Assignee actively working | `completed`, `failed`, `canceled`, `input-required` |
| `completed` | Output produced + matches `outputSpec` | (terminal) → contributes to case fulfillment |
| `failed` | Could not be completed | (terminal) |
| `canceled` | Canceled by case party | (terminal) |
| `input-required` | Need additional input from a party | `working` (after input) |
| `rejected` | Assignee refused the task | (terminal) |
| `auth-required` | Authority insufficient; needs additional delegation | `submitted` (after grant) |

**Hard rule (FLF-3.1).** Every state transition is **signed** by the actor authorized to make it. State transitions are not free — they leave a typed trace.

**Hard rule (FLF-3.2).** State transitions emit a `IntentTraceSpan` (`spanType = 'task_state_change'`).

## 6. Message vs Artifact separation (FLF-2)

### 6.1 Why this matters

In LLM-agent ecosystems, chat messages and produced deliverables are usually the same data structure. That conflation causes:
- Provenance loss (which message IS the deliverable?)
- Evidence ambiguity (is this chat ATR or output?)
- Disclosure failures (revealing all messages reveals private deliberation)
- Validation gaps (how does a validator verify "the deliverable"?)

A2A enforces the separation. The substrate adopts it.

### 6.2 `Message` type

```ts
interface Message {
  messageId: Hex32;
  threadId: Hex32;                            // thread within a Task or Case
  caseId: Hex32;
  taskId?: Hex32;

  sender: SAAddress;
  signature: EIP712Signature;                 // ERC-1271 signed

  bodyRef: VaultRef;                          // body in JV (per D-46)
  bodyHash: Hex32;                            // for integrity check
  bodyContentType: string;                    // MIME type

  inReplyTo?: Hex32;
  timestamp: number;                          // raw; messages don't need epoch-bucket privacy (they're vault-only)

  // Privacy
  recipients: SAAddress[];                    // who can decrypt
}
```

**Hard rule (FLF-MSG-1).** Messages NEVER appear in any public registry. They live in JVs. Their hash MAY anchor in an audit-trail span, but the body never crosses to PR.

### 6.3 `Artifact` type

```ts
interface Artifact {
  artifactId: Hex32;
  caseId: Hex32;
  taskId?: Hex32;                             // task that produced it (if any)

  producer: SAAddress;
  artifactKind: ArtifactKind;                 // 'document' | 'signed-tx' | 'validation-report' | 'receipt' | 'summary' | 'proof' | 'generated-file' | 'attestation' | 'custom'

  bodyRef: VaultRef;                          // body in JV or PV
  bodyHash: Hex32;                            // RFC 8785 JCS canonical hash
  bodyContentType: string;

  // Selective disclosure
  disclosurePolicy: DisclosurePolicy;         // per-field (D-42)
  merkleRoot?: Hex32;                         // for field-level disclosure proofs

  // Authority + assertion
  evidenceAssertionUid?: Hex32;               // if asserted as EvidenceCredential

  // Provenance
  parents?: Hex32[];                          // prior artifacts this builds on
  traceSpanId: Hex32;
  createdAt: number;
}
```

**Hard rule (FLF-ART-1).** Artifacts are hash-anchored; only the hash + metadata appear in any registry. Bodies are vault-resident (JV for shared, PV for personal).

**Hard rule (FLF-ART-2).** Artifacts CAN be promoted to `EvidenceCredential` by assertion into `AttestationRegistry` per spec 242. Promotion is opt-in by the producer + countersignature requirements per disclosure policy.

## 7. `HandoffPolicy` (FLF-6)

```ts
interface HandoffPolicy {
  allowedTargetAgents: SAAddress[];
  allowedAgentClasses: AgentClass[];          // e.g., 'verified-coach', 'KYC-org', '...'
  requiresUserApproval: boolean;
  preservePrivacyTier: boolean;               // handoff cannot weaken privacy
  allowedScopes: ScopeId[];                   // intersection with case's permissionGrants
  maxHopCount: number;                        // default 1
}
```

**Hard rule (FLF-6.1).** When a Task is handed off to a new assignee, the new assignee MUST satisfy the policy AND a new delegation is minted scoped to the new assignee. Handoff is a typed event; it is never implicit.

**Hard rule (FLF-6.2).** `preservePrivacyTier = true` means the handoff fails if the new assignee cannot operate at the case's privacy tier. (E.g., a public-cleartext agent cannot receive a handoff for a private case.)

## 8. EvidenceCredential + OutcomeCredential (Layers 12 + 13)

### 8.1 EvidenceCredential

```ts
interface EvidenceCredential {
  '@context': [...];
  type: ['VerifiableCredential', 'EvidenceCredential'];
  issuer: SAAddress;                          // producer
  validFrom: ISODate;
  credentialSubject: {
    id: SAAddress;                            // subject of evidence
    artifactId: Hex32;
    artifactKind: ArtifactKind;
    artifactHash: Hex32;
    caseId: Hex32;
    taskId?: Hex32;
    merkleRoot?: Hex32;                       // for selective disclosure
    disclosurePolicy: DisclosurePolicy;
  };
  credentialStatus?: { ... };                 // W3C StatusList2021 for issuer-side revocation
  proof: Eip712Signature2026;
}
```

Asserted to `AttestationRegistry` with `credentialType = keccak256("EvidenceCredential")`. Holder-only on-chain revoke per ADR-0023.

### 8.2 OutcomeCredential

```ts
interface OutcomeCredential {
  '@context': [...];
  type: ['VerifiableCredential', 'OutcomeCredential'];
  issuer: SAAddress;                          // the actor declaring the outcome
  validFrom: ISODate;
  credentialSubject: {
    id: SAAddress;                            // subject of the outcome (usually intent expresser)
    intentId: Hex32;
    caseId: Hex32;
    intentExpected: ExpectedOutcomeSpec;      // from the original intent
    delivered: DeliveredOutcomeSpec;          // what actually happened
    actorSatisfaction: 'fully' | 'partially' | 'not';
    evidenceAssertionUids: Hex32[];           // citation chain
    metrics?: OutcomeMetrics;
  };
  credentialStatus?: { ... };
  proof: Eip712Signature2026;
}
```

Asserted to `AttestationRegistry` with `credentialType = keccak256("OutcomeCredential")`. Holder-only on-chain revoke per ADR-0023.

**Hard rule (FLF-OUT-1).** An OutcomeCredential MUST cite at least one EvidenceCredential UID in `evidenceAssertionUids`. Outcome without evidence is not assertable.

**Hard rule (FLF-OUT-2).** OutcomeCredential.intentId MUST resolve to an intent the `subject.id` SA actually expressed. (Off-chain check at assertion time; the validation chain depends on this.)

## 9. Trace spans (FLF-8)

Per ADR-0024 Decision 7, every layer-cross transition in a FulfillmentCase emits an `IntentTraceSpan`:

```ts
interface IntentTraceSpan {
  spanId: Hex32;
  parentSpanId?: Hex32;
  caseId: Hex32;
  intentId?: Hex32;

  spanType: SpanType;                         // 'parse' | 'clarify' | 'resolve' | 'match' | 'handoff' | 'tool_call' | 'wallet_simulation' | 'user_approval' | 'execution' | 'validation' | 'task_state_change' | 'lifecycle_transition'
  actorAgent: SAAddress;
  inputHash: Hex32;
  outputHash: Hex32;
  policyVersion: string;
  timestamp: number;
}
```

**Where they live.** Spans are emitted into the runtime trace store. By default vault-only (PV/JV). MAY be aggregated into a public audit feed if the case visibility is public.

**Trace span tree.** A FulfillmentCase has a `traceSpanRoot`; child spans form a tree. The root is bound to the case; leaves are atomic operations.

## 10. SDK surface (`@agenticprimitives/fulfillment`)

```ts
// Case lifecycle
export function buildFulfillmentCase(agreementCommitment: Hex32, ...): UnsignedCase;
export async function transitionLifecycle(case: FulfillmentCase, to: FulfillmentLifecycle, signer: SaSigner): Promise<FulfillmentCase>;
export async function archiveCase(caseId: Hex32, signer: SaSigner): Promise<void>;

// Task
export function buildTask(caseId: Hex32, ...): UnsignedTask;
export async function transitionTaskState(taskId: Hex32, to: TaskState, actor: SaSigner): Promise<void>;
export async function handoffTask(taskId: Hex32, newAssignee: SAAddress, policy: HandoffPolicy, signer: SaSigner): Promise<Task>;

// Message
export async function postMessage(threadId: Hex32, body: Uint8Array, sender: SaSigner): Promise<Message>;
export async function getThread(threadId: Hex32, reader: SaSigner): Promise<Message[]>;

// Artifact
export function buildArtifact(caseId: Hex32, body: Uint8Array, kind: ArtifactKind, ...): UnsignedArtifact;
export async function publishArtifact(artifact: SignedArtifact, vaultClient: VaultClient): Promise<Hex32 /* artifactId */>;
export async function promoteToEvidence(artifactId: Hex32, producer: SaSigner, attestationClient: AttestationClient): Promise<Hex32 /* uid */>;

// Outcome
export function buildOutcomeCredential(caseId: Hex32, intentId: Hex32, evidence: Hex32[], ...): UnsignedOutcomeVC;
export async function assertOutcome(vc: SignedOutcomeVC, attestationClient: AttestationClient): Promise<Hex32 /* uid */>;

// Trace
export function emitSpan(span: IntentTraceSpan): void;
export async function getTraceTree(caseId: Hex32): Promise<IntentTraceSpan[]>;
```

## 11. Invariants (FLF-INV-01 .. FLF-INV-16)

| ID | Invariant | Enforcement |
|---|---|---|
| **FLF-INV-01** | Case lifecycle synchronizes with agreement status per spec 241 | Transition function checks |
| **FLF-INV-02** | Task state transitions are signed by authorized actor | ERC-1271 verification |
| **FLF-INV-03** | Task state transitions emit IntentTraceSpan | Side-effect of transition function |
| **FLF-INV-04** | Messages never appear in PR | Vault client refuses to post to PR |
| **FLF-INV-05** | Artifact bodies are vault-resident; only hash in registry | Same — vault client enforces |
| **FLF-INV-06** | EvidenceCredential.artifactHash matches artifact body hash | Pre-assertion check |
| **FLF-INV-07** | OutcomeCredential cites at least one EvidenceCredential UID | Pre-assertion check |
| **FLF-INV-08** | OutcomeCredential.subject.id expressed the cited intentId | Off-chain integrity check |
| **FLF-INV-09** | HandoffPolicy is honored; new assignee satisfies allowedTargetAgents OR allowedAgentClasses | Handoff function checks |
| **FLF-INV-10** | `preservePrivacyTier = true` blocks handoff if new assignee can't operate at the tier | Handoff function checks |
| **FLF-INV-11** | Payment mandates bound to a task have `contextBinding.taskId = task.taskId` | Per spec 243 PMT-INV-01 |
| **FLF-INV-12** | OutcomeCredential is unrevokable by issuer — holder-only per ADR-0023 | AttestationRegistry has no `issuerRevoke` |
| **FLF-INV-13** | TaskState machine cannot transition backward except via explicit allowed paths (e.g., `input-required` → `working`) | State machine table |
| **FLF-INV-14** | Case visibility is inherited from agreement OR more-private (D-46.3 opt-in for public) | Visibility resolution |
| **FLF-INV-15** | Trace span tree root binds to caseId | Root span structure |
| **FLF-INV-16** | An assertion of OutcomeCredential triggers preparation for a TrustUpdate (Layer 15); TrustUpdate cannot precede outcome | Layer-ordering invariant; checked at assertion time |

## 12. Test scenarios (FLF-T-01 .. FLF-T-12)

1. **FLF-T-01** — Build a FulfillmentCase from an agreement; lifecycle transitions through happy path → validated.
2. **FLF-T-02** — Task state machine: submitted → working → completed; trace spans emitted.
3. **FLF-T-03** — Task fails; case lifecycle to disputed; agreement status reconciles.
4. **FLF-T-04** — Handoff: Task A → Task B with new assignee; policy honored; new delegation minted.
5. **FLF-T-05** — Handoff rejected: new assignee fails policy; trace span captures rejection.
6. **FLF-T-06** — Message posted; appears in JV; never appears in PR or attestation registry.
7. **FLF-T-07** — Artifact produced; hash-anchored; body in JV; promotion to EvidenceCredential succeeds.
8. **FLF-T-08** — EvidenceCredential asserted; OutcomeCredential cites it; both visible to verifier.
9. **FLF-T-09** — OutcomeCredential without evidence citation → assertion rejected.
10. **FLF-T-10** — Payment mandate bound to taskId; redemption requires task completion (off-chain coordination).
11. **FLF-T-11** — Trace tree query returns parent-child structure spanning all spans of a case.
12. **FLF-T-12** — Case visibility downgrade (private → public) requires explicit dual-party consent (D-46.3).

## 13. Implementation order

1. **FLF-IO-01** — `FulfillmentCase` type + lifecycle state machine.
2. **FLF-IO-02** — `Task` type + A2A state machine.
3. **FLF-IO-03** — `Message` + `Artifact` + JV vault client integration.
4. **FLF-IO-04** — `HandoffPolicy` evaluator + delegation minting.
5. **FLF-IO-05** — `IntentTraceSpan` emission + trace store.
6. **FLF-IO-06** — `EvidenceCredential` + promotion path → `AttestationRegistry` (depends on spec 242).
7. **FLF-IO-07** — `OutcomeCredential` + assertion + validation citation (depends on FLF-IO-06).
8. **FLF-IO-08** — Lifecycle ↔ spec 241 status synchronization.
9. **FLF-IO-09** — Payment binding tests (depends on spec 243 PMT-IO-09).
10. **FLF-IO-10** — Privacy regression suite (D-46 JV/PV/PR boundaries; D-42 per-field DisclosurePolicy on Artifacts).

## 14. Drift acknowledgments

- **A2A binary compat.** The substrate is A2A-pattern-aligned, not A2A-wire-protocol-compatible at W1. Bridging to A2A endpoints is a `mcp-runtime` extension (future).
- **PROV-O grounding.** Specific PROV-O export is reserved for the audit-evidence layer (spec 237) and not a W1 deliverable of this package.
- **Cross-case task sharing.** A Task currently belongs to one case. Tasks shared across cases (e.g., a coaching cohort with multiple FulfillmentCases) are deferred to L-X.
- **AgentCard / ERC-8004 identity registry.** `AgentProfileRef` is typed against `agent-profile` package; ERC-8004 integration deferred to future wave.

## 15. Open questions (L-26 .. L-28)

- **L-26.** Should `FulfillmentCase` itself anchor to chain (a row in some registry), or remain off-chain with only assertions anchoring? Lean: off-chain W1. Revisit when audit-evidence layer (spec 237) stabilizes.
- **L-27.** Should `IntentTraceSpan` have a canonical W3C VC representation for cross-app trace import/export? Lean: yes; defer to W2.
- **L-28.** How do we reconcile A2A's stateful Task model with stateless tool calls (MCP)? Current answer: MCP tool calls are sub-spans inside a Task; the Task is the stateful wrapper. Document in `mcp-runtime` integration spec when written.

## 16. Related

**Spine docs:**
- [coordination-substrate.md](../docs/architecture/coordination-substrate.md) Layers 10–12
- [privacy-and-self-sovereign-identity.md](../docs/architecture/privacy-and-self-sovereign-identity.md) §4 Layers 10–12, D-46
- [ADR-0024](../docs/architecture/decisions/0024-intent-coordination-substrate.md) Decisions 2, 7
- [ADR-0023](../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md) composability table

**Sibling specs:**
- [239 — intent marketplace](./239-intent-spine.md) — produces `intentId` cited in `OutcomeCredential`
- [241 — agreement registry](./241-agreement-commitment-registry.md) — produces `agreementCommitment`; status synchronizes with case lifecycle
- [242 — verifiable credentials + attestations](./242-trust-credentials-and-public-assertions.md) — VC envelope for Evidence + Outcome
- [243 — payments](./243-payments.md) — payment mandate `taskId` binding
- [237 — audit-evidence layer](./237-audit-evidence-layer.md) — consumes IntentTraceSpan for audit ramp

**Industry references:**
- [A2A — Agent-to-Agent Protocol](https://google.github.io/A2A/)
- [A2A Task lifecycle](https://google.github.io/A2A/specification/)
- [OpenAI Agents SDK](https://platform.openai.com/docs/guides/agents) — handoff pattern
- [MCP — Model Context Protocol](https://modelcontextprotocol.io/specification)
- [ERC-8004 — Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004)
- [W3C VC Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/)
- [PROV-O](https://www.w3.org/TR/prov-o/)
- [RFC 8785 JCS](https://www.rfc-editor.org/rfc/rfc8785)
