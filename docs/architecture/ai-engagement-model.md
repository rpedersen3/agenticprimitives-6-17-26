# The AI Engagement Model

> **Thesis.** The substrate is **AI-permissive at every layer, AI-authoritative at no layer except its own**. AI participates in interpretation, suggestion, negotiation, orchestration, validation, and reputation aggregation — but in every layer, AI's outputs are typed artifacts that flow into a typed authority object signed by an SA. AI is never the trusted party; AI's contributions are *cited* through provenance, and the user / org SA carries the actual authority.

**Status:** Foundational architecture document (2026-06-02).
**Companion to:** [coordination-substrate.md](./coordination-substrate.md) — the 15-layer spine + three-plane organization; [privacy-and-self-sovereign-identity.md](./privacy-and-self-sovereign-identity.md) — privacy posture; [ADR-0022](./decisions/0022-authority-must-be-declarative.md) — authority must be declarative.
**Industry references:** [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/), [NIST AI RMF Generative AI Profile](https://www.nist.gov/itl/ai-risk-management-framework), [Anthropic agent-design guidance](https://www.anthropic.com/engineering/building-effective-agents), [OpenAI Agents SDK guardrails](https://platform.openai.com/docs/guides/agents), [Google A2A AgentCard signing](https://google.github.io/A2A/).

---

## 1. The five AI roles

Every AI surface in the substrate maps to one of **five distinct roles**, each with a different authority boundary. The roles are not personas the user sees — they are architectural seams in the substrate that determine which inputs can become which outputs.

### 1.1 Concierge / Engagement agent

**Role.** Transform user desire (latent, natural-language, conversational) into a candidate Intent that the user can review + confirm.

**Authority.** **None.** The concierge produces *candidates* — never typed authority objects. Every artifact the concierge produces is unsigned, marked `requiresUserConfirmation = true`, and gated through the resolver pipeline before promotion to the Economic plane.

**Operational characteristics:**
- Lives in the Cognitive/Engagement plane (Layer 1 Desire + early-stage interpretation of Layers 2–3)
- Can ask clarifying questions, infer goals, surface risks, suggest constraints, explain options
- MUST NOT produce signed Intents or PaymentMandates
- Output schema:

```json
{
  "type": "EngagementCandidate",
  "candidateIntent": "...",
  "candidateConstraints": [...],
  "assumptions": [...],
  "missingInformation": ["budget", "deadline"],
  "riskFlags": ["payment-required", "external-agent-needed"],
  "explanationForUser": "...",
  "requiresUserConfirmation": true
}
```

### 1.2 Resolver agent

**Role.** Convert ambiguous or app-specific Intent into canonical protocol objects (Intent + ConstraintSet + AssumptionSet), with full provenance.

**Authority.** **None** for the Intent itself; **full** for the `ResolutionReceipt` it produces about its own work. Resolution is a layer of *provenance*, not a layer of *authority*.

**Operational characteristics:**
- Lives at Layer 4 of the spine
- Produces `ResolutionReceipt` per [spec 239 §4.5a](../../specs/239-intent-spine.md) — captures model + version + prompt hash + tool calls + confidence + policy checks + required-confirmation flag
- `requiresUserConfirmation = true` MUST trigger when: inferred constraint of source = 'llm-inferred' has confidence < threshold AND privacy-tier > Public (RR-INV-03)
- The user signs the canonical typed Intent + ConstraintSet bytes — NOT the resolver's reasoning trace. Authority binds to the artifact, not to the explanation.
- ResolutionReceipts assert into `AttestationRegistry` as `ResolutionReceiptCredential` for audit replay

### 1.3 Solver / Provider agent

**Role.** Bid on intent fulfillment; propose execution; offer resources, services, or counterparty matching.

**Authority.** **None** for the user's Intent; **own** for its own SolverBid. A solver signs its own bid; the user / matchmaker decides whether to accept.

**Operational characteristics:**
- Lives at Layers 5–6 of the spine
- Exposes signed [A2A AgentCard](https://google.github.io/A2A/) (ERC-1271 verified per spec 245)
- Can be a person, org, agent, or hybrid (`assigneeKind` per spec 244)
- Supports A2A Task execution + MCP tool calls during fulfillment
- Bid MUST bind to specific ConstraintSet hash (cannot retroactively re-bid)
- Bid output:

```json
{
  "type": "SolverBid",
  "resolvedFromIntentId": "...",
  "solverAgent": "<SA address>",
  "matchScore": 8500,
  "reason": "...",
  "predictedOutcome": {...},
  "costEstimate": {...},
  "trustCertificate": {...},      // AttestationRegistry UID(s)
  "signature": "..."
}
```

### 1.4 Validator agent

**Role.** Verify that evidence satisfies the agreement; produce ValidationCredential.

**Authority.** **None** to mutate the Outcome itself; **full** for its own ValidationCredential.

**Operational characteristics:**
- Lives at Layer 14 of the spine
- Validator types per [ERC-8004 Validation Registry](https://eips.ethereum.org/EIPS/eip-8004): human / agent / oracle / TEE / zkML / re-execution
- Validation MUST be independent from fulfillment (can't be the same SA as the executor)
- Validation cites specific EvidenceCredential + OutcomeCredential UIDs
- Hard substrate invariant (D-40): TrustUpdate cannot follow Outcome without an intervening ValidationCredential

### 1.5 Reputation / Trust agent

**Role.** Aggregate trust signals into reputation surface; provide a curatable, queryable view.

**Authority.** **None** to assert new validations; **own** for its TrustUpdate emissions.

**Operational characteristics:**
- Lives at Layer 15 of the spine
- TrustUpdate cites a chain: ValidationCredential → OutcomeCredential → cited Intent + Agreement
- Reputation aggregation algorithm is **app-layer**; the substrate stores raw trust events, not scored aggregates
- Two reputation modes (D-47): aggregate-anonymous (default) + citable-linkable (opt-in per credential class)
- Sybil resistance via credential-cost, never KYC

### Summary table — authority delta per role

| Role | Can sign Intent? | Can sign ConstraintSet? | Can sign Agreement? | Can sign PaymentMandate? | Can sign ResolutionReceipt? | Can sign SolverBid? | Can sign ValidationCredential? | Can sign TrustUpdate? |
|---|---|---|---|---|---|---|---|---|
| Concierge | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Resolver | ❌ | ❌ | ❌ | ❌ | ✅ (its own) | ❌ | ❌ | ❌ |
| Solver/Provider | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (its own) | ❌ | ❌ |
| Validator | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (its own) | ❌ |
| Reputation | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (its own) |
| **User / Org SA** | ✅ | ✅ | ✅ | ✅ | — | — | — | — |

The user / org SA is the **only** authority that can sign artifacts in the Economic plane. Every AI role can only sign its own contributions.

## 2. Semantic caveats — the delegation pattern that makes this work

Per [ERC-7710](https://eips.ethereum.org/EIPS/eip-7710) + [ERC-7715](https://eips.ethereum.org/EIPS/eip-7715), delegations carry **caveat objects** that bound the granted authority. The substrate's strong recommendation: use **semantic caveats** (typed object slots) rather than **selector-only caveats** (raw 4-byte function-selector bitmasks).

**Anti-pattern (avoid):**

```js
{
  delegate: "0xagent...",
  allowedSelectors: ["0xa9059cbb", "0x095ea7b3"],   // transfer + approve
  expiry: 1735689600
}
```

This is opaque. The user has no way to read it as "the agent can transfer USDC to merchant ABC up to $100/day". The audit trail is just selectors.

**Recommended pattern (semantic):**

```ts
interface SemanticCaveat {
  // Target — WHO can be called
  target?: SAAddress | { class: 'merchant' | 'broker' | 'validator'; subset?: SAAddress[] };

  // Asset — WHAT can be moved
  asset?: AssetRef;
  amountCap?: { value: bigint; period: 'P1D' | 'P1W' | 'P30D' | 'TOTAL' };

  // Method — HOW the call is made (semantic, not selector)
  methodKind?: 'transfer' | 'approve' | 'submit-order' | 'create-task' | 'pay-x402' | 'finalize-payment';

  // Counterparty — WITH WHOM
  counterparties?: SAAddress[];
  counterpartyClass?: AgentCardClass[];

  // Time bounds
  time?: { validFrom: number; validUntil: number; allowedHours?: TimeWindow };

  // Purpose — for audit / dispute
  purpose: string;             // human-readable; required
  agreementRef?: Hex32;
  intentRef?: string;

  // Chain
  chainId: number;

  // Human-confirmation gate
  requiresHumanConfirmationAbove?: { amount: bigint; asset: AssetRef };

  // Simulation
  requiresSimulation: boolean; // default true
}
```

**Why semantic.** When the user is asked to grant a permission, the UI can render the caveat in natural language: "Agent X can submit orders to merchant ABC, paying up to $100/day in USDC, on Base, requiring my confirmation above $50." The user understands. Disputes have a typed object to reason about. Selectors are the implementation detail, not the user-visible contract.

**Implementation.** The `delegation` package's existing caveat enforcers (`AllowedTargetsEnforcer`, `AllowedMethodsEnforcer`, `TimestampEnforcer`, `CalldataHashEnforcer`, etc.) are the bytecode-level enforcers. The `SemanticCaveat` is the **typed envelope** the user signs; the SDK compiles down to enforcer-call calldata. ERC-7710 calls this approach **typed caveat encoding**.

## 3. Threat model + architectural-control matrix

Aligned with [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/) + [NIST AI RMF Generative AI Profile](https://www.nist.gov/itl/ai-risk-management-framework). The substrate's design assumes ALL of these threats exist; each row names the architectural control that prevents the failure mode.

### 3.1 Threats targeting the Cognitive plane (LLM-specific)

| Threat (OWASP/NIST) | Failure mode | Substrate control |
|---|---|---|
| **LLM01 — Prompt injection** | Attacker text in NL input causes concierge to produce malicious candidate | Candidate marked `requiresUserConfirmation = true`; user signs canonical Intent bytes (not prompt) |
| **LLM02 — Insecure output handling** | Concierge output flows directly to executor | Architectural fence: Cognitive plane outputs CANNOT directly call Economic plane; only via user-signed Intent |
| **LLM05 — Supply chain (model)** | Concierge runs untrusted model | `ResolutionReceipt.resolver.model` captures model + version + provider; downstream verifiers can refuse credentialed flows from untrusted models |
| **LLM06 — Sensitive info disclosure** | Concierge leaks user data into prompts to external APIs | Vault residency (D-46): personal data is in PV; concierge accesses only what user explicitly shares via per-message bilateral consent |
| **LLM09 — Overreliance** | User trusts model output without verification | DOC-1 + RR-INV-01: user MUST sign canonical typed bytes; signature binds authority, not the explanation |

### 3.2 Threats targeting the Economic plane

| Threat | Failure mode | Substrate control |
|---|---|---|
| **AI exceeds authority** | Agent executes payment beyond authorized scope | PaymentMandate `amountPolicy` + `mandateConstraints` + ERC-7710 caveats |
| **AI pays too much (aggregate)** | Agent runs many small payments | `mandateConstraints.maxAggregateAmount` + closed-mandate-for-final-charge (PMT-INV-13) |
| **Open mandate misused for checkout** | Agent treats open mandate as final-charge authority | PMT-10.1: rail executor refuses; closed mandate required |
| **Solver impersonation** | Attacker claims to be a known solver | Signed AgentCard (A2A-4 in spec 245) + ERC-1271 verification |
| **Solver lies about ability** | Bidder claims credentials they don't hold | `trustCertificate` field references AttestationRegistry UIDs; verifier checks holder |
| **Resolver hides assumptions** | AI quietly normalizes constraints differently from user expectation | First-class AssumptionSet (D-38) + ResolutionReceipt with policy checks (RR-INV) |
| **Permission grant too broad** | "approve unlimited" anti-pattern | Semantic caveats; substrate refuses caveat-less delegations in tool-policy |

### 3.3 Threats targeting the Evidence plane

| Threat | Failure mode | Substrate control |
|---|---|---|
| **Work completes; evidence is weak** | Provider claims success without artifact | `EvidenceCredential` with hash-anchored artifact required; OutcomeCredential cites Evidence (FLF-INV-07) |
| **Outcome disputed** | "My word against theirs" | Independent ValidationCredential required (D-40) |
| **Reputation manipulated (Sybil)** | Attacker inflates rep via many SAs | Credential-cost barriers + citation chain to fulfilled intents |
| **Reputation manipulated (collusion)** | Validator + provider collude | Validation independence enforced (validator SA ≠ executor SA); multiple-validator threshold per credential class |
| **Validation capture** | Attacker becomes a validator and self-attests | Validator credential issuance is gated by ShapeRegistry governance + ERC-8004 validator-staking pattern (W2) |
| **Forged evidence** | Provider hashes a fake artifact | EvidenceCredential.credentialHash must match artifact body hash (FLF-INV-06); body in JV with bilateral access |
| **Stale assumptions** | Resolver assumption expired but agreement still acts on it | AssumptionSet.expiresAt enforced; agreement consumption MUST recheck assumption validity |

### 3.4 Threats targeting the substrate as a whole

| Threat | Failure mode | Substrate control |
|---|---|---|
| **Audit erasure** | Bad actor removes trace of harmful action | All authority objects are signed + asserted into AttestationRegistry; ADR-0013 no silent fallbacks; ADR-0022 declarative authority |
| **Privilege escalation via delegation chain** | Delegated agent re-delegates to itself with broader scope | ERC-7710 caveat composition rules: re-delegation scope = intersection, never expansion |
| **Cross-vertical credential confusion** | Faith credential interpreted as health credential | `credentialType` discrimination + ShapeRegistry governance-gated `defineShape` |
| **AI-as-validator capture** | Validator agent is the same model family as the resolver | Validator-type discrimination + multi-validator threshold per credential class (D-40 enforcement) |

## 4. The clean engagement flow

The substrate's recommended flow for any AI-driven coordination:

```
1. User expresses desire in NL → Concierge produces EngagementCandidate (unsigned)
2. User reviews EngagementCandidate; clarifies + corrects via dialogue
3. Concierge hands off to Resolver → produces canonical Intent + ConstraintSet + AssumptionSet + ResolutionReceipt
4. ResolutionReceipt is asserted (W1 credential type); requiresUserConfirmation evaluated
5. If true (or any field is policy-imposed-by-resolver): user signs canonical Intent+ConstraintSet bytes
6. Intent enters the matchmaker (intent-marketplace)
7. Direct Lane: counterparty matched + IntentMatch signed → Agreement
   Pool Lane: SolverBids gathered + best selected → Agreement
8. Agreement signed bilaterally → spec 241 AgreementCommitment registered
9. User authorizes execution: PermissionGrant + PaymentMandate (open mode for ongoing; closed mode for terminal)
10. FulfillmentCase opens; Tasks execute; Artifacts produced
11. Provider claims Outcome → OutcomeCredential
12. Independent Validator verifies → ValidationCredential
13. Reputation aggregates → TrustUpdate
14. Loop: TrustUpdate feeds back into future Resolution
```

**Every step has a typed artifact. Every artifact carrying authority is signed by the appropriate SA. AI contributes at every step but never carries authority for anything except its own provenance.**

## 5. Implementation guidance

### 5.1 For package authors

When adding a new feature that involves AI:
- Identify which **role** (concierge / resolver / solver / validator / reputation) the AI is acting as.
- Identify which **plane** the AI's output flows into.
- Confirm the output schema is typed and signs the correct artifact for its role.
- Confirm the substrate refuses to promote across planes without the appropriate signed object.

### 5.2 For app authors

When designing a user-facing flow:
- The user MUST see the typed canonical Intent + ConstraintSet (not the NL prompt) before signing.
- The user MUST understand the PaymentMandate semantics (open vs closed) before granting.
- Audit-trail surfaces should show the citation chain: TrustUpdate → ValidationCredential → OutcomeCredential → EvidenceCredential → Agreement → Intent.
- Concierge dialogue should be clearly distinguished from authority-grant surfaces in UI; the substrate's typed boundary should be visible to the user.

### 5.3 For threat-model reviewers

Use §3's threat tables as checklists. Every new flow MUST be evaluated against each threat row. Mitigation = the substrate control named there; absence of the control = a flow that violates the substrate's invariants.

## 6. What this doctrine is NOT

- **NOT a ban on AI participation.** AI participates at every layer; just not as an authority outside its role.
- **NOT a workflow engine.** The substrate types the boundaries; orchestration is app-layer.
- **NOT a UX prescription.** The substrate types the artifacts; rendering is app-layer (subject to clarity invariants).
- **NOT a model registry.** Resolver/concierge model choice is per-deployment; the substrate captures the model name + version in ResolutionReceipt for audit.
- **NOT a substitute for AI safety practices.** Prompt engineering, model-card discipline, dataset governance, etc. are app-layer; the substrate provides the architectural fence, not the model-internal safety.

## 7. Related

- [coordination-substrate.md](./coordination-substrate.md) §2.7 (DOC-1 + DOC-2 + three planes)
- [privacy-and-self-sovereign-identity.md](./privacy-and-self-sovereign-identity.md) (privacy posture per plane)
- [ADR-0022](./decisions/0022-authority-must-be-declarative.md) (authority must be declarative)
- [ADR-0023](./decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md) (attestation registry)
- [ADR-0024](./decisions/0024-intent-coordination-substrate.md) (intent coordination substrate)
- [spec 239 §4.5a](../../specs/239-intent-spine.md) (ResolutionReceipt)
- [spec 243 §4.1z](../../specs/243-payments.md) (open vs closed PaymentMandate)
- [spec 245](../../specs/245-a2a-task-adoption-in-mcp-runtime.md) (A2A Task in mcp-runtime)
- [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
- [NIST AI RMF Generative AI Profile](https://www.nist.gov/itl/ai-risk-management-framework)
- [Anthropic — Building effective AI agents](https://www.anthropic.com/engineering/building-effective-agents)

---

## Closing

The substrate's promise is not "an AI that can do anything you want." It is "an AI that can help you do anything you want — and every act that matters carries a typed, signed, inspectable artifact you can point to later." That is the difference between agentic software and trustworthy agentic infrastructure.

— Architecture-of-record locked 2026-06-02; revisit when AI roles or threat model materially shift.
