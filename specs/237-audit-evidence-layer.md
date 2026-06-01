# Spec 237 — Audit Evidence Layer

**Status:** v0 draft · 2026-06-01
**Drivers:** value proposition, audit cost, regulatory readiness,
enterprise procurement, AI-agent verifiability.
**Companion ADR:**
[ADR-0022 — Authority MUST be declarative](../docs/architecture/decisions/0022-authority-must-be-declarative.md).
**Reference:** smart-agent has the same need at the application level;
this spec lifts it to the platform substrate.

---

## 1. The thesis

> Security audits today are **code archaeology**. The auditor reads
> tens of thousands of lines of source to reconstruct an authority
> model that lives implicitly across modifiers, RBAC tables, JWT
> claims, OAuth scopes, smart-contract guards, microservice policies,
> and runtime config.
>
> agenticprimitives can make audits **graph verification** instead.
> Authority is already a first-class object in our substrate
> (delegations, caveats, custody policies, capability manifests,
> ontology). If we surface that authority **declaratively** and
> **machine-verifiably**, an auditor — human or AI — can answer
> "who can do what, granted by whom, under what constraints" by
> querying a graph, not by reading code.

This is the differentiation. Most platforms call themselves
"security-focused"; we can earn the stronger claim:

> **agenticprimitives is an authority-native platform. Audits become
> graph verification problems rather than code archaeology problems.**

That is what this spec calls the **Audit Evidence Layer** (AEL).

## 2. What "authority audit" looks like today (the baseline)

A typical security review of a web3 + agent system has to answer:

- Who can move funds?
- Who can issue credentials?
- Who can change configuration?
- Who can upgrade contracts?
- Can authority be delegated?
- Can authority be escalated?
- Can authority be revoked?
- Can authority outlive its owner?

In a traditional stack the answers are scattered across:

| Surface | Where authority lives | Audit friction |
|---|---|---|
| Smart contracts | `onlyOwner`, `onlyGovernance`, `onlySelf`, custom modifiers | Read every modifier transitively |
| Backend services | JWT claims, OAuth scopes, RBAC tables, route middleware | Read every route + the SSO config |
| Frontend | UI gates, optimistic checks | Read every component |
| Storage | DB rows that grant roles | Read every schema + seed migration |
| Off-chain auth | passkey origin pinning, SIWE nonce binding | Read auth library config + every consumer |
| Delegation | Token claims, caveats, expiration, audience | Read the token format + every issuer/verifier |
| Recovery | Trustee quorum, timelock | Read each recovery flow per contract |

The auditor's job is **reverse-engineering intent from implementation**.
That's the cost driver: most of the time is spent inferring "what
should be true" before checking "is it true."

## 3. The principle we already live by

Other specs already commit us to declarative authority:

- [Spec 202 — Delegation](./202-delegation.md): authority granted between
  Smart Agents is an **EIP-712 typed object** with explicit
  delegator / delegate / authority chain / caveats / salt. Not a code path.
- [Spec 207 — Smart Account Threshold Policy](./207-smart-account-threshold-policy.md):
  custody decisions are **declarative configs** (mode, thresholds,
  trustees, recovery quorum, timelocks per tier) — not hard-coded.
- [Spec 205 — MCP Runtime](./205-mcp-runtime.md): the `withDelegation`
  wrapper validates an **explicit token + classification**; what a tool
  can do is policy data, not branching code.
- [ADR-0019 — Relying site authority](../docs/architecture/decisions/0019-relying-site-authority-is-a-scoped-delegation.md):
  every relying app's authority is a **scoped delegation** from a
  Person SA, not an implicit OAuth scope.
- [Spec 226 — Ontology](./226-ontology-formal.md): every actor, role,
  and capability has a **formal-ontology term**, machine-queryable.

This spec is the next step. It says:

> **Every sensitive capability the platform offers SHALL have a
> declarative manifest entry, machine-readable, schema-validated, and
> CI-enforced.** Implementation either matches the manifest, or CI
> refuses the PR. The manifest — not the code — is the source of
> truth for "who can do what."

## 4. The Audit Evidence Layer (concrete)

### 4.1 Three artifacts

**(A) Capability Manifest Extensions.** Every package's
`capability.manifest.json` (17 today) gets an **authority section**:

```jsonc
{
  "name": "@agenticprimitives/<pkg>",
  // existing: kind, stability, imports, publicExports, forbiddenTerms, ...
  "authority": {
    "capabilities": [
      {
        "id": "delegation.mint",
        "summary": "Mint an EIP-712 delegation token bound to a session.",
        "grantedBy": "delegator-of-record (CAIP-10 SmartAgent)",
        "grantedTo": "delegate (CAIP-10 SmartAgent)",
        "requires": [
          "delegator-signature(EIP-712, DELEGATION_TYPEHASH)",
          "fresh-salt (PRNG, never reused)",
          "expiration-caveat (TimestampEnforcer)"
        ],
        "denies": [
          "self-grant (delegator == delegate)",
          "open-delegation without explicit ROOT_AUTHORITY"
        ],
        "evidence": {
          "spec": "../../specs/202-delegation.md#3-eip-712-types",
          "implementation": "src/mint.ts",
          "invariants": [
            "test/invariant/DelegationManager.invariant.t.sol#INV-2 (hash deterministic)",
            "test/invariant/DelegationManager.invariant.t.sol#INV-3 (DOMAIN_SEPARATOR immutable)"
          ],
          "audit-event": "delegation.mint"
        }
      }
    ]
  }
}
```

Schema in [Section 5](#5-schema-v01). Validation by a new
`pnpm check:capability-coverage` CI gate ([Section 7](#7-ci-gates)).

**(B) `@agenticprimitives/trust-model` (new package).** Typed
first-class objects + a graph traversal API:

```typescript
import {
  Person, Organization, ServiceAgent, Treasury,
  Authority, Delegation, Mandate, Capability,
  Policy, Custodianship, Commitment,
  buildTrustGraph, traverseAuthority,
} from '@agenticprimitives/trust-model';

const g = await buildTrustGraph({
  // sources we already maintain:
  delegations: dm.indexer(),               // from @agenticprimitives/delegation
  custodyPolicies: policy.indexer(),       // from @agenticprimitives/account-custody
  capabilityManifests: manifestsReader(),  // from this spec
  ontology: ontologyReader(),              // from @agenticprimitives/ontology
});

// Audit query: every path that can move funds from a Person SA.
const paths = traverseAuthority(g, {
  startsAt: { agentAddress: aliceSA },
  target:   { capability: 'value.transfer' },
});
```

Smallest viable version: a `TrustGraph` type + a `dump()` that
materialises what we **already** track via existing packages. No
authority is invented here — `trust-model` is a **read model** over
the substrate, mirroring the
[`identity-directory`](../packages/identity-directory) pattern from
[ADR-0015](../docs/architecture/decisions/0015-identity-directory-is-an-evidence-backed-read-model.md).

**(C) Audit Evidence Generator (`pnpm audit:evidence`).** A CLI that
collects every artifact a security firm / regulator / enterprise
customer asks for, and writes it to `/audit/<subdir>/`:

```
/audit
  /architecture
    package-graph.svg
    capability-graph.svg
  /threat-model
    threat-model.md       # composed from per-package AUDIT.md
  /capability-matrix
    capabilities.json     # union of all package authority sections
    capabilities.md       # human-readable rendering
  /delegation-matrix
    delegations.json      # every delegation EIP-712 typehash + caveat schema
    typehash-registry.md  # cross-stack: Solidity ↔ TS
  /contract-invariants
    foundry-invariants.json  # the R9 invariant inventory
    halmos-proofs.json       # the R9.3+ symbolic-proof inventory
    slither-report.sarif
    aderyn-report.md
  /frontend-security
    csp-report.json
    auth-flow-diagram.md
  /supply-chain
    sbom.cyclonedx.json     # already generated; symlink in
    pnpm-audit.json
    osv-scan.json
  /ci-results
    workflow-runs.md        # links + statuses
  /deployment-provenance
    deployments-<network>.json    # already committed; symlink in
    deployer-signatures.json      # tx-hashes that produced each address
  /runtime-monitoring
    monitor-config.md       # what we watch + thresholds
  audit-readiness-report.md  # the entrypoint: traffic-light summary
```

The generator is purely a collector — every artifact already exists
or is generated by another step (the R9 wave produces the
contract-invariants/, the security.yml workflow produces the
supply-chain/ scans, etc.). `audit:evidence` is the assembler.

### 4.2 Naming

The product-facing name is the bigger artifact than the script. We
suggest:

> **Agentic Audit Evidence Layer** (technical name)
> **Machine-Verifiable Trust Posture** (procurement-facing)

Pitch line for the top-level README, replacing "composable primitives
for agentic web3 apps":

> Composable, **machine-verifiable** primitives for building agentic
> web3 apps. Every capability the platform offers is a declarative
> authority object. Audits become graph queries.

## 5. Schema (v0.1)

Adds one optional top-level key `authority` to the existing
`capability.manifest.json` schema:

```typescript
interface CapabilityManifest {
  // ... existing fields (name, kind, stability, imports, ...)

  /** R9 / spec 237 — declarative authority surface. */
  authority?: {
    capabilities: AuthorityCapability[];
  };
}

interface AuthorityCapability {
  /**
   * Unique within the package. Recommended dotted form:
   *   `<owning-concept>.<verb>`
   * Examples:
   *   `delegation.mint`
   *   `delegation.redeem`
   *   `delegation.revoke`
   *   `custody.schedule-change`
   *   `custody.recover`
   *   `agent-naming.register`
   *   `mcp-runtime.tool-call`
   */
  id: string;

  /** Human-readable one-liner. */
  summary: string;

  /**
   * The actor (typed by ontology term or CAIP-10 expression) who
   * grants this capability. Frequently the SmartAgent address;
   * "Person SA" / "Organization SA" / "ServiceAgent SA" for the
   * conceptual case.
   */
  grantedBy: string;

  /** Who the capability is granted to. Same notation as grantedBy. */
  grantedTo: string;

  /**
   * The proofs / preconditions the substrate enforces. Each entry is
   * a free-form short string that names a check (EIP-712 sig type,
   * caveat name, origin binding, audience binding, etc.). Validation
   * is intentionally lexical for v0.1; a future schema can constrain
   * to known enforcer names.
   */
  requires: string[];

  /**
   * What the capability MUST NOT permit. Negative space is as
   * important as positive — auditors care most about what's
   * impossible.
   */
  denies: string[];

  /** Evidence rows the audit-evidence generator picks up. */
  evidence: {
    /** Pointer to the canonical spec section. */
    spec: string;
    /** Pointer to the implementing file(s). */
    implementation: string | string[];
    /** Tests that lock the capability's claim. */
    invariants?: string[];
    /** Audit-event action name (consumed by the audit package). */
    "audit-event"?: string;
  };
}
```

## 6. What we have today (honest crosswalk)

The pitch is real because much of the substrate is already declarative.
This section names what exists and what's missing per concern. The
companion document
[`docs/architecture/audit-evidence-crosswalk.md`](../docs/architecture/audit-evidence-crosswalk.md)
breaks this down per package.

| Concern | Today | Gap |
|---|---|---|
| Package boundaries | 17 `capability.manifest.json` files, CI-checked | Authority section (Section 5) |
| Authority granted between SAs | EIP-712 `Delegation` struct, on-chain hash, revoke registry | Per-capability manifest entry |
| Custody policy | Per-account `Config` (mode, thresholds, trustees, timelocks), EIP-712 schedule/apply/cancel typehashes | Declarative manifest version |
| Threat model | Per-package `AUDIT.md` + `apps/demo-mcp/docs/audit/guide.md` | Composed top-level threat-model.md |
| Permission matrix | Implicit in delegation caveats + `tool-policy` classifications | Explicit matrix.json |
| Invariant tests | R9 wave (CustodyPolicy, DelegationManager, Paymaster); Halmos UV + onlySelf | Per-capability rollup |
| Storage layout | Per-contract snapshots in `test/storage-layouts/`, CI-checked | (none — done) |
| EIP-712 typehash registry | Inlined in each contract + `@agenticprimitives/delegation` TS types | Generated cross-stack registry |
| CI scan results | Slither + Aderyn + CodeQL + Solhint + Halmos + pnpm-audit + gitleaks + SBOM | Composed evidence bundle |
| Release provenance | npm OIDC publish (R4); changesets | Per-version signed manifest |
| Deployment records | `deployments-<network>.json` committed per address change | Tx-hash signatures + signer-of-record |
| Runtime monitoring | (none) | Monitor config + thresholds doc |

The Audit Evidence Generator's job is to surface every Yes row and
flag every Gap row.

## 7. CI gates

Three new gates, each PR-blocking once the schema lands:

1. **`check:capability-coverage`**
   - Every package's `authority.capabilities[*].evidence.implementation`
     MUST resolve to a real file path.
   - Every `evidence.spec` MUST resolve to a real spec section.
   - Every `evidence.audit-event` MUST appear in
     `@agenticprimitives/audit`'s known action enum.
   - Every `evidence.invariants` MUST resolve to a real test path.

2. **`check:authority-graph`**
   - Every delegation type in `@agenticprimitives/delegation` MUST
     declare `chainId`, `audience`, `origin`, `nonce`, `expiry`
     surfaces in its manifest entry.
   - Every `acceptedOnChain` path in `tool-policy` MUST declare a
     custody-quorum requirement in its manifest entry.

3. **`check:audit-evidence-completeness`**
   - `pnpm audit:evidence` MUST succeed.
   - Generated `audit-readiness-report.md` MUST show 0 RED rows for
     packages tagged `stability: stable`.

## 8. Phasing

| Wave | Slice | PR scope |
|---|---|---|
| W0 | Spec + ADR + crosswalk (this) | Docs only, 1 PR |
| W1 | Schema in `check:capability-manifests` | Validate `authority` block, no enforcement yet |
| W2 | First 3 packages adopt: `delegation`, `account-custody`, `agent-naming` | High-leverage; sets the pattern |
| W3 | `pnpm audit:evidence` skeleton | Collector for what already exists; empty sections marked GAP |
| W4 | `@agenticprimitives/trust-model` v0 | Read model over delegation + custody indexers |
| W5 | Remaining 14 packages adopt | Mechanical, parallelisable |
| W6 | CI gates flip to PR-blocking | Authority closure becomes enforceable |
| W7 | `audit-readiness-report.md` becomes a release artifact | Procurement-facing |

W0 is **this PR** plus the ADR plus the crosswalk doc — no code, no
schema enforcement. W1 starts the schema work in a separate PR after
this one merges.

## 9. Risks + rebuttals

**R1. "This is documentation theater."**
The CI gates in [Section 7](#7-ci-gates) make it executable. A manifest
that points at a nonexistent file fails the build; a capability
declared without invariant coverage fails the build; a delegation type
without `nonce + expiry` declared fails the build. If a PR can ship
without writing the manifest entry, the layer is theater. The gates
exist so it cannot.

**R2. "The schema will explode in scope."**
v0.1 keeps the schema lexical: free-form strings for `requires` /
`denies`, with discipline driven by review. A future v0.2 can
constrain `requires` to known enforcer names (`TimestampEnforcer`,
`AllowedTargetsEnforcer`, …). Starting strict would block the
adoption curve; starting loose preserves momentum.

**R3. "Auditors won't trust generated evidence."**
Each evidence row points to:
- a spec section (the intent),
- a file in the implementation (the proof),
- a test that locks it (the witness).
The auditor can spot-check any row by following the three pointers.
The Audit Evidence Generator's value isn't replacing auditor judgment;
it's eliminating the time spent **assembling** the artifacts to
exercise judgment on.

**R4. "We're already shipping; this is a distraction."**
The first 3 packages adopt incrementally (W2). Until W6 the gates are
advisory. The substrate work that justifies the pitch is **already
done** (R9 wave invariant suites + Halmos proofs; the 17 capability
manifests; the EIP-712 delegation registry; the per-contract storage
snapshots). This spec connects them; it does not invent them.

## 10. What this is NOT

- NOT a replacement for security audits. The Layer makes audits
  efficient; it does not eliminate them.
- NOT a SIEM / runtime monitoring product. Spec 240 / `audit` package
  cover the runtime event surface. The Layer collects them as evidence.
- NOT a marketing slogan with no teeth. CI gates have teeth.
- NOT a separate platform. It IS agenticprimitives, made legible.

## 11. References

- ADR-0010 — Canonical Smart Agent Identifier Rule
- ADR-0015 — `identity-directory` as an evidence-backed read model
  (the pattern `trust-model` mirrors)
- ADR-0019 — Relying-site authority is a scoped delegation
- ADR-0020 — Faceted agent identity doctrine
- ADR-0022 — Authority MUST be declarative (this spec's companion)
- Spec 100 — Package Boundary Doctrine (the existing manifest schema)
- Spec 202 — Delegation
- Spec 205 — MCP Runtime
- Spec 206 — Audit (event surface this spec collects from)
- Spec 207 — Smart Account Threshold Policy
- Spec 226 — Ontology
- `docs/architecture/audit-evidence-crosswalk.md` — package-by-package
  gap analysis
