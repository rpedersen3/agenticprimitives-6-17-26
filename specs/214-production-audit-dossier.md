# Spec 214 — Production Audit Dossier

**Status:** living spec — the master plan for getting the repo to
third-party-audit-ready. Each hardening wave (Wave H1, H2, … H_n)
updates the closure status of items in this spec.
**Owners:** [security-auditor](../docs/agents/security-auditor.md),
[technical-architect-auditor](../docs/agents/technical-architect-auditor.md).
**Reference audits:** the rolling
[`docs/architecture/product-readiness-audit.md`](../docs/architecture/product-readiness-audit.md)
is the running scorecard; this spec is the **target shape** we're
auditing toward.

---

## 1. Purpose

Make it possible for a third-party security + technical-architecture
firm to evaluate the repo in **one sitting** with **complete evidence
trail**. No verbal context required.

The dossier has three parts:
1. **Threat model** — `docs/audits/threat-model.md`. STRIDE per trust
   boundary, mapped to packages.
2. **Architecture diagram** — `docs/audits/architecture-diagram.md`.
   System diagram, capability flow, deployment topology.
3. **Evidence checklist** — `docs/audits/evidence-checklist.md`. Each
   security control mapped to: spec section + source file + test +
   audit row.

External reviewer should be able to run `pnpm check:all && pnpm -r
test && cd apps/contracts && forge test`, read the dossier, and
issue findings.

---

## 2. What "audit-ready" means concretely

Six closure gates. Each gate is owned by either security-auditor or
technical-architect-auditor.

### Gate 1 — Threat model exists and is current
- STRIDE-per-boundary documented in `docs/audits/threat-model.md`.
- Every package has at least one row in the model.
- Every CHANGE since the model was last refreshed has either:
  (a) updated the relevant rows, or
  (b) added a finding to `docs/architecture/product-readiness-audit.md`
  that says "threat model stale wrt <change>; refresh due."

### Gate 2 — Architecture diagram is reproducible
- `docs/audits/architecture-diagram.md` includes:
  - System map (mermaid).
  - Dependency graph (mermaid; matches `specs/100`).
  - Deployment topology (Cloudflare / GCP-KMS / Base Sepolia).
  - Trust boundaries explicitly labeled.
- The diagram is generated FROM `capability.manifest.json` data (so
  it can't drift silently). The generator script lives in
  `scripts/gen-architecture-diagram.ts` (TODO until Gate 2 closes).

### Gate 3 — Evidence checklist is exhaustive
- Every security control in this spec's § 4 has a row in the evidence
  checklist with:
  - Source file + line range.
  - Test file + test name (failing test is a closed control).
  - Audit row schema (what event fires when the control fires).
- "No evidence yet" rows are explicitly OPEN findings against the
  responsible package.

### Gate 4 — All P0 findings closed
- The cross-cutting audit lists ZERO P0 findings open.
- Every closed P0 has: commit hash + test file + audit row + verification
  step that runs in CI.

### Gate 5 — Operator runbooks exist
- `docs/operations/<topic>.md` for each runbook:
  - Key compromise (deployer EOA, GCP-KMS, JWT signing key).
  - Paymaster drain.
  - RPC outage (primary + failover).
  - D1 / Durable Object outage.
  - Audit sink outage (fail-soft for telemetry; fail-closed for
    signing/minting).
  - Stale localStorage / stranded-state recovery.
  - Contract redeploy + state-stranding migration plan.
- Each runbook ≤ 200 words. Real, not aspirational.

### Gate 6 — Third-party contract audit complete
- A reputable firm (Trail of Bits, OpenZeppelin, Spearbit, etc.) has
  reviewed the contracts at a fixed commit hash.
- Their findings are imported into the cross-cutting audit as
  `EXT-1`, `EXT-2`, … and tracked through closure with the same
  severity model.

---

## 3. Severity model + finding lifecycle

| Severity | Meaning | Launch impact |
| --- | --- | --- |
| P0 / Critical | Compromises authority, funds, keys, or auditability. | Blocks any external deployment. |
| P1 / High | Must fix before external pilot or beta. | Blocks customer exposure. |
| P2 / Medium | Hardening before scale. | Risk sign-off required. |
| P3 / Low | Polish / accepted demo risk. | Track only. |

**Finding lifecycle:**
1. **Open** — finding added to the appropriate audit doc with severity,
   evidence, blast radius, recommended fix.
2. **In-flight** — a hardening wave (Wave 2A, R1, H3, etc.) is actively
   patching. The audit row links to the in-flight task.
3. **Verified-closed** — patch landed AND a regression test exists AND
   the closing commit is referenced in the row. Status becomes
   `closed-YYYY-MM-DD — <commit> / <test>`.
4. **Reopened** — a future commit broke the closing test. Status flips
   to open with the breaking commit referenced. Auditor agents
   re-verify on every wave.

---

## 4. Security controls (the dossier's centerpiece)

These are the controls the third-party reviewer will look for. Each
gets a row in `docs/audits/evidence-checklist.md`.

### 4.1 Authority closure
- **AC-1** — Self-only `setDelegationManager`, `installModule`,
  `uninstallModule`, `upgradeToWithAuthorization` on AgentAccount.
- **AC-2** — Factory-init one-shot exception for `installModule` is
  truly one-shot.
- **AC-3** — `LegacyUpgradePathDisabled` cannot be re-enabled.
- **AC-4** — CustodyPolicy reinstall forbidden post-uninstall.

### 4.2 Signature binding
- **SB-1** — QuorumEnforcer hashes bind chain id + enforcer address +
  delegation hash + delegator + redeemer + target + value +
  keccak(callData).
- **SB-2** — ECDSA `s` value low-half-normalized for all paths.
- **SB-3** — WebAuthn assertion decodes via try/catch (malformed →
  false, not revert).
- **SB-4** — ERC-1271 + ERC-6492 dispatched through one
  `UniversalSignatureValidator` entry; no per-app variant.

### 4.3 Custody / recovery
- **CR-1** — Zero credentialIdDigest rejected at `initialize` AND
  `addPasskey` AND `addPasskey` inside RecoverAccount.
- **CR-2** — `SetRecoveryApprovals(0)` rejected at apply.
- **CR-3** — `RotateAllCustodians` actually removes the old set
  (Wave 2C C-10 wire-format).
- **CR-4** — `ChangeApprovalsRequired` to a tier-N value requires
  effective tier ≥ max(targetTier, T4); reductions escalate to T5.
- **CR-5** — T6 recovery timelock is bounded by `timelockOverrides[6]`
  with a hard 48h default; short values only allowed when explicitly
  set (demo deploys ship `[..., 10]` for 10s).

### 4.4 Off-chain authorization
- **OA-1** — `evaluatePolicy` fail-closed shape gate: unknown @sa-tool /
  @sa-auth / risk-tier → deny. Negative test matrix exists.
- **OA-2** — `withDelegation` production-default: throws at construction
  in production if classification or auditSink missing. Wave H1.
- **OA-3** — `verifyDelegationToken` refuses caveat-presence as quorum
  proof; requires explicit `quorumProof` when `requireQuorumCaveat`
  set. Wave H3.
- **OA-4** — JTI replay store atomic; never decrement; per-token usage
  cap enforced.
- **OA-5** — Error responses opaque: caller cannot distinguish
  malformed vs expired vs revoked vs caveat-failed.

### 4.5 KMS / key handling
- **KH-1** — `buildKeyProvider` / `buildSignerBackend` production-
  default: no silent local-aes fallback. Wave H1.
- **KH-2** — `LocalAesProvider` throws on `NODE_ENV=production` unless
  explicit opt-in env is set (and opt-in is logged + audited).
- **KH-3** — GCP-KMS envelope encryption binds AAD identically in
  `Encrypt` AAD and `EncryptionContext` (tampering trips both).
- **KH-4** — Signing audit row never logs raw session id (hashed +
  truncated only).
- **KH-5** — HMAC / MAC key rotation has a documented procedure +
  overlap window for in-flight requests.

### 4.6 Input validation + transport
- **IV-1** — Every Worker route uses `validate.ts` helpers for browser
  input (no raw `BigInt(...)`, no `as Address` casts).
- **IV-2** — CORS exact-origin allowlist for credentialed routes.
  Wildcards forbidden when `credentials: true`.
- **IV-3** — CSRF token HMAC-bound to origin + timestamp; constant-time
  compare on verify.
- **IV-4** — Service-MAC envelope between workers verified BEFORE
  route handler runs; per-audience secret.

### 4.7 Build / supply chain / CI
- **SC-1** — `pnpm install --frozen-lockfile --strict-peer-dependencies`
  runs on release CI. Wave H4.
- **SC-2** — Doctrine checks: capability manifests, boundaries,
  exports, vocabulary firewall, forbidden terms.
- **SC-3** — `pnpm audit --prod` runs on CI; SBOM generated and
  archived per release.
- **SC-4** — Dependabot configured for monorepo packages.
- **SC-5** — Secret scanning (gitleaks) on every PR.
- **SC-6** — CodeQL for TypeScript + Solidity.

### 4.8 Operational / observability
- **OP-1** — Production preflight (`scripts/check-production-deploy.ts`)
  fail-fast on: leaked deployer key, local KMS in prod, paymaster
  dev-mode, missing audit sink.
- **OP-2** — Durable audit sink in production (D1 / Cloud Logging /
  append-only). Signing + mint + recovery events MUST persist.
- **OP-3** — Paymaster monitoring: `/paymaster/status` endpoint +
  alert on deposit threshold.
- **OP-4** — Live canary smoke test after every deploy.
- **OP-5** — Runbooks exist for the topics in Gate 5.

### 4.9 Demo / stranded state
- **DS-1** — Every contract redeploy strands user state cleanly
  (acknowledged + documented); each demo has a Reset workflow
  visible from the topbar.
- **DS-2** — `Act5DelegateTreasury.alreadyIssued` counts only fresh
  delegations matching current account addresses (not raw localStorage
  length). Wave R recovery hardening.

---

## 5. Out-of-scope (intentionally not in the dossier yet)

These are flagged so a reviewer doesn't assume the absence is an
oversight:

- **Off-chain quorum signature verification** — the wire format is
  reserved in `delegation` (Wave H3); the implementation lands in a
  future wave once the bound payload format is spec'd. Tools that need
  it currently fail closed with `quorum_off_chain_not_implemented`.
- **Multi-chain deploys** — single-chain (Base Sepolia testnet) only.
- **L1 mainnet** — not yet a target. The factory + entry point + bundler
  signer would all need rotation + multi-region deploy first.
- **Per-tool KMS isolation (HKDF-derived per-tool keys)** — `buildToolExecutorBackend`
  returns the master signer in v0. v1 will derive per-tool keys.

---

## 6. Continuous-update protocol

Every hardening wave updates this spec in lockstep:

1. Find the relevant control(s) in § 4.
2. Flip status in `docs/audits/evidence-checklist.md` (the source of
   truth for closures).
3. Update `docs/architecture/product-readiness-audit.md` (the running
   scorecard).
4. If the wave introduces a NEW control (e.g., a new package or a new
   trust boundary), add a row to § 4 + the evidence checklist + the
   threat model.

The pre-launch dossier is "done" when § 2's Gates 1-6 all read
closed-YYYY-MM-DD.

---

## 7. Reference

- `docs/agents/security-auditor.md`
- `docs/agents/technical-architect-auditor.md`
- `docs/audits/threat-model.md`
- `docs/audits/architecture-diagram.md`
- `docs/audits/evidence-checklist.md`
- `docs/audits/index.md` — index of per-package audits
- `docs/architecture/product-readiness-audit.md` — running scorecard
- `docs/architecture/cross-cutting-capabilities.md`
- `docs/architecture/vocabulary-map.md`
- `specs/100-package-boundary-doctrine.md`
- External reference: `/home/barb/smart-agent` branch
  `003-intent-marketplace-proposal`
