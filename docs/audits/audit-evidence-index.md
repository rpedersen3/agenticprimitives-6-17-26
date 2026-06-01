# Audit Evidence Index

| Field | Value |
|---|---|
| **Last refreshed** | 2026-06-01 |
| **Purpose** | Single-page index pointing at every artifact a third-party auditor needs. **Read this first.** Each row gives (artifact, where it lives, generator workflow, last-green-run timestamp guidance). |
| **Reading order for auditors** | (1) this doc → (2) [R10 readiness assessment](./2026-06-01-r10-internal-readiness-assessment.md) → (3) [`packages/contracts/AUDIT.md`](../../packages/contracts/AUDIT.md) → (4) per-package `AUDIT.md` files. Findings + ground truth pointers in each. |

This is the **manual minimum-viable** version of the
[spec 237 § 4.1](../../specs/237-audit-evidence-layer.md) Audit Evidence
Generator deliverable. When `pnpm audit:evidence` lands (spec 237 W3),
this doc will be auto-generated.

---

## 1. Specifications & doctrine

| Artifact | Path | Status |
|---|---|---|
| Master audit dossier spec | [`specs/214-production-audit-dossier.md`](../../specs/214-production-audit-dossier.md) | The target shape we're auditing toward |
| Package boundary doctrine | [`specs/100-package-boundary-doctrine.md`](../../specs/100-package-boundary-doctrine.md) | CI-enforced |
| Audit Evidence Layer (R10 direction) | [`specs/237-audit-evidence-layer.md`](../../specs/237-audit-evidence-layer.md) | v0 draft |
| Package Design v2 (R10 direction) | [`specs/238-package-design-v2-ai-composability.md`](../../specs/238-package-design-v2-ai-composability.md) | v0 draft |
| Canonical SA identifier rule | [`docs/architecture/decisions/0010-smart-agent-canonical-identifier.md`](../architecture/decisions/0010-smart-agent-canonical-identifier.md) | Load-bearing |
| Credentials rotate; identity persists | [`docs/architecture/decisions/0011-credential-recovery-and-re-association.md`](../architecture/decisions/0011-credential-recovery-and-re-association.md) | Load-bearing |
| No `eth_getLogs` in product read paths | [`docs/architecture/decisions/0012-no-eth-getlogs-in-product-read-paths.md`](../architecture/decisions/0012-no-eth-getlogs-in-product-read-paths.md) | Doctrine |
| No silent fallbacks | [`docs/architecture/decisions/0013-no-silent-fallbacks.md`](../architecture/decisions/0013-no-silent-fallbacks.md) | Doctrine |
| Authority MUST be declarative | [`docs/architecture/decisions/0022-authority-must-be-declarative.md`](../architecture/decisions/0022-authority-must-be-declarative.md) | R10 doctrine |

## 2. Audit dossier docs

| Artifact | Path | Last refreshed |
|---|---|---|
| **R10 internal readiness assessment** (prioritized P0/P1/P2/P3) | [`2026-06-01-r10-internal-readiness-assessment.md`](./2026-06-01-r10-internal-readiness-assessment.md) | 2026-06-01 |
| Product readiness audit (system-level) | [`docs/architecture/product-readiness-audit.md`](../architecture/product-readiness-audit.md) | 2026-06-01 (R9 wave) |
| Contracts AUDIT.md (dossier) | [`packages/contracts/AUDIT.md`](../../packages/contracts/AUDIT.md) | 2026-06-01 (R9 wave) |
| Per-package AUDIT.md files | [`packages/<name>/AUDIT.md`](../../packages/) | 2026-05-23 (R6 wave); R10 P0.2 refresh follow-up |
| R9 static-analysis triage (Slither + Aderyn) | [`r9-static-analysis-triage.md`](./r9-static-analysis-triage.md) | 2026-06-01 |
| R6 contracts recon (pre-R9 wave) | [`r6-contracts-recon-2026-05-31.md`](./r6-contracts-recon-2026-05-31.md) | 2026-05-31 |
| Threat model | [`threat-model.md`](./threat-model.md) | Stale (ARCH-005 refresh queued) |
| Architecture diagram | [`architecture-diagram.md`](./architecture-diagram.md) | Stale (ARCH-005) |
| Evidence checklist (per-control) | [`evidence-checklist.md`](./evidence-checklist.md) | Stale (ARCH-005) |
| Supply-chain audit + accepted-findings | [`supply-chain.md`](./supply-chain.md) | 2026-06-01 (Vitest CVE allowlisted) |

## 3. Contract-side test evidence

### 3.1 Foundry tests + invariants

| Suite | Path | What it locks | CI status |
|---|---|---|---|
| Total Foundry test corpus | `packages/contracts/test/**/*.t.sol` | 680 tests across 37 .sol files | PR-blocking in `ci.yml` → `Forge tests` job |
| CustodyPolicy stateful invariants | `test/invariant/CustodyPolicy.invariant.t.sol` | thresholds nonzero · recoveryApprovals ≤ trusteeCount · mode ∈ {0..3} · changeCount monotonic · uninstalled views zero | PR-blocking; 25,600 calls × 5 invariants |
| DelegationManager invariants | `test/invariant/DelegationManager.invariant.t.sol` | revocation irreversible · hash deterministic · DOMAIN_SEPARATOR immutable · constants unchanged · revoked-set monotonic | PR-blocking; 25,600 calls × 5 invariants |
| SmartAgentPaymaster invariants | `test/invariant/SmartAgentPaymaster.invariant.t.sol` | devMode locked · governance immutable · verifyingSigner locked · arbitrary-sender not accepted · governance gate holds for fresh caller | PR-blocking; 25,600 calls × 5 invariants |
| AgentAccount unit invariants | `test/AgentAccountInvariants.t.sol` | passkey + custodian count consistency, PIA mapping, rpIdHash flow | PR-blocking |
| Enforcer pause invariants | `test/EnforcerPauseInvariantR67.t.sol` | enforcers are stateless (no SSTORE, no events; pause not applicable) | PR-blocking |
| H-6 cap regression suite (R9.6) | `test/AgentAccountFactoryMaxCustodiansR96.t.sol` | `MAX_INITIAL_CUSTODIANS = 32` enforced including uint8-truncation case | PR-blocking |
| Forge coverage floor | per-contract floors enforced by `scripts/check-forge-coverage.ts` | 90.3% lines / 76.6% branches on security-critical set | PR-blocking via `Doctrine + typecheck + tests` |
| Storage-layout snapshots | `test/storage-layouts/*.json` + `pnpm check:storage-layouts` | layout drift for AgentAccount + CustodyPolicy + DelegationManager + SmartAgentPaymaster | PR-blocking |

### 3.2 Halmos symbolic proofs

| Proof | Path | What it proves over ALL inputs | CI |
|---|---|---|---|
| R8.2 UV gate | `test/halmos/WebAuthnLibUvR82.halmos.t.sol::check_R82_uvNotSet_with_requireUvTrue_alwaysRejects` | UV bit unset + `requireUv = true` → `verify` returns false | PR-blocking (`halmos` job in `security.yml`) |
| H7-C.1 UP gate | same file `::check_H7C1_upNotSet_alwaysRejects_regardlessOfRequireUv` | UP bit unset → `verify` returns false regardless of `requireUv` | PR-blocking |
| onlySelf — setDelegationManager | `test/halmos/AgentAccountOnlySelf.halmos.t.sol` | External caller cannot rotate the DM root of trust | PR-blocking |
| onlySelf — removeCustodian | same file | External caller cannot kick custodians | PR-blocking |
| onlySelf — setUpgradeTimelock | same file | External caller cannot disable the upgrade timelock | PR-blocking |
| onlySelf — upgradeToAndCall (UUPS) | same file | **Catastrophic if bypassable.** External caller cannot swap the implementation | PR-blocking |
| onlySelf — removePasskey | same file | External caller cannot un-register a credential | PR-blocking |

Run: `pnpm check:contracts-halmos` (terminates in ~0.13s).

### 3.3 Echidna nightly + Medusa weekend

| Tool | Workflow | Schedule | Artifact retention |
|---|---|---|---|
| Echidna 2.2.7 (HEVM) | `.github/workflows/contracts-echidna-nightly.yml` | 02:17 UTC nightly | 30 days corpus + coverage |
| Medusa 1.5.1 (go-ethereum) | `.github/workflows/contracts-medusa-weekend.yml` | 03:17 UTC Saturday | 60 days corpus + coverage |

Both are `continue-on-error: true` (artifact-only); graduates to PR-blocking once green track record is established (criteria in R10 P1.9).

### 3.4 Static analysis (SAST)

| Tool | Workflow | Fails CI? | Triage |
|---|---|---|---|
| Slither 0.11.5 | `security.yml::slither` | Fails on HIGH findings | M-1 false-positive triaged + `slither-disable-next-line` annotation (see `r9-static-analysis-triage.md`) |
| Aderyn 0.6.8 | `security.yml::aderyn` | Advisory artifact only | 6 HIGH categories triaged (1 actionable = H-6, closed in R9.6; 5 false positives or defensible design) |
| Solhint 5.x | `security.yml::solhint` | Fails on any rule-error | Focused security ruleset (not `solhint:recommended`); rationale in `packages/contracts/.solhint.md` |
| CodeQL JS/TS | `security.yml::codeql` | Fails on new high/critical | `security-extended` query pack |

### 3.5 Coverage + per-contract scorecards

| Surface | Source |
|---|---|
| Per-contract line + branch coverage (audit floor enforcement) | `scripts/check-forge-coverage.ts` + per-contract floors in source |
| Aggregator dashboard | run `pnpm check:forge-coverage` locally |
| Security-critical floor | All 11 sec-crit contracts ≥ 75% lines; 10/11 ≥ 80% branches; CustodyPolicy at 68% the remaining outlier (R10 P3.3) |

## 4. TS/JS package evidence

| Artifact | Path | What it locks | CI |
|---|---|---|---|
| Package boundary check | `pnpm check:package-boundaries` | dependency-graph one-way arrows; no back-edges | PR-blocking |
| Capability manifests check | `pnpm check:capability-manifests` | every `capability.manifest.json` validates against schema; `forbiddenTerms` enforced | PR-blocking |
| Public exports drift snapshot | `packages/<name>/api-surface.snap` + `pnpm check:api-surface` | flags any new / removed public export | PR-blocking |
| Forbidden terms grep | `pnpm check:forbidden-terms` | doctrine vocabulary firewall | PR-blocking |
| No private keys in app code | `pnpm check:no-app-private-keys` | catches accidental hex-key constants | PR-blocking |
| No deployment domains in packages | `pnpm check:no-domain-in-packages` | enforces generic-package doctrine (ADR-0021) | PR-blocking |
| Sentinel enforcer registry sync | `pnpm check:sentinel-enforcers` | off-chain sentinel addresses match on-chain enforcer registry | PR-blocking |
| ABI sync | `pnpm check:abi-sync` | TS-side ABI exports match Foundry-built ABIs | PR-blocking via `ci.yml::ABI sync check` |
| Cross-stack EIP-712 typehash equality | `packages/delegation/test/integration/cross-stack-typehashes.test.ts` | TS-side typehash computation == Solidity-side constant | Test passes today; CI gate to mark it pre-publish-required is R10 P0.3 |
| Vitest tests across packages | `pnpm -r test` | per-package unit + integration coverage | PR-blocking |
| Tool-policy fail-closed matrix | `packages/tool-policy/test/unit/decision-fail-closed.test.ts` | unknown / missing classification → deny (N8 closure) | PR-blocking |
| MCP-runtime production-strict surface | `packages/mcp-runtime/test/unit/with-delegation.test.ts` | production opts require classification + auditSink | PR-blocking |
| Fail-hard audit propagation (R11.1) | same file + `packages/delegation/test/unit/token.test.ts` + `packages/mcp-runtime/test/unit/service-mac.test.ts` | sink throws PROPAGATE; wrapper no longer swallows | PR-blocking |

## 5. Supply-chain + provenance

| Artifact | Source |
|---|---|
| `pnpm audit --audit-level=high` | `security.yml::dep-audit` (via `pnpm check:supply-chain` for allowlist honoring) — PR-blocking |
| Accepted CVE allowlist | `docs/audits/supply-chain.md` § "Accepted findings" + `scripts/audit-supply-chain.ts::ACCEPTED_PNPM_AUDIT_FINDINGS` |
| gitleaks secret scan | `security.yml::secret-scan` — PR-blocking on any committed secret |
| CycloneDX SBOM | `security.yml::sbom` — uploaded as workflow artifact (90-day retention); release workflow adds it as a release asset |
| npm OIDC publish provenance | `.github/workflows/release.yml` — Trusted Publishing, no NPM_TOKEN; provenance attached to every published version |

## 6. Deployment provenance

| Artifact | Path |
|---|---|
| Live Base Sepolia addresses | [`packages/contracts/deployments-base-sepolia.json`](../../packages/contracts/deployments-base-sepolia.json) — committed; downstream consumers import via `@agenticprimitives/contracts/deployments/base-sepolia` subpath |
| Deploy script | `packages/contracts/script/Deploy.s.sol` — `_resolveAuthority` enforces governance-shape constraints at deploy time |
| `.impact` TLD bootstrap | `packages/contracts/script/AddImpactTld.s.sol` |
| Cloudflare deploy state | `cloudflare-urls.json` (gitignored; regenerated by `pnpm deploy:cloudflare`) |
| Set Cloudflare secrets script | [`scripts/set-cloudflare-secrets.sh`](../../scripts/set-cloudflare-secrets.sh) — seeds RPC_URL + crypto secrets on both Workers |

## 7. R9 / R11 wave evidence

| Wave | Slice | PR | Status |
|---|---|---|---|
| R9.1 | Foundry tune + Solhint + CustodyPolicy invariants | #72 | merged |
| R9.2 | DelegationManager + SmartAgentPaymaster invariants | #82 | merged |
| R9.3 | Halmos UV + UP gates | #74 | merged |
| R9.3.x | Halmos onlySelf (5 proofs) | #75 | merged |
| R9.4 | Echidna nightly | #77 | merged |
| R9.5 | Medusa weekend | #78 | merged |
| R9.6 | H-6 cap + Slither/Aderyn triage + supply-chain allowlist | #79 | merged |
| Spec 237 | AEL doc + ADR-0022 + crosswalk | #76 | merged |
| Spec 238 | Package Design v2 doc | #80 | merged |
| R10 | Internal readiness assessment + prioritized backlog | #83 | merged |
| R11.1 + R11.3 | Fail-hard audit at wrappers + AWS/per-tool removal from public | #84 | open |
| R11.4 (this) | AUDIT.md refresh + audit-evidence-index + small CI gates | — | (this PR) |

## 8. What's NOT yet evidence (gaps the auditor should know about up front)

Items the third-party assessment / R10 doc surfaced that are TRACKED but not yet shipped. The auditor should not be surprised when these don't appear in `/audit/<subdir>/`:

- **Governance ceremony evidence** (P1.1) — deployer is currently a publicly-disclosed testnet EOA. Production runbook is documented (`packages/contracts/AUDIT.md` § 4.1) but not exercised.
- **Live-chain governance-shape verifier** (P1.2) — `scripts/verify-governance-shape.ts` is a tracked-not-shipped item.
- **Managed HMAC rotation backend** (P1.7) — shared-secret HMAC acceptable for alpha; production needs rotation policy with version IDs.
- **Envelope encryption audit events** (P1.8) — `key-custody.sign` emits; `encrypt` + `decrypt` do not.
- **`audit.FAIL_HARD_ACTIONS` enumeration** (P1.4 / NEW-2) — fail-hard contract is now enforced at the wrapper level (R11.1), but the action-name enumeration is not yet machine-checkable.
- **Kontrol + Certora formal proofs** (P2.2 / P2.3) — Halmos covers narrow proofs; deferred to post-audit.

All open items + ETA in [`docs/audits/2026-06-01-r10-internal-readiness-assessment.md`](./2026-06-01-r10-internal-readiness-assessment.md) § "Prioritized hardening backlog."
