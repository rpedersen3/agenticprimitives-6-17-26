# R10 Internal Readiness Assessment — Post-R9, Pre-External-Audit

| Field | Value |
|---|---|
| **Date** | 2026-06-01 |
| **Trigger** | Post-R9 wave (9 PRs merged + Base Sepolia redeployed); user-requested internal audit of where we stand on production readiness + prioritized hardening list. |
| **Scope** | Every `@agenticprimitives/*` package + `packages/contracts` + the deploy substrate + the audit/evidence surface. **Demo-app concerns out of scope** — those continue in [`2026-05-pre-production-readiness.md`](./2026-05-pre-production-readiness.md). |
| **Method** | Verified each claim from the user's third-party assessment against current repo state (R9 wave + the 2026-06-01 redeploy); surfaced additional findings the assessment didn't catch; categorized into P0-P3 with acceptance criteria each. |
| **Status** | Open — living tracker until external audit handoff. |

---

## Verdict (one line)

**External-audit-ready alpha.** Substrate is sound: package boundaries, contract hardening, fail-closed defaults, symbolic + invariant + fuzz coverage, supply-chain gates. The remaining production blockers are operational (governance keys, fail-hard audit, AWS / per-tool isolation, doc-dossier refresh) — NOT architectural.

A third-party Solidity audit + a clean governance ceremony are the two things that move this from "audit-ready alpha" to "production-deployable for real funds." Everything else is finite, prioritized, and tracked below.

---

## Verified state (claims from the third-party assessment, fact-checked)

| Claim | Status today | Evidence |
|---|---|---|
| Package boundary doctrine + 17 publishable packages | ✅ verified | `README.md` lists all 17; `pnpm check:package-boundaries` PR-blocking |
| 28 contracts in `packages/contracts/src/` | ⚠️ **+9 vs assessment** | `find src -name '*.sol' \| wc -l` = **37** (includes interfaces + libraries the assessment didn't count) |
| 635 Foundry tests | ⚠️ **+45 vs assessment** | `forge test --list` reports **680** tests (R9 wave added the invariant suites + R9.6 cap tests) |
| Halmos / Echidna / Medusa configs committed | ✅ verified | `packages/contracts/halmos.toml`, `echidna.yaml`, `medusa.json` all on master |
| Halmos UV proof + onlySelf proofs | ✅ verified | `test/halmos/{WebAuthnLibUvR82,AgentAccountOnlySelf}.halmos.t.sol` — 7 proofs PASS in 0.13s |
| Foundry invariant suites (Custody/Delegation/Paymaster) | ✅ verified | `test/invariant/*.invariant.t.sol` — 15 invariants × 25,600 calls each |
| AgentAccount `requireUv: true` enforced at contract layer | ✅ verified | `AgentAccount.sol:1185` confirmed; R8.2 closure |
| `tool-policy.evaluatePolicy` fail-closed on missing/unknown classification | ✅ verified | `packages/tool-policy/src/decision.ts:73-79` shape gate; closes original N8 |
| `withDelegation` production-strict type/runtime surface | ✅ verified | `packages/mcp-runtime/src/with-delegation.ts:120-192` discriminated-union + runtime guard |
| `composeFailHardSinks` primitive exists in audit package | ✅ verified | `packages/audit/src/index.ts:308-330` — throws if any sink fails |
| **`withDelegation` STILL swallows audit sink failures** | ⚠️ **CONFIRMED — gap is real** | `packages/mcp-runtime/src/with-delegation.ts:288` has `catch { /* fail-soft */ }` AROUND the audit emit. The primitive exists; the load-bearing wrapper doesn't use it. |
| AwsKmsProvider / AwsKmsSigner throw "not yet implemented" | ⚠️ **CONFIRMED** | `packages/key-custody/src/providers/aws.ts:7` exports `NOT_IMPLEMENTED = 'AwsKmsProvider / AwsKmsSigner not yet implemented in v0; use LocalAesProvider for the demo.'` |
| Per-tool executor isolation gap | ⚠️ **CONFIRMED** | `buildToolExecutorBackend(toolId)` throws (PKG-KEY-CUSTODY-001 closure); only `buildToolExecutorBackendNoIsolation` (explicit name) is available |
| `packages/contracts/AUDIT.md` says "Halmos planned, not yet present" | ⚠️ **CONFIRMED — DOC DRIFT** | Line 197: "Symbolic verification: Not yet present — R6.11 Halmos planned". R9 has Halmos / Echidna / Medusa LIVE. Auditor will waste time reconciling. |
| EIP-712 typehash TS↔Solidity cross-stack equality test | ⚠️ **GAP — NO CROSS-STACK TEST** | Solidity side has `test_DELEGATION_TYPEHASH_is_a_known_constant`; no test that imports `packages/delegation`'s TS computation and asserts equality |
| Deployer is publicly-disclosed EOA | ⚠️ **TESTNET-ACCEPTED, PRODUCTION-BLOCKER** | `deployer: 0x31ed17fb99e82E02085Ab4B3cbdaB05489098b44` in `deployments-base-sepolia.json` — explicitly accepted-risk on testnet per `[[project_demo_a2a_kms_deferred]]` memory |

**Net:** every gap the third-party assessment surfaced is real and confirmed in source. The doc drift on `packages/contracts/AUDIT.md` is the most acute one for external review (auditor reads stale claims).

---

## Additional findings I surfaced beyond the assessment

These are gaps the third-party assessment didn't catch that we should track:

### NEW-1. `getLogs` doctrine has at least one open carve-out in app code

ADR-0012 forbids `eth_getLogs` in product read paths. CI gate exists (`check:no-eth-getlogs-in-product-read-paths` — wait, actually that check name doesn't exist; the rule is doctrine + manual review). Spot-check:

```bash
grep -rnE "getLogs|eth_getLogs" packages/ apps/demo-mcp/src apps/demo-a2a/src 2>/dev/null | grep -v ".test."
```

Should run as a CI grep gate, not just doctrine. **P2.**

### NEW-2. `audit.composeFailHardSinks` has no CI enforcement of which actions MUST use it

The audit package documents (lines 256-261) that "security-critical" callers should use `composeFailHardSinks` but there's no machine-readable list of which action names are in the fail-hard class. **The list lives in prose, not in the code.** A reviewer can't statically verify a given caller used the right composer.

Possible fix: `@agenticprimitives/audit` exports a `FAIL_HARD_ACTIONS: Set<string>` enumeration; `composeSinks` warns at construction if any action in the audited event stream is in that set and the consumer used `composeSinks` instead of `composeFailHardSinks`. **P1.**

### NEW-3. No production preflight script verifies live-chain governance shape

`scripts/check-production-deploy.ts` (the N10 preflight) checks env-var preconditions. It does **not** verify the on-chain governance shape — e.g., that `AgentAccountFactory.governance() == <multisig>` and `<multisig>.code.length > 0` and `<multisig>` is a Safe (or `IGovernance` shape). The fail-closed deploy script enforces this AT DEPLOY TIME via `_resolveAuthority` (`script/Deploy.s.sol:656`), but no post-deploy verification asserts the chain still matches the local source. **P1.**

### NEW-4. `deploy:cloudflare` succeeds even when contract addresses changed but secrets reference old ones

The `set-cloudflare-secrets.sh` script now seeds `RPC_URL` for both workers (R8 fix). But it doesn't re-seed contract-address-derived values that DO change per deploy (e.g., `PAYMASTER_VERIFYING_SIGNER` if the paymaster owner key changes). For the H-6 redeploy today this didn't matter because we redeployed AS the same KMS-backed master signer. But the gap is real: a deploy with a NEW master would silently mis-match. **P2.**

### NEW-5. Echidna + Medusa nightly workflows are artifact-only — no alerting

Both workflows are `continue-on-error: true` (correct for R9.4 / R9.5 artifact-only design) and upload corpora. But there's no Slack / email / dashboard hook for "the nightly Echidna run failed a property." A failed nightly produces an artifact + a red ❌ on the workflow run but no out-of-band signal. A 24-hour silent regression window is possible. **P3.**

### NEW-6. `requireUv` is contract-enforced for first-party WebAuthn but not for third-party ERC-1271 signers

The R9.3 Halmos proof covers `WebAuthnLib.verify(..., requireUv = true)`. AgentAccount's UV gate at `_verifyWebAuthn` (line 1185) is enforced for the native passkey path. But ERC-1271 signature recovery on the AgentAccount admits ANY signer the validator accepts — there's no equivalent UV-required gate for a third-party smart-wallet signer that doesn't go through WebAuthnLib. **This is acceptable** because the third-party wallet is itself a Smart Account with its own auth substrate, but it should be documented as a **trust assumption** of the AgentAccount, not an invariant. **P2 (doc).**

### NEW-7. The third-party assessment's "AUDIT.md drift" finding extends beyond just contracts

Spot-checked the per-package `AUDIT.md` files: most are dated 2026-05-xx and reference the R6 wave or earlier. None mention the R9 Halmos / Echidna / Medusa proofs that now exercise their substrate. A reviewer reading e.g. `packages/delegation/AUDIT.md` will see no reference to the R9.2 invariant suite that LOCKS the delegation contract claims it makes. **P1 — bigger than one file.**

### NEW-8. `EnforcerPauseInvariantR67.t.sol` exists but isn't documented as a "pause-coverage invariant" anywhere

Spot-checked: `test/EnforcerPauseInvariantR67.t.sol` (200 lines) IS in master, but the per-package `AUDIT.md` for delegation doesn't reference it. Invariant exists; visibility into "what invariants cover this contract" is fragmented. The proposed `pnpm audit:evidence` collector (spec 237 §4.1) is the right fix. **P2 — fix lands in spec 237 W3.**

### NEW-9. `pnpm check:supply-chain` allowlist has one entry; needs review cadence

The Vitest CVE allowlist (`GHSA-5xrq-8626-4rwp`) has a re-evaluate-by of `2026-09-01`. There's no recurring reminder mechanism. If we forget, the allowlist becomes a permanent backdoor. **P2** — could be a calendar reminder or a CI step that fails if `Date.now() > re-evaluate-by`.

---

## Prioritized hardening backlog

### P0 — Audit-blocking (must close before external audit kicks off)

| ID | Item | Why P0 | Acceptance criteria | ETA |
|---|---|---|---|---|
| **P0.1** | **Refresh `packages/contracts/AUDIT.md`** | Auditor reads stale "Halmos planned, not yet present" claim; reconciliation wastes time + erodes trust | New dossier section listing each Halmos proof / Echidna property / Medusa property / Foundry invariant with: target invariant, command, CI status, last-green-run link, artifact location | ~2 hr |
| **P0.2** | **Refresh per-package `AUDIT.md` files** | Cross-cuts the same drift; each package claims pre-R9 coverage status | Each `AUDIT.md` adds an "R9 substrate coverage" section pointing at the relevant invariant + Halmos + Echidna + Medusa test files | ~3 hr (17 packages × ~10 min each) |
| **P0.3** | **Cross-stack EIP-712 typehash equality test (CI gate)** | Off-chain TS computes typehashes; Solidity enforces them. Drift = silent DoS or worse. The third-party assessment + the R9 wave both flagged this; no fix yet. | New script `scripts/check-eip712-typehash-equality.ts` that imports `packages/delegation`'s TS typehash + `packages/account-custody`'s + (the 3 custody typehashes from the contract) and asserts equality against the Solidity-side constants. PR-blocking in `ci.yml`. | ~2 hr |
| **P0.4** | **`mcp-runtime.withDelegation` audit-emit becomes fail-hard for security-critical actions** | The primitive exists (`composeFailHardSinks`); the load-bearing wrapper still has `catch { /* fail-soft */ }` at line 288. Production audit durability rests on this. | Either (a) replace the catch with the fail-hard semantic if the sink is a `composeFailHardSinks` instance, or (b) accept the failure as a hard reject (return auth-failed) so the call doesn't proceed without a recorded audit row | ~1 hr code + tests |
| **P0.5** | **Audit-evidence index doc** (spec 237 W3 minimum-viable) | Auditor wants a single page that points at every artifact: Halmos output, Echidna corpus, Medusa corpus, Slither SARIF, Aderyn report, Foundry coverage JSON, SBOM, deployment JSON, per-package AUDIT.md, threat-model, triage doc | New `docs/audits/audit-evidence-index.md` with a table of (artifact name, where to find it, last-updated-by-which-workflow) | ~1.5 hr |

**P0 total: ~10 hr.** Could be done in one focused day before commissioning the auditor.

### P1 — Production-blocking (must close before any real-funds deploy)

| ID | Item | Why P1 | Acceptance criteria | ETA |
|---|---|---|---|---|
| **P1.1** | **Clean production governance ceremony** | Top production blocker per every prior audit. Current deployer is a publicly-disclosed testnet EOA. | Runbook executed: KMS-managed deployer key → Safe multisig deployed → AgenticGovernance under Safe + 24h Timelock → role handoffs scripted (`script/HandoffRoles.s.sol`) → deployer EOA renounces all authority → preflight verifies on-chain shape | ~1 day (operational) |
| **P1.2** | **Live-chain governance preflight script** | Per `NEW-3`: post-deploy script that asserts on-chain state matches local source (factory.governance() == multisig, paymaster.owner() == multisig, etc.) | `scripts/verify-governance-shape.ts` runs after every deploy + nightly; fails CI if mismatch | ~3 hr |
| **P1.3** | **Per-package `AUDIT.md` references invariant test files** | Extension of P0.2 — same content, but adds the "what locks this claim" pointers to every claim row | Each Risk row in each AUDIT.md has a "Test:" pointer to invariant / Halmos / Foundry test file | folded into P0.2 |
| **P1.4** | **`audit.FAIL_HARD_ACTIONS` enumeration + CI gate** | Per `NEW-2`: machine-readable list of which event actions MUST go to a fail-hard sink composer | New `FAIL_HARD_ACTIONS` set in `@agenticprimitives/audit`; new `check:audit-fail-hard-coverage` script greps every caller emitting an action in the set + asserts the sink is a `composeFailHardSinks` instance | ~4 hr |
| **P1.5** | **Key-custody productization decision: AWS or no AWS** | The stub throws "not yet implemented" but is in the public surface. A consumer reading the public API thinks AWS is supported. | Either (a) implement `AwsKmsProvider` + `AwsKmsSigner` with parity to GCP, or (b) remove from public exports + document GCP-only for v1 | (a) ~1 week / (b) ~30 min |
| **P1.6** | **Per-tool executor isolation: implement or remove** | Same shape as P1.5 — public API has `buildToolExecutorBackend(toolId)` that throws and a `NoIsolation` variant that's explicit. The named-without-NoIsolation public function is a footgun. | Either (a) implement true per-tool HKDF isolation, or (b) keep `buildToolExecutorBackendNoIsolation` as the only public; remove the throwing alias from the public surface | (a) ~3 days / (b) ~30 min |
| **P1.7** | **Managed HMAC rotation policy + backend** | Per assessment + the existing N13 finding; shared-secret HMAC works for alpha but production needs a managed-key rotation policy with version IDs in the envelope | Rotation policy doc + `@agenticprimitives/key-custody/mac` exposes a `keyVersion` field threaded through the envelope; demo-a2a + demo-mcp both verify against current + previous version | ~2 days |
| **P1.8** | **Envelope encryption emits audit events** | Per the per-package audit + assessment: signing emits `key-custody.sign`; envelope encrypt/decrypt does NOT (open item in `packages/key-custody/AUDIT.md`) | `LocalAesProvider.encrypt / decrypt` + `GcpKmsProvider.encrypt / decrypt` emit `key-custody.encrypt` / `key-custody.decrypt` audit rows | ~3 hr |
| **P1.9** | **Acceptance criteria for fuzz/proof CI graduation** | Per assessment: which jobs are release-blocking, which nightly-advisory; what counts as a failed RC | New doc `docs/audits/release-acceptance-criteria.md` listing per-tool gate (Halmos = PR-blocking; Echidna = 7-day green nightly streak before flip-to-blocking; Medusa = 4-week corpus stability; etc.) | ~2 hr |
| **P1.10** | **External Solidity audit** | The substrate is ready; this is the actual external work | Audit firm engaged + scope agreed + report delivered + remediation retest | 4-8 weeks external |

**P1 total ex-external-audit: ~3-7 days of internal work depending on P1.5/P1.6 choices.**

### P2 — Post-audit hardening (the next wave after audit findings come back)

| ID | Item | Source |
|---|---|---|
| **P2.1** | Custom Slither doctrine detectors | R9.7 deferred; AEL W6 gates this |
| **P2.2** | Kontrol formal verification harness | R9.8 deferred; long arc |
| **P2.3** | Certora CVL specs | R9.9 deferred; long arc |
| **P2.4** | OZ Foundry Upgrades pre-upgrade gate | R9.6 deferred; lands with first real UUPS upgrade |
| **P2.5** | Vitest 2.x → 4.x migration | Supply-chain CVE re-eval 2026-09-01 |
| **P2.6** | AEL implementation W1-W7 | Spec 237 phasing |
| **P2.7** | Package design v2 W1-W9 | Spec 238 phasing — consolidations + new packages |
| **P2.8** | Smart-agent port (relationships / trust / zk) | Spec 238 W5 |
| **P2.9** | `getLogs` doctrine grep gate | NEW-1 |
| **P2.10** | Live-chain governance preflight (if not done in P1.2) | duplicates P1.2; tracked here if P1 closes without this |
| **P2.11** | Deploy:cloudflare verify contract-derived secrets | NEW-4 |
| **P2.12** | ERC-1271 third-party signer UV is a documented trust assumption | NEW-6 (doc-only) |
| **P2.13** | `pnpm audit:evidence` collector skeleton | Spec 237 §4.1 — folds in NEW-8 |
| **P2.14** | Allowlist re-eval reminder mechanism | NEW-9 |

### P3 — Post-handoff polish

| ID | Item | Source |
|---|---|---|
| **P3.1** | Echidna / Medusa nightly alerting hook | NEW-5 — Slack / email / dashboard |
| **P3.2** | Encrypted / private relationships substrate | Public README flags relationships as experimental + public-graph; production needs encrypted-edges design (out of v1 scope) |
| **P3.3** | Forge coverage branch floor lift for CustodyPolicy | CustodyPolicy branch coverage is the outlier per the assessment; lift floor incrementally |
| **P3.4** | Long-form auditor onboarding doc | "Auditor reader's guide" exists in `product-readiness-audit.md`; should be promoted to its own onboarding doc |

---

## Updated readiness table

| Area | Assessment posture | Current verified posture | Gap to production |
|---|---|---|---|
| Package decomposition | Strong | **Strong** | Spec 238 consolidations are improvement, not blocker |
| Contracts | B / B+ audit-ready | **B+ audit-ready** (R9 added Halmos + Echidna + Medusa) | External audit + governance ceremony |
| Smart-account authority closure | Much improved | **Locked** (Halmos R9.3.x proves `onlySelf` symbolically) | None code-side |
| WebAuthn / UV | Closed for AgentAccount path | **Symbolically proven** (Halmos R9.3) | NEW-6 doc note on ERC-1271 third-party signers |
| MCP policy enforcement | Mostly closed structurally | **Closed structurally** | P0.4 audit-emit fail-hard |
| Audit durability | Primitive exists; call-site semantics still need work | **Same** | P0.4 + P1.4 |
| Key custody | GCP credible; AWS/per-tool/HMAC remain | **Same** | P1.5 + P1.6 + P1.7 + P1.8 |
| CI / release posture | Strong for alpha | **Strong for alpha** | P1.9 acceptance criteria |
| Audit-dossier freshness | (not surfaced) | **STALE — drift exists** | P0.1 + P0.2 (the urgent ones) |
| **Overall** | **Production-pattern-correct alpha; not production-deployable** | **External-audit-ready alpha** | **P0 (1 day) → external audit → P1 (~1 week) → production-deployable** |

---

## Recommended sequence

**This week:**
1. **P0.1-P0.5** (one focused day, ~10 hr) — close the audit-blocking items
2. **Commission the external auditor** with the refreshed dossier (P1.10 starts external)

**Next 1-2 weeks (in parallel with external audit):**
3. **P1.1-P1.4** — governance ceremony + audit-fail-hard enumeration
4. **P1.5-P1.8** — key-custody finalization (AWS yes/no, per-tool isolation yes/no, managed HMAC, envelope audit events)
5. **P1.9** — release-acceptance-criteria doc

**4-8 weeks (external audit window):**
6. Auditor delivers findings
7. Remediation wave (R11) addresses each finding
8. Retest with the auditor

**After retest:**
9. **P2 wave** — the post-audit hardening backlog
10. **Production deploy** to mainnet with the cleaned governance

---

## One-line verdict

> Substrate is ready. Documentation has drifted. Close P0 in a day, commission the audit, work P1 in parallel. Production-deployable in ~6-10 weeks from today.

---

## Related docs

- [`docs/architecture/product-readiness-audit.md`](../architecture/product-readiness-audit.md) — system-level living tracker (refresh required to reference this R10 doc)
- [`docs/audits/2026-05-packages-contracts-production-readiness.md`](./2026-05-packages-contracts-production-readiness.md) — predecessor of this doc
- [`docs/audits/r9-static-analysis-triage.md`](./r9-static-analysis-triage.md) — R9 Slither/Aderyn triage
- [`specs/237-audit-evidence-layer.md`](../../specs/237-audit-evidence-layer.md) — the AEL spec that productionalizes P2.13 and beyond
- [`specs/238-package-design-v2-ai-composability.md`](../../specs/238-package-design-v2-ai-composability.md) — the v2 topology spec
