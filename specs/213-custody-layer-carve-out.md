# Spec 213 — Custody-layer carve-out

**Status:** draft · 2026-05-21
**Purpose:** implement the **vocabulary firewall** between custody and agency that spec 212 § 2.2 pins. Today the repo accidentally uses agentic-domain language (`ThresholdValidator`, `AdminAction.AddOwner`, `proposeAdmin`, `threshold`, `_owners`, `guardians`) for custody-layer concerns. This spec is the multi-session refactor plan that brings the contracts + info-arch + ontology + package surface into alignment with the two-layer architecture.
**Builds on:** spec 212 (agent-centric delegation — the principle), spec 207 (the policy machinery being renamed), spec 209 (modular core taxonomy receiving updates), spec 210/211 (cross-reference downstream).
**Does NOT change:** agency layer (`Delegation`, `Caveat`, `Enforcer`, `Steward`, `Agent`, `mintDelegationToken`, `verifyDelegationToken`, `@agenticprimitives/delegation`). The agency layer is well-named already.

---

## 1. The problem

Spec 212 § 2.2 defined two authority modalities (Admin / Stewardship) and two parallel vocabularies (custody-layer / agency-layer). But the existing implementation embeds agency-layer vocabulary in custody-layer code:

- `ThresholdValidator` is a CUSTODY policy contract, not an agency validator. Named wrong.
- `AdminAction.AddOwner` is a CUSTODY action — adding a custodian, not "an owner."
- `proposeAdmin` / `executeAdmin` are CUSTODY workflows.
- `threshold` (the state var) is an "approvals required" count for custodian quorum.
- `_owners` (the AgentAccount mapping) is `_custodians`.
- `guardians` (recovery role) are `trustees`.

The architectural rule (spec 212): UI surfaces use custody-layer terms; SDK / contract / spec / audit surfaces use the layer-appropriate terms. The current contracts violate this because they use agency-domain words for custody-domain concerns.

**This is not a display concern.** It's a contract-level + info-arch + ontology mismatch. The names leak through the SDK, audit events, debug surfaces, and developer-facing docs. Fixing only the UI would leave the layer boundary porous.

---

## 2. Target end-state (post-carve-out)

### 2.1 Contracts

```
packages/contracts/src/
├── AgentAccount.sol            ← unchanged shape, custodian-renamed state
├── AgentAccountFactory.sol     ← unchanged shape, custodian-renamed call signatures
├── DelegationManager.sol       ← agency layer, untouched
├── custody/                    ← NEW dir
│   ├── CustodyPolicy.sol       ← was modules/ThresholdValidator.sol
│   └── CustodyPolicy.AUDIT.md  ← was a partial section; now per-module audit
├── agency/                     ← NEW dir (reserved for future)
│   └── (empty in v0; future SessionKeyValidator, DelegationExecutor land here)
├── enforcers/                  ← agency layer, unchanged
│   ├── TimestampEnforcer.sol
│   ├── AllowedTargetsEnforcer.sol
│   ├── AllowedMethodsEnforcer.sol
│   ├── ValueEnforcer.sol
│   ├── QuorumEnforcer.sol
│   └── (per-enforcer AUDIT.md files unchanged)
└── libraries/
    └── SignatureSlotRecovery.sol  ← shared utility, layer-neutral
```

### 2.2 Custody-layer contract surface

**Contract**: `CustodyPolicy` (was `ThresholdValidator`)

**Enum**: `CustodyAction` (was `AdminAction`)

| Old enum value | New enum value | Notes |
| --- | --- | --- |
| `AddOwner` | `AddCustodian` | |
| `RemoveOwner` | `RemoveCustodian` | |
| `AddPasskey` | `AddPasskeyCredential` | "Passkey" stays — it's a recognized term |
| `RemovePasskey` | `RemovePasskeyCredential` | |
| `AddGuardian` | `AddTrustee` | |
| `RemoveGuardian` | `RemoveTrustee` | |
| `ChangeMode` | `ChangeCustodyMode` | |
| `UpgradeImpl` | `ApplySystemUpdate` | (Cut C upgrade — was UpgradeImpl) |
| `ChangeDelegationManager` | `RotateDelegationManager` | "Rotate" is the canonical custody verb |
| `ChangePaymaster` | `RotatePaymaster` | |
| `ChangeSessionIssuer` | `RotateSessionIssuer` | |
| `RotateAllOwners` | `RotateAllCustodians` | |
| `ChangeT3Ceiling` | `ChangeValueCeiling` | "T3" is technical jargon — strip from user surface |
| `SetRecoveryThreshold` | `SetRecoveryApprovals` | Matches "approvals required" convention |
| `RecoverAccount` | `RecoverAccount` | (already user-friendly; keep) |

**Functions**: rename to scheduling verbs.

| Old function | New function |
| --- | --- |
| `proposeAdmin(account, action, args, sigs)` | `scheduleCustodyChange(account, action, args, sigs)` |
| `executeAdmin(account, changeId, sigs)` | `applyCustodyChange(account, changeId, sigs)` |
| `cancelAdmin(account, changeId, sigs)` | `cancelScheduledChange(account, changeId, sigs)` |
| `mode(account)` | `custodyMode(account)` |
| `threshold(account, tier)` | `approvalsRequired(account, tier)` |
| `recoveryThreshold(account)` | `recoveryApprovals(account)` |
| `guardianCount(account)` | `trusteeCount(account)` |
| `isGuardian(account, addr)` | `isTrustee(account, addr)` |
| `proposalCount(account)` | `scheduledChangeCount(account)` |
| `getPendingAdmin(account, id)` | `getScheduledChange(account, id)` |

**State variables** (in `Config` struct, per-account):

| Old | New |
| --- | --- |
| `thresholdByTier` mapping | `approvalsRequiredByTier` |
| `timelockByTier` mapping | `safetyDelayByTier` |
| `guardians` mapping | `trustees` |
| `guardianCount` | `trusteeCount` |
| `nextProposalId` | `nextChangeId` |
| `pending` mapping | `scheduled` mapping |
| `proposerSigners` mapping | `proposerCustodians` mapping |

**EIP-712 typed structs** (the off-chain typed-data signing surface):

| Old typehash | New typehash |
| --- | --- |
| `AdminProposeRequest` | `ScheduleCustodyChangeRequest` |
| `AdminExecuteRequest` | `ApplyCustodyChangeRequest` |
| `AdminCancelRequest` | `CancelScheduledChangeRequest` |

EIP-712 domain `name` stays `"agenticprimitives.ThresholdValidator"` → updates to `"agenticprimitives.CustodyPolicy"`. **This is a wire-format change** — any client that was signing against the old domain produces invalid sigs against the new domain. Acceptable because we redeploy fresh.

### 2.3 AgentAccount surface renames

| Old | New |
| --- | --- |
| `_owners` mapping | `_custodians` |
| `_ownerCount` | `_custodianCount` |
| `addOwner(addr)` | `addCustodian(addr)` |
| `removeOwner(addr)` | `removeCustodian(addr)` |
| `isOwner(addr)` | `isCustodian(addr)` |
| `ownerCount()` | `custodianCount()` |
| `OwnerAdded(addr)` event | `CustodianAdded(addr)` |
| `OwnerRemoved(addr)` event | `CustodianRemoved(addr)` |
| `OwnerAlreadyExists(addr)` error | `CustodianAlreadyExists(addr)` |
| `OwnerDoesNotExist(addr)` error | `CustodianDoesNotExist(addr)` |
| `CannotRemoveLastOwner()` error | `CannotRemoveLastCustodian()` |
| `NotOwnerOrSelf()` error | `NotCustodianOrSelf()` |

### 2.4 Factory surface renames

| Old | New |
| --- | --- |
| `createAccount(owner, salt)` | `createAccount(custodian, salt)` (parameter rename only) |
| `createAccountWithMode(params, validator, salt)` | `createAccountWithMode(params, custodyPolicy, salt)` |
| `createAccountWithModeCustomT4(params, validator, t4TimelockSeconds, salt)` | `createAccountWithModeCustomSafetyDelay(params, custodyPolicy, safetyDelaySeconds, salt)` |
| `AgentAccountInitParams.owners` field | `AgentAccountInitParams.custodians` |
| `AgentAccountInitParams.guardians` field | `AgentAccountInitParams.trustees` |
| `NoPrimarySigner` error | `NoPrimaryCustodian` |
| `InsufficientGuardiansForMode` error | `InsufficientTrusteesForMode` |
| `AgentAccountCreatedWithMode` event arg `nGuardians` | `nTrustees` |

### 2.5 Ontology

New ontology turtle file: `docs/ontology/ap-custody.ttl` (mirrors smart-agent's tbox pattern).

```turtle
@prefix ap:   <https://agenticprimitives.dev/ontology#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

ap:Custodian
    a owl:Class ;
    rdfs:subClassOf prov:Agent ;
    rdfs:label "Custodian" ;
    rdfs:comment "A Smart Agent (typically a Person Smart Agent) that holds custody authority over another Smart Agent. Member of a CustodyCouncil. Authorizes scheduled custody changes via m-of-n approvals." .

ap:Trustee
    a owl:Class ;
    rdfs:subClassOf prov:Agent ;
    rdfs:label "Trustee" ;
    rdfs:comment "A Smart Agent that holds recovery authority. Distinct from Custodian — trustees only act when the routine custody set is unavailable (lost passkeys, compromised custodians). T6 recovery quorum." .

ap:CustodyCouncil
    a owl:Class ;
    rdfs:subClassOf prov:Collection ;
    rdfs:label "Custody Council" ;
    rdfs:comment "The set of Custodians for a given Smart Agent. Has an `approvalsRequired` count and per-tier custody policy." .

ap:CustodyPolicy
    a owl:Class ;
    rdfs:subClassOf prov:Plan ;
    rdfs:label "Custody Policy" ;
    rdfs:comment "The plan that governs how a Smart Agent's CustodyCouncil makes changes: approvals required per tier, safety delays per tier, recovery semantics. Implemented on-chain by the CustodyPolicy contract." .

ap:ScheduledCustodyChange
    a owl:Class ;
    rdfs:subClassOf prov:Activity ;
    rdfs:label "Scheduled Custody Change" ;
    rdfs:comment "An Activity representing a queued custody change awaiting its safety delay + approvals. Has an `eta`, a `changeId`, and a `proposerCustodian` set." .

# Object properties

ap:hasCustodian rdfs:domain prov:Agent ; rdfs:range ap:Custodian .
ap:hasTrustee   rdfs:domain prov:Agent ; rdfs:range ap:Trustee .
ap:hasCustodyPolicy  rdfs:domain prov:Agent ; rdfs:range ap:CustodyPolicy .
ap:approvalsRequired rdfs:domain ap:CustodyPolicy ; rdfs:range xsd:integer .
ap:safetyDelay       rdfs:domain ap:CustodyPolicy ; rdfs:range xsd:integer .
```

These classes are FORMALLY DISTINCT from the agency-layer classes (`ap:ServiceAgent`, the future `ap:DelegationToken`, etc.). The ontology embodies the vocabulary firewall.

### 2.6 Package boundary

New package: **`@agenticprimitives/account-custody`**.

```
packages/account-custody/
├── src/
│   ├── index.ts                 ← public exports
│   ├── policy.ts                ← CustodyPolicyClient (off-chain helper for typed-data signing + chain calls)
│   ├── actions.ts               ← CustodyAction enum + per-action arg builders (buildAddCustodianArgs, etc.)
│   ├── eip712.ts                ← typed-data hash helpers for the three Request types
│   ├── types.ts                 ← Custodian, Trustee, CustodyCouncil, ScheduledChange types
│   └── audit.ts                 ← PROV-O Activity helpers for emitting `prov:ScheduledCustodyChange` records
├── CLAUDE.md
├── AUDIT.md
└── package.json
```

**Dependencies**: `@agenticprimitives/types`, `viem` — and nothing else (this matches `capability.manifest.json` `allowedImports`; the package's `src/` imports no `connect-auth` Signer type today). NOT dependent on `delegation` or `agent-account` — `account-custody` is a leaf; the re-shape in which it becomes upstream of both is future work, not wired (no cycles today).

**What moves into `custody/` from existing packages**:
- From `@agenticprimitives/agent-account`: the `agentAccountAbi`, `agentAccountFactoryAbi`, `quorum.ts` helpers (insofar as they're custody-related — the `packSafeSignatures` etc.) — these stay in `agent-account` if they're used by both layers; move only if exclusively custody.
- From `@agenticprimitives/delegation`: the `buildQuorumCaveat` helper that interacts with the quorum-enforcer — STAYS in delegation (it's an agency caveat that happens to compose with custody's signature shape). Document the cross-layer dependency.

**What doesn't move**:
- Caveat enforcers (agency layer)
- `Delegation` / `Caveat` types (agency layer)
- `DelegationManager` contract surface (agency layer)
- `AgentAccount` itself (layer-neutral core)

### 2.7 Specs renamed / updated

- **Spec 207** retitled: `Smart-account custody policy` (was "Smart-account threshold policy"). Every "threshold" → "approvals required". "Owner" → "custodian". "Guardian" → "trustee". "ThresholdValidator" → "CustodyPolicy". "AdminAction" → "CustodyAction". Section headers updated.
- **Spec 209** ERC-7579 module taxonomy: `ThresholdValidator` reference becomes `CustodyPolicy`; the module-class label says "Custody Policy (was Threshold Validator)" for one cycle to ease migration.
- **Spec 210** Treasury cross-references updated.
- **Spec 211** v3 vocabulary table aligned to custody terms; act ladder updated to use custody-language identifiers in code samples.
- **Spec 212** (the firewall principle) — adds back-references to spec 213 (where the rule is implemented) + spec 207 (the renamed custody policy).

### 2.8 Memory entries

The vocabulary firewall is canonized in memory:

- `feedback_two_layer_vocabulary.md` (NEW) — pins the custody/agency vocabulary firewall as a hard architectural rule. Future sessions can't accidentally re-introduce agency-domain terms into custody surfaces.
- `feedback_agent_centric_delegation.md` (existing) — gets a paragraph cross-referencing the carve-out.

---

## 3. Migration plan — phased

| Phase | What lands | Tests must pass | Effort |
| --- | --- | --- | --- |
| **6g.0 (this spec)** | Spec 213 + ontology turtle file + memory entries. NO code changes. | n/a — docs only | ~2-3 hours |
| **6g.1** | Contract rename: CustodyPolicy + CustodyAction + scheduleCustodyChange + state vars + AgentAccount custodian-renames + factory custodian-renames. All Forge tests adapted. Redeploy CustodyPolicy + AgentAccount impl + Factory. | 172 Forge tests + 191 workspace tests must still pass | ~5-7 hours |
| **6g.2** | Directory restructure: `packages/contracts/src/{custody,agency,enforcers}/`. Import paths updated. Deploy.s.sol paths updated. | Tests still pass post-restructure | ~1-2 hours |
| **6g.3** | New `@agenticprimitives/account-custody` package. Pull custody-related SDK surfaces in. CLAUDE.md + AUDIT.md. Workspace dependencies updated. | Workspace builds + typechecks | ~3-5 hours |
| **6g.4** | Specs 207/209/210/211 updated to custody vocabulary. Cross-references + memories refreshed. | All `pnpm check:*` rails pass | ~2-3 hours |

Total: **~13-20 hours, 4-5 sessions**.

After 6g.4 lands, phase 6f.1 (Treasury demo shell) starts with the new naming clean from the start.

---

## 4. Risk + mitigation

| Risk | Mitigation |
| --- | --- |
| Broken Forge tests during rename | Land 6g.1 in one atomic commit per file; run tests after each major file. Use a feature branch if needed. |
| Demo apps stop building | Two passes through the workspace: first rename contracts + types, then SDK + apps. Each pass keeps the WORLD compiling even if some surfaces are temporarily inconsistent. |
| Live deployments orphaned | Existing accounts on `0x6Bb5...`, `0x994A26D...`, etc. won't be reachable through the new CustodyPolicy. Treat them as museum pieces; create fresh accounts via the renamed factory. |
| Spec drift mid-rename | Lock the spec set during 6g.1-6g.3; only update specs in 6g.4 as a coherent batch. |
| Cross-package import cycles | Custody package has NO downstream deps. Only upstream (`types`, `connect-auth` type-only). Documented in CLAUDE.md. |
| External consumers of `@agenticprimitives/agent-account` see breaking renames | Acceptable — we're pre-1.0. Document in CHANGELOG once we ship one. |

---

## 5. Why not just rename in UI

The user (2026-05-21 planning round): *"This is not a display thing. I want contract terms and info arch and ontology to reflect this also."*

The architectural commitment: agenticprimitives' value proposition is **a substrate for accountable autonomous agents** (per spec 212). A substrate that uses one vocabulary in its source code and a different vocabulary in its UI has a leak — the abstraction isn't real, it's a paint job. Developers reading `ThresholdValidator.proposeAdmin(account, AdminAction.AddOwner, ...)` would form the wrong mental model of the layer they're working in, regardless of how the UI presents it. Spec 213 closes the leak.

The cost (15-20 hours of refactor + redeploy) is the price of architectural integrity. It's worth paying now, while the codebase is still small enough to refactor cleanly, rather than 6 months later when the agency-domain words are deeply entrenched in user code, external integrations, and audit history.

---

## 6. Open questions

- **`packGasLimits`-style utilities** in `@agenticprimitives/agent-account/src/quorum.ts` — do they belong in custody (they encode custody signature aggregation)? Provisional answer: keep in `agent-account` for now; move only if a clear consumer in the custody package needs them.
- **Are events also a wire-format change?** Renaming `OwnerAdded` → `CustodianAdded` changes the topic hash. Off-chain indexers watching the old topic stop seeing events. Acceptable for a pre-1.0 redeploy; flag in 6g.1 commit message.
- **`org-mode`** keyword in `AdminAction.ChangeMode` — does the mode taxonomy (`single` / `hybrid` / `threshold` / `org`) survive the rename? Yes — modes are custody-policy posture, not agency. Names stay.
- **`spec-id` for the ontology turtle**: spec 210's ontology + spec 213's ontology + future ontologies — do they live in one `docs/ontology/*.ttl` or split per-spec? Provisional answer: split per-spec, with a top-level `docs/ontology/README.md` indexing them.

---

## 7. Cross-references

- [`specs/212-agent-centric-delegation.md`](./212-agent-centric-delegation.md) — the principle being implemented
- [`specs/207-smart-account-threshold-policy.md`](./207-smart-account-threshold-policy.md) — gets retitled in 6g.4 to "Smart-account custody policy"
- [`specs/209-erc7579-module-taxonomy.md`](./209-erc7579-module-taxonomy.md) — module table gets `CustodyPolicy` instead of `ThresholdValidator`
- [`specs/210-treasury-service-agent.md`](./210-treasury-service-agent.md) — references update
- [`specs/211-treasury-service-agent-demo.md`](./211-treasury-service-agent-demo.md) — vocabulary table aligns
- Memories: [[agent-centric-delegation]], [[two-layer-vocabulary]] (new), [[multi-sig-is-safety-and-recovery]], [[demo-web-treasury-flagship]]
