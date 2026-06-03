# Product Readiness Architecture Audit

**Status:** living document — refreshed at the end of each hardening pass
**Last refreshed:** 2026-06-01 (R9 wave complete — 9 PRs landed: Foundry tune + Solhint + invariant suites for CustodyPolicy/DelegationManager/SmartAgentPaymaster; Halmos symbolic proofs of WebAuthn UV/UP + AgentAccount onlySelf closure; Echidna nightly + Medusa weekend stateful fuzzing; H-6 custodians cap closed + Slither/Aderyn triage; supply-chain CVE allowlist; spec 237 AEL + spec 238 v2 topology docs)
**Prior refresh:** 2026-06-01 (R6 contracts hardening wave — 10 PRs; CustodyPolicy coverage 50.9%→98.2%; Slither + Aderyn dual SAST)
**Prior refresh:** 2026-05-23 (Wave H1-H4 — production-default packages, custody hardening, peer-strict release CI)
**Original draft:** 2026-05-19
**Scope:** all `@agenticprimitives/*` packages (including `audit`, `custody`), demo apps (web, web-pro, web-recovery, a2a, mcp), contracts, deploy path, CI, architecture docs, live testnet deployment
**Verdict:** **external-audit-ready alpha.** Testnet-deployed end-to-end with **680 Foundry tests + 7 Halmos symbolic proofs + 4 Echidna properties + 4 Medusa properties** across 37 .sol files. Substrate is sound: package boundaries, contract hardening, fail-closed defaults, symbolic + invariant + fuzz coverage, supply-chain gates. Remaining production blockers concentrate in OPERATIONAL readiness (clean production governance keys, third-party contracts audit, fail-hard audit at the mcp-runtime call site, AWS / per-tool isolation finalization, doc-dossier refresh to reference R9) — NOT in architecture or implementation gaps.

**Active prioritized hardening backlog:** see [**R10 internal readiness assessment**](../audits/2026-06-01-r10-internal-readiness-assessment.md) — categorizes every remaining item into P0 (audit-blocking, ~1 day) / P1 (production-blocking, ~1 week) / P2 (post-audit) / P3 (polish). All P0 items are doc-refreshes + 2 small code fixes; the substrate work is done.

## Audit Reader's Guide (added 2026-06-01)

External reviewers occasionally read this doc top-to-bottom and conflate items that were CLOSED in a hardening wave with items still open. Quick disambiguation:

- **N1 — leaked deployer key (P0):** OPEN. Intentional for the public-reproducible testnet demo; production rotation runbook in `packages/contracts/AUDIT.md`.
- **N8 — `tool-policy.evaluatePolicy` fail-open (P0):** **CLOSED 2026-05-23.** Shape-gate fail-closed at `packages/tool-policy/src/decision.ts:73-79`; closed-enum validation in `validateClassificationShape` (lines 47-67); Wave H1 inverted `withDelegation` to production-strict default. Negative-test matrix at `packages/tool-policy/test/decision.test.ts`. If an external reviewer cites N8 as open, they are reading a pre-2026-05-23 snapshot.
- **N9 — `/session/package` persists on failed ERC-1271 (P1):** **CLOSED 2026-05-23.** Returns HTTP 400 `erc1271_failed` before persistence.
- **N11 — A2A BigInt parsing (P1):** **CLOSED 2026-05-23.** Shared `apps/demo-a2a/src/validate.ts` module covers every deploy route.
- **N12 — credentialed CORS reflection (P1):** **CLOSED 2026-05-23.** Exact-allowlist via `ALLOWED_ORIGINS` env; non-HTTPS rejected outside localhost.
- **N10 — preflight not yet strict enough (P1):** GENUINELY OPEN. Operational readiness work, not a code gap.
- **N13 — managed HMAC key rotation (P2):** GENUINELY OPEN.
- **N14 — passkey UV preferred vs required (P2):** GENUINELY OPEN (policy decision pending).
- **N15 — contracts audit dossier (P2):** PARTIALLY CLOSED 2026-05-23 (auditor packet at `docs/audits/{threat-model,architecture-diagram,evidence-checklist}.md`); `packages/contracts/AUDIT.md` + third-party engagement still open.

This document is intentionally direct. It treats the repo as if it were preparing for a third-party security and technical architecture review.

## Audit layout

This system-level audit pairs with per-package `AUDIT.md` files. Per the
doctrine "each package is a product boundary", an external reviewer
should be able to evaluate ONE package by reading just that package's
source + its `AUDIT.md`, cross-referencing this system audit for
cross-cutting concerns.

- **Index of all audits:** [`docs/audits/index.md`](../audits/index.md)
- **Per-package audits:**
  [types](../../packages/types/AUDIT.md) ·
  [connect-auth](../../packages/connect-auth/AUDIT.md) ·
  [agent-account](../../packages/agent-account/AUDIT.md) ·
  [delegation](../../packages/delegation/AUDIT.md) ·
  [key-custody](../../packages/key-custody/AUDIT.md) ·
  [tool-policy](../../packages/tool-policy/AUDIT.md) ·
  [mcp-runtime](../../packages/mcp-runtime/AUDIT.md) ·
  [audit](../../packages/audit/AUDIT.md) ·
  [custody](../../packages/account-custody/AUDIT.md)
- **Template for new package audits:** [`docs/audits/_template.md`](../audits/_template.md)
- **Findings ID convention:** system-level findings use letter+number (C1, H3, N2); package-local findings use `<PKG>-N` (e.g. `DEL-1`, `KC-1`).

---

## What's Closed Since 2026-05-20 (Waves 2A–2C, R0–R3, H1–H4)

External audit pass on 2026-05-23 noted material improvement and reclassified several previously-open findings. The list below reconciles the audit's "what improved" section with the in-repo state at this commit.

### Wave 2 — contract authority + custody hardening
| ID | Change | Impact on audit |
| --- | --- | --- |
| **C-1/C-2/C-3** | `AgentAccount.setDelegationManager`, `installModule`/`uninstallModule`, `upgradeToWithAuthorization` are all `onlySelf` (factory-init exception for first install). 12 Forge regression tests in `AuthorityClosureWave2A.t.sol`. | Closes the three single-custodian on-chain escape paths the prior audit had flagged as the highest-severity contract findings. |
| **C-4** | `QuorumEnforcer` binds signatures to the canonical execution payload hash (delegationHash + delegator + redeemer + target + value + keccak(callData) + chainId + enforcer). 6 regression tests in `QuorumEnforcerBindingWave2B.t.sol`. | Closes the cross-call replay path the prior audit flagged. |
| **C-6–C-11** | CustodyPolicy hardening — zero credentialIdDigest rejected, malformed WebAuthn returns false (no revert), ChangeApprovalsRequired tier escalation, SetRecoveryApprovals(0) rejected, RotateAllCustodians actually removes, CustodyPolicy reinstall forbidden post-uninstall. 8 regression tests in `CustodyPolicyWave2C.t.sol`. | Closes the audit's CustodyPolicy P1 cluster. |

### Wave R0–R3 — factory unification + recovery demo
| ID | Change | Impact on audit |
| --- | --- | --- |
| **R0** | Single `createAgentAccount(params, timelockOverrides, salt)` entry replaces `createPersonAgent` + `createMultiSigSmartAgent`. CustodyPolicy address factory-immutable. `mode>0 ⇒ trustees>0` invariant. 208 Forge tests passing on the unified surface. | Architectural cleanup — every Person/Org/Treasury now goes through one path with the same validation. |
| **R1** | `custody-ceremony.ts` natively multi-signer; `signers: CeremonySigner[]` replaces the single-signer arg shape. 1-of-1 is the trivial case. | Required substrate for the recovery demo + future N-of-M flows. |
| **R2-R3** | `apps/demo-web-recovery` shipped end-to-end on Base Sepolia. 6-act ladder: enroll Alice + Bob, onboard Sam recovery-capable, declare loss, register replacement passkey, 2-of-2 trustee T6 RecoverAccount, on-chain verify. | Integration evidence that the custody + agent-account + key-custody + connect-auth packages compose correctly for a real recovery flow. |

### Wave H1–H4 — production-default packages + audit reconciliation
| ID | Change | Impact on audit |
| --- | --- | --- |
| **H1 (mcp-runtime)** | `withDelegation` is now **production by default**. `inferEnvironment()` resolves to 'production' unless `environment: 'development'` or `developmentMode: true` is set OR `process.env.NODE_ENV !== 'production'`. Production mode throws at wrapper construction if `classification` or `auditSink` is missing. 7 new tests cover the inverted default + escape paths. | **Closes the audit's P0 finding "production-safe behavior is opt-in"** for mcp-runtime. The package API is now structurally impossible to misuse — a forgotten env option produces production gates, not silent permissive defaults. |
| **H1 (key-custody)** | `buildKeyProvider` / `buildSignerBackend` use the same `inferEnvironment()` shape. In production with no explicit `opts.backend` AND no `A2A_KMS_BACKEND` env, `backendOrEnv()` **throws** instead of falling back to `local-aes`. The existing `LocalAesProvider` NODE_ENV=production guard stays as a second line of defense. | **Closes the audit's P1 finding "key-custody default is too permissive."** Production consumers cannot silently get a dev signer; they must opt in. |
| **H2 (custody)** | Every action builder in `@agenticprimitives/account-custody/src/actions.ts` validates inputs at the wire-format boundary: `uint8`/`uint256` range, address/`bytes32` shape, semantic guards (e.g. C-6 zero-digest rejection). New `buildRecoverAccountArgs` + `buildRotateAllCustodiansArgs`. **60 custody tests passing** (was 28). The recovery demo now imports `buildRecoverAccountArgs` instead of inlining ABI encoding. | **Closes the audit's P1 finding "custody package lacks enough test evidence."** Wire-format mistakes now surface as `RangeError` at call time instead of opaque on-chain reverts. |
| **H4** | Release-CI job runs `pnpm install --frozen-lockfile --strict-peer-dependencies`. Local `.npmrc` stays permissive for dev ergonomics; release builds re-resolve strictly. | **Closes the audit's P1 finding "peer strictness still unresolved."** |

---

## What's Closed Since 2026-05-19

| ID | Change | Impact on audit |
| --- | --- | --- |
| (H4 partial) | **Passkey arc complete** — `connect-auth/passkey` is fully implemented; on-chain `_verifyWebAuthn` proven end-to-end via Playwright virtual authenticator + live Base Sepolia smoke test. Google auth remains a stub. | H4 reduced from P1 to P2 — only Google remains a stub. |
| (new) | **`UniversalSignatureValidator` deployed live** at `0x9c7Db1070BeC933f6456D0F65DEDa9Ae74bbbC96` (Base Sepolia). Verifies ECDSA + ERC-1271 + ERC-6492 in one entry point. demo-a2a's `/auth/siwe-verify` no longer does ECDSA recovery — dispatch happens on-chain. | Architectural improvement: demo-a2a is now signer-agnostic. Closes a long-standing coupling between server-side verification and signer method. |
| (new) | **Counterfactual signature support** — passkey-owned accounts sign SIWE / delegations via ERC-6492 envelope; validator deploys the account in `eth_call` simulation before ERC-1271 verification. No "is account deployed?" checks in app code. | Removes a UX cliff and a class of "deploy before verify" race conditions. |
| (RPC URL in `[vars]`) | **`RPC_URL` moved from public `[env.production.vars]` to wrangler secret** on both demo-a2a and demo-mcp. API-keyed URLs (Alchemy / Infura / etc.) no longer in tracked config. | One leak vector closed; documented in `apps/demo-a2a/wrangler.toml` so future deployers know the pattern. |
| (new) | **PasskeySigner adapter (Phase 4b)** — viem-shaped signer that produces `0x01`-prefixed WebAuthn blobs. demo-web's `deploy-flow.ts` + `authorize-flow.ts` accept either an EOA viem account or a PasskeySigner — no branch elsewhere. | Demonstrates the signer-agnostic doctrine at the consumer layer; closes the passkey arc. |
| (new) | **`/account/derive-address` server-side view-call relay** — browser no longer needs an RPC URL; demo-a2a does the factory view call. Keeps RPC API keys server-side. | Necessary corollary to moving `RPC_URL` to a secret. |
| (new) | **15-spec Playwright e2e suite** including the full passkey flow (Step 0 → 1 → 1.5 → 2 → 3) using Chrome DevTools Protocol virtual authenticator. | Closes some of M4 (test pyramid). Full strategy from `specs/110-test-strategy.md` still incomplete; layers 5 (Anvil system tests beyond E2E), 6 (deployed smoke), and 7 (type locks + property tests) still missing. |
| (C1 follow-up) | **Local MAC production posture clarified** — `LocalAesProvider` now refuses production only for session-data-key envelope encryption/decryption. `generateMac()` remains available in production as HMAC-SHA256 over a wrangler-secret-loaded value. `LocalSecp256k1Signer` still refuses production. | Corrects an overbroad guard: service MAC can be production-valid with a shared secret, while session key wrapping still requires managed KMS. Remaining hardening: managed HMAC key support/rotation policy (N13). |
| (C2/N3) | **Paymaster lockdown + monitoring landed** — `SmartAgentPaymaster` now supports verifying-paymaster mode; demo-a2a signs paymaster envelopes through the master KMS account; `/paymaster/status` exposes deposit health for monitors. | Closes C2 and N3 for the demo architecture. Remaining production work is operational: alert wiring, runbooks, and clean governance. |
| (M7) | **Supply-chain CI landed** — CodeQL, `pnpm audit`, gitleaks, SBOM generation, Dependabot, local `pnpm check:supply-chain`, and runbook docs are in place. | Closes M7 as an audit finding. |
| (deploy hygiene) | **Shell scripts are executable and stray Windows metadata removed** — `packages/contracts/setup.sh`, `scripts/dev.sh`, and `scripts/set-cloudflare-secrets.sh` now have executable mode; `fresh-sa.json:Zone.Identifier` was removed. | No finding closed, but reduces setup/deploy friction and metadata noise. |

---

## New Findings (raised by today's review)

| ID | Severity | Finding | Evidence | Why now |
| --- | --- | --- | --- | --- |
| **N1** | **P0** | **Leaked deployer key controls live demo governance.** The deployer EOA `0x31ed17fb99e82E02085Ab4B3cbdaB05489098b44` has been disclosed multiple times in chat transcripts (and in earlier prior commits) — yet it is currently authorized as `governance`, `bundlerSigner`, and `sessionIssuer` on the live `AgentAccountFactory` (`0x81F3FF...`), and as `owner` + `governance` on the live `SmartAgentPaymaster` (`0xf181cB7...`). Anyone with the leaked private key can: rotate factory roles to a hostile address (no timelock in our factory), withdraw stake from the paymaster after the configured 1-day unstake delay, pause the paymaster, and submit malicious bundler txs from the live bundlerSigner role. | `cloudflare-urls.json` deployer field; chat history; `AgentAccountFactory.setBundlerSigner` is `onlyGovernance`, no timelock in our contract. | Accepted for internal demo only. Production requires rotating roles to a clean key OR redeploying contracts with a clean deployer. |
| **N2** | **P1** | **`/account/derive-address` had no input validation or rate limit.** | `apps/demo-a2a/src/index.ts` `/account/derive-address` handler. | **CLOSED 2026-05-20.** Validation + simple per-IP rate limit landed. Broader A2A numeric parsing remains open as N11. |
| **N3** | **P1** | **Paymaster had no balance monitoring or auto-refill.** Production hit `AA31 paymaster deposit too low` in real users' faces — caught only by manual `cast send EntryPoint.depositTo(paymaster, ...)`. | Live incident on 2026-05-20; `/paymaster/status` now exposes deposit and threshold status. | **CLOSED 2026-05-20.** Remaining work moved under M8: alert routing + refill runbook. |
| **N4** | **P2** | **Verification gas ceiling is wasteful on RIP-7212 chains.** Default `verificationGasLimit = 1_200_000n` for passkey deploys covers anvil's pure-Solidity P-256 fallback (~350k) but is ~4× the actual gas used on Base Sepolia (with RIP-7212 precompile). EntryPoint pre-funds against the ceiling, so paymaster deposit drains 4× faster than necessary. | `packages/agent-account/src/client.ts:374` (`buildDeployUserOpWithPasskey`). | Cost amplifier even with monitoring. Easy fix: per-chain config. |
| **N5** | **P2** | **No live canary / deployed smoke test.** Live deploy state is only verified by the user manually trying the demo. Silent failures (RPC quota burned, paymaster drained, GCP KMS quota exhausted, certificate expiry) only surface when a real user hits them. | Absence of post-deploy hook in `scripts/deploy-cloudflare.ts`. | Intersects M4 (test pyramid). Should run after every deploy + on a schedule. |
| **N6** | **P2** | **Old orphaned contracts on Base Sepolia.** Previous deploy at `0x4879fCAe.../0x06fc483b65...` (factory / paymaster) is unused but still exists. The old paymaster has stake. Same `0x31ed` deployer controls both old and new — see N1. | `cloudflare-urls.json` (current) vs prior commit messages noting old addresses. | Funds recoverable via `withdrawStake` after the unstake delay. |
| **N7** | **P3** | **No documented account recovery for passkey-only smart accounts.** If a user loses their only registered passkey, the account is bricked. The contract supports `addPasskey` / `removePasskey` (both `onlySelf`) and a single passkey-only account can be promoted to multi-sig via `addOwner`, but no UI flow exists. | `packages/contracts/src/AgentAccount.sol` `_passkeyStorage`; absence of recovery in `apps/demo-web`. | Will surface on first real-user passkey loss. |
| **N8** | **P0** | **`tool-policy.evaluatePolicy()` still fails open for unknown or incomplete classification metadata.** `withDelegation()` now calls the policy engine when a classification is provided, but the pure policy engine returns `allow` for empty objects, unknown tags, missing risk tier, or missing auth/tool tags. | `packages/tool-policy/src/decision.ts`; `packages/mcp-runtime/src/with-delegation.ts` makes classification optional for back-compat. | **CLOSED 2026-05-23.** `evaluatePolicy()` now validates classification shape and denies missing/unknown `@sa-tool`, `@sa-auth`, risk tier. Negative-test matrix in `packages/tool-policy/test/decision.test.ts`. **Wave H1 additionally inverts `withDelegation`'s default to production-strict** — unclassified tools throw at construction time in production. |
| **N9** | **P1** | **`/session/package` stores delegations even when ERC-1271 verification fails.** | `apps/demo-a2a/src/index.ts` `/session/package`. | **CLOSED 2026-05-23.** `/session/package` rejects with HTTP 400 + `erc1271_failed` before persistence when `isValidSignature` returns false. |
| **N10** | **P1** | **Production preflight exists but is not yet strict enough.** The script checks several shapes, but does not fully prove production secrets are present, `A2A_KMS_BACKEND=gcp-kms` is enforced at runtime, the paymaster is non-dev/locked down, every production tool has classification + audit sink, or the skip flag is policy-controlled. | `scripts/check-production-deploy.ts`. | C4 moved from "missing" to "partial"; it is still a launch gate, not a completed control. |
| **N11** | **P1** | **A2A BigInt parsing remains unsafe outside `/account/derive-address`.** | `apps/demo-a2a/src/index.ts` deploy routes. | **CLOSED 2026-05-23.** Shared `validate.ts` module: `parseAddress`, `parseBytes32`, `parseHex`, `parseUint256Decimal`, `parseUint48`, `parseAddressArray` + standard `badInputResponse` shape. `/session/direct-deploy` (unified post-R0) uses these for every field. |
| **N12** | **P1** | **Credentialed CORS still reflects the request origin.** | `apps/demo-a2a/src/index.ts` CORS middleware. | **CLOSED 2026-05-23.** Exact-allowlist CORS via `ALLOWED_ORIGINS` env. Demo-web, demo-web-pro, demo-web-recovery pages.dev origins are explicitly listed; non-HTTPS origins blocked outside localhost. |
| **N13** | **P2** | **Managed production MAC key support is not yet implemented.** Shared-secret HMAC is acceptable for production service auth, but there is no GCP KMS HMAC backend, key rotation story, or key-id verification policy yet. | `key-custody` local MAC implementation; demo apps use `A2A_MAC_SECRET`. | Not a blocker for internal demo, but needed before scale and multi-service key rotation. |
| **N14** | **P2** | **Passkey ceremonies use user verification as preferred rather than required.** | `connect-auth` passkey flow and demo-web passkey signer path. | Decide whether production requires UV or document the accepted risk. |
| **N15** | **P2** | **Contracts lack a dedicated audit dossier.** | `packages/contracts` has tests and architecture docs, but no `AUDIT.md` covering invariants, upgrade/governance assumptions, paymaster economics, and `UniversalSignatureValidator`. | Needed before third-party review. **PARTIAL CLOSURE 2026-05-23** — auditor packet shipped: `docs/audits/{threat-model,architecture-diagram,evidence-checklist}.md` + `specs/214-production-audit-dossier.md`. Contracts-specific `packages/contracts/AUDIT.md` and third-party engagement still open. |
| **CT-8** | **P1** | **demo-a2a is the primary signing / delegation-mint / direct-deploy / custody-relay service yet emits exclusively to console — no D1 (or any durable) sink wired.** Detective control missing, not preventive: signatures are still EIP-712-bound, MAC envelopes still verified MCP-side, JTI replay still enforced MCP-side. But the dossier promise "every signing/minting op is auditable" is unmet on the service that does the most signing. Six call-sites have **zero audit emission anywhere** (not even console): `/session/direct-deploy` (deployer EOA factory call), `/session/custody-schedule`, `/session/custody-apply`, `/admin/topup-paymaster`, `mintSession` SIWE JWT issuance, `/session/package` ERC-1271 reject path. | `apps/demo-a2a/src/index.ts:75-77` (`buildAuditSink` is console-only — `_env` underscore is the smoking gun); `apps/demo-a2a/wrangler.toml` (no `d1_databases` entry); zero-emission rows at `apps/demo-a2a/src/index.ts:760-768, 1230-1236, 1320-1327, 1358-1364, 1843-1849, 1936-1947`. Boundary B + Boundary E Repudiation rows in `docs/audits/threat-model.md:85, :148` unmet on the a2a side. | Surfaced by 2026-05-23 security-auditor agent run. Replaces and refines the older "demo-a2a uses console-only audit" wording in CT-2 (which becomes a duplicate). Drives the H5 task list. |
| **CT-9** | **P2** | **`generateServiceMac` accepts no audit sink — MAC issuance is structurally invisible from the issuing side.** Only the verify side emits `mcp-runtime.service-mac.{accept,reject}` at `packages/mcp-runtime/src/service-mac.ts:188, :262`. Issuance from demo-a2a at `:1614, :2027` produces no audit row. Add an optional `auditSink` to `generateServiceMac` so the trail is symmetric. | `packages/mcp-runtime/src/service-mac.ts` (no `auditSink` param on `generateServiceMac`). | Surfaced 2026-05-23. Package-level fix; should land alongside CT-8. |
| **CT-10** | **P2** | **Production preflight does not assert audit-sink wiring or D1 binding presence.** Once CT-8 is fixed, a future regression that drops the `d1_databases` binding in `apps/demo-a2a/wrangler.toml` would silently revert to console-only without firing any preflight error. OP-1 in `docs/audits/evidence-checklist.md:113` already flags "audit-sink + per-route MCP coverage pending"; this is the concrete missing check. | `scripts/check-production-deploy.ts` (no wrangler.toml binding-presence assertion). | Surfaced 2026-05-23. Lands as the regression test that keeps CT-8 closed. |
| **CT-11** | **P3** | **`composeSinks` swallows per-sink errors quietly.** `packages/audit/src/index.ts:182-200` collects errors and `console.error`s them but does not increment any counter / metric / second-sink emission. With CT-8 fixed, a D1 outage would log to console once per failed write and produce no aggregate signal. Wire into `MetricsSink` (`packages/audit/src/index.ts:222`) so durable-sink failure-rate is observable. | `packages/audit/src/index.ts` `composeSinks` body. | Surfaced 2026-05-23. Observability gap, not a correctness gap. |
| **CT-12** | **P3** | **`NODE_ENV` may default to "development" in Cloudflare Workers production env if not explicitly set in `[env.production.vars]`.** The audit package's PII guardrail + several emitters key off `process.env.NODE_ENV`. Worth re-verifying both worker `wrangler.toml`s set `NODE_ENV="production"` in their production-env vars block. Default-to-dev is a footgun for the Wave H1 production-default gates. | `apps/demo-a2a/wrangler.toml` + `apps/demo-mcp/wrangler.toml` `[env.production.vars]` blocks need explicit `NODE_ENV` setting. | Surfaced 2026-05-23 in passing. |

---

## External Review — June 2026 (incorporated)

A full-monorepo external review (intent-spine / naming / ontology focus) landed 2026-06-03. Its verdict
— **external-audit-ready alpha; P0 blockers concentrate in contracts governance keys + pending
third-party audit + operational hardening** — matches this doc's standing verdict. Reconciliation:

**Already tracked (re-raised, no new ID):**
- *Leaked deployer key / governance* → **N1** (P0) + the rotation runbook in `packages/contracts/AUDIT.md` §4.1.
- *No third-party contract audit* → **N15** (P0, engagement still open) + the auditor packet (`specs/214`).
- *Production preflight incomplete* → **N10** (P1). Durable audit sinks everywhere → **CT-8/CT-11**.
- *Old orphaned contracts* → **N6**; *NODE_ENV default-to-dev* → **CT-12**; *managed MAC rotation* → **N13**.

**New, now on record:**

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| **EXT-1** | **P1** | **Intent spine needs dedicated threat modeling.** `intent-marketplace` / `intent-resolver` / `payments` / `fulfillment` / `attestations` have no STRIDE rows yet: solver front-running, runtime `ConstraintSet` enforcement, `PaymentMandate` scoping, evidence/outcome lifecycle integrity, privacy in matching. Highest-risk new surface. | OPEN — add a Boundary section to `threat-model.md` + per-package invariants before beta. |
| **EXT-2** | **P1** | **EIP-712 typehash consistency (TS ↔ Solidity) lacks a CI gate.** A drift between `packages/delegation` hashing and the on-chain `DelegationManager`/registries typehashes would silently break ERC-1271 redemption. | OPEN — add a CI check that asserts the TS typehashes equal the Solidity constants. |
| **EXT-3** | **P2** | **WebAuthn `authenticatorData` length not validated** on the passkey verify path. | OPEN — bounds-check authData before parsing (connect-auth / agent-account verify). |
| **EXT-4** | **P2** | **No SHACL/ontology enforcement hook in `mcp-runtime`/`tool-policy`.** `ontology` ships shapes but nothing validates tool I/O or LLM-derived intents against them at runtime (neuro-symbolic guardrail). | OPEN — optional shape-validation step in the tool pipeline. |
| **EXT-5** | **P2** | **`agent-relationships` privacy model.** Experimental, public-graph-only; the private person↔org model is now `related-agents` (ADR-0025). Clarify/isolate the experimental edge package so it isn't mistaken for the private path. | OPEN — doc/isolation; ADR-0025 already governs the private path. |
| **EXT-6** | **P1** | **`PaymentMandate` ↔ delegation-caveat binding + AP2/x402 alignment** is unspecified — a payment mandate must be a scoped delegation caveat, not a free-standing grant. | OPEN — spec the mandate-as-caveat binding (peer of the on-chain enforcers). |

**demo-jp custody/vault findings (2026-06-03 audit — see `apps/demo-jp/AUDIT.md`):**
- **DEMO-1** (P0, accepted testnet hole): operator org keys (GC/JP) derived from hardcoded seeds are
  globally identical → any visitor owns both org vaults incl. member PII. Hardening: **spec 248** (per-
  operator SIWE/KMS custody, spec 235).
- **DEMO-2** (P0, accepted testnet hole): vault delegations are full-vault grants (no `record_type`
  scope enforced off-chain). Hardening: **spec 248** (record-type scope caveat in the vault tools).
- *Fixed 2026-06-03:* the recognition gate now ERC-1271-verifies JP's signature (was presence-only).

**Architecture-debt cleanup done 2026-06-03 (this turn):**
- **F6** — consolidated demo-jp's two `reverseName` implementations to one (`naming.ts` re-exports
  `chain.ts`'s single `reverseResolveString` read; ADR-0013 one-fact-one-mechanism).
- **F7** — added a transport+KMS-boundary `forbiddenTerms` baseline to the 8 spine packages that
  declared none (`agreements`, `attestations`, `fulfillment`, `intent-marketplace`, `intent-resolver`,
  `payments`, `related-agents`, `verifiable-credentials`); `check:forbidden-terms` now enforces them.
- **F5** — the per-agent `vault-client` is intentionally **app-local in each of demo-jp + demo-sso-next**:
  it is MCP-vault *transport* glue (POSTs to that app's `/a2a/mcp/vault/*` proxy), which ADR-0021 keeps
  OUT of `packages/*` (packages are transport-agnostic). The two clients share a shape; the persona-
  signing delegation builder is app custody glue. Decision: keep app-local, do not package.
- **F3** — `docs/audits/architecture-diagram.md` is ~6 waves stale (12 of 25 packages, old factory
  address); a staleness banner was added pointing to the authoritative `capability.manifest.json` set +
  `deployments-base-sepolia.json`. A full redraw is tracked as doc debt.

---

## Top Priorities (Next Hardening Pass)

These are the items the next pass should close. Selected by impact × ease — biggest reduction in attack surface per hour of work.

| # | ID | Action | Effort | Owner |
| --- | --- | --- | --- | --- |
| **1** | **N8** | **Make `tool-policy.evaluatePolicy()` fail closed.** Deny empty classification, unknown `@sa-tool`, unknown `@sa-auth`, missing/unknown risk tier, and missing delegation for delegation-verified tools. Add negative unit tests. | 1 h | tool-policy |
| **2** | **N9** | **Reject invalid delegation packages.** `/session/package` must fail when ERC-1271 validation returns false or reverts; do not persist the package. | 30 min | apps/demo-a2a |
| **3** | **N10/C4** | **Tighten production preflight.** Require GCP signing + envelope keys for production session encryption/signing, `A2A_MAC_SECRET` or managed HMAC config, exact CORS allowlist, non-dev paymaster mode, audit sink wiring, tool classification, and skip-flag approval policy. | 2-3 h | deploy scripts + apps |
| **4** | **N11** | **Apply input validation to all A2A deploy routes.** Reuse the `/account/derive-address` validators for `/session/deploy` and `/session/deploy/submit`; return 400 instead of throwing. | 1 h | apps/demo-a2a |
| **5** | **N12** | **Lock CORS to `ALLOWED_ORIGINS` for credentialed requests.** No reflect-origin fallback in production; localhost only in development. | 30 min | apps/demo-a2a |

The next pass after these should pick up **N1 (production key rotation)**, **C3 (connect-auth/key-custody envelope/deploy audit events)**, **H5 (cross-delegation)**, **N13 (managed MAC key/rotation)**, and **M8 (operational runbooks + alerts)**.

---

## Executive Verdict (carried forward from 2026-05-19, updated)

The core decomposition is sound. The seven-package split follows the repo doctrine: identity, account substrate, delegation authority, key custody, protocol-agnostic policy, MCP runtime, and shared types are separated with explicit dependency direction.

The implementation is now beyond a stub scaffold: the demo path exercises SIWE, passkey-only smart accounts, counterfactual signatures via ERC-6492, deterministic addressing, paymaster-sponsored deployment, session encryption, delegation packaging, delegation-token minting, MCP verification, D1-backed JTI tracking, and Cloudflare deployment — **all proven end-to-end on Base Sepolia with passkey ownership** as of 2026-05-20. GCP KMS support is materially useful: `agent-master` signs secp256k1 digests through HSM, while `agent-envelope` wraps session data keys through symmetric encrypt/decrypt.

It is not product-ready yet. The highest risks are:
- **N1**: production governance must move off the leaked demo deployer before any external use.
- **C3/C4/N10**: audit coverage is mostly closed, but production preflight is not complete enough to be a launch gate.
- **N8/N9/N11/N12**: policy fail-closed behavior, delegation packaging, deploy-route validation, and credentialed CORS need a focused hardening pass.

Board-style launch decision (2026-05-23 revision): **Internal demo + controlled technical pilot on testnet only.** Wave H1 closed the "production-safe defaults are opt-in" P0 finding for the two highest-risk packages (mcp-runtime, key-custody). The repository can now support technical pilots that bind ONLY testnet value, with the remaining launch blockers tracked in the H3/H5 work items (off-chain quorum semantics, durable A2A audit). Real funds / real organization authority / real PII remains blocked pending: a dedicated contract audit dossier, durable A2A audit sink, completion of off-chain quorum enforcement semantics, and operator-side key rotation + governance procedures.

Severity language used in this audit:

| Severity | Meaning | Launch impact |
| --- | --- | --- |
| P0 / Critical | A production blocker that can compromise authority, funds, keys, or auditability. | Must fix before any external deployment. |
| P1 / High | Must fix before external pilot or beta. | Blocks customer/user exposure. |
| P2 / Medium | Hardening before scale. | May be accepted only with explicit risk sign-off. |
| P3 / Low | Polish, maintainability, or clearly accepted demo risk. | Track but does not block demo. |

Production rule: **demo shortcuts must be impossible to activate in production.** A production boot or deploy should fail if mock auth, dev private keys, seed routes, bypass tokens, local-only session secrets, unprotected debug endpoints, counterfactual-only verification, or accept-all sponsorship are enabled.

---

## Architecture Summary

```mermaid
flowchart TD
  types["types"]
  identityAuth["connect-auth"]
  agentAccount["agent-account"]
  keyCustody["key-custody"]
  delegation["delegation"]
  toolPolicy["tool-policy"]
  mcpRuntime["mcp-runtime"]

  identityAuth --> types
  agentAccount --> types
  agentAccount --> identityAuth
  keyCustody --> types
  keyCustody --> identityAuth
  delegation --> types
  delegation --> identityAuth
  delegation --> agentAccount
  delegation --> keyCustody
  toolPolicy --> types
  mcpRuntime --> types
  mcpRuntime --> delegation
  mcpRuntime --> keyCustody
  mcpRuntime --> toolPolicy
```

Runtime topology (Base Sepolia production):

```mermaid
flowchart TD
  browser["Browser demo-web<br/>Pages CDN"]
  pages["Cloudflare Pages<br/>agenticprimitives-demo.pages.dev"]
  a2a["demo-a2a Worker<br/>(secret RPC_URL → Alchemy)"]
  validator["UniversalSignatureValidator<br/>0x9c7Db1070...<br/>(ECDSA + 1271 + 6492)"]
  sessions["Durable Object<br/>SessionStoreDO"]
  kms["GCP KMS<br/>agent-master + agent-envelope"]
  mcp["demo-mcp Worker"]
  d1["D1 profiles + JTI"]
  factory["AgentAccountFactory<br/>0x81F3FF...<br/>+ createAccountWithPasskey"]
  paymaster["SmartAgentPaymaster<br/>0x7778c0F6...<br/>(verifying mode + deposit status)"]

  browser --> pages
  pages --> a2a
  a2a --> sessions
  a2a --> kms
  a2a --> mcp
  mcp --> d1
  a2a -.ERC-1271/6492.-> validator
  validator -.deploy counterfactual.-> factory
  a2a -.handleOps.-> paymaster
  a2a --> factory
  mcp -.isValidSignature.-> factory
```

Primary trust boundaries:

| Boundary | Current control | Product-readiness concern |
| --- | --- | --- |
| Browser to A2A | SIWE + JWT cookie + CSRF double-submit token | **N12**: credentialed CORS still reflects origin. |
| A2A SIWE verification | Universal validator on-chain (ECDSA + 1271 + 6492) | Strong direction; depends on validator being audited. |
| A2A session storage | Durable Object + envelope-encrypted session package | Production requires GCP envelope key; **C3**: no append-only audit. |
| A2A to KMS | GCP service account with key-scoped IAM | Demo reuses one SA; split for production. |
| A2A to MCP | Delegation token + HMAC service envelope + nonce/JTI replay tracking | **N13**: managed MAC key + rotation story still missing. |
| MCP to chain | ERC-1271 + revocation + caveat checks | H3 closed for production; keep RPC outage tests in CI. |
| UserOp sponsorship | EntryPoint + verifying paymaster + KMS relayer + status endpoint | C2/N3 closed for demo; production still needs alert wiring and runbook. |
| Governance | Demo deployer EOA (0x31ed...) | **N1**: accepted for internal demo only; production needs clean governance. |
| Package boundaries | Manifest checks + forbidden-term checks + import checks | Good baseline; not a substitute for behavioral tests. |

---

## Package Review (deltas only since 2026-05-19)

### `@agenticprimitives/connect-auth`

- **+** `verifyUserSignature` / `verifyUserSignatureView` / `verifyOnchain` (siwe) now ship, calling the universal validator.
- **+** Passkey methods (`buildWebAuthnAssertion`, `parseAttestationObject`, etc.) fully implemented.
- **-** Google method still a stub (H4 partial).
- **+** CSRF helpers are now enforced in demo-a2a mutating routes.

### `@agenticprimitives/agent-account`

- **+** `buildDeployUserOpWithPasskey`, `encodeWebAuthnSignature`, `SIG_TYPE_WEBAUTHN`, `getAddressForPasskey` shipped.
- **+** ABI now declares `FailedOp` + `FailedOpWithRevert` so viem decodes EntryPoint reverts.
- **-** N4 — `verificationGasLimit: 1.2M` ceiling wasteful on RIP-7212 chains.

### `@agenticprimitives/delegation`

- **+** H3 closed: revocation read now defaults to fail-closed when `NODE_ENV=production`, with explicit `revocationFailMode='open'` available for dev/demo.
- **+** C3 partially closed: `verifyDelegationToken()` can emit `delegation.verify.{accept,reject}` through an `AuditSink`.
- **-** Mint/revoke audit events still missing.

### `@agenticprimitives/key-custody`

- **+** `LocalAesProvider` production guard narrowed to session-data-key encryption/decryption. `generateMac()` now works in production as shared-secret HMAC for service auth.
- **-** M1, M2 still open.
- **-** N13 — managed HMAC key / rotation policy still missing.

### `@agenticprimitives/mcp-runtime`

- **+** C1 closed at the runtime level: `generateServiceMac()` / `verifyServiceMac()` bind audience, service, route, nonce, timestamp, and body digest.
- **+** H2 closed at integration level: `withDelegation()` accepts classification and denies policy `deny` / `requires-consent`.
- **+** C3 partially closed: `withDelegation()` and service-MAC verification emit accept/reject audit events when an `AuditSink` is provided.
- **-** `classification` and `auditSink` are still optional for back-compat; production preflight should forbid omission.

### `@agenticprimitives/tool-policy`

- **+** Runtime integration exists through `mcp-runtime`.
- **-** N8 — pure policy engine still returns allow for unknown / incomplete classification metadata.

---

## Demo App / Deploy Review (deltas)

### `apps/demo-web`

- **+** Step 0 signer chooser (EOA / Passkey).
- **+** `passkey-flow.ts`, `passkey-signer.ts`, `passkey-siwe-flow.ts`, `erc6492-wrap.ts`.
- **+** Steps 1.5 / 2 / 3 work for both signer kinds.
- **-** Still stores mnemonic in localStorage (accepted demo risk).
- **-** No passkey recovery UX (N7).

### `apps/demo-a2a`

- **+** `verifyOnchain` (universal validator) for SIWE verification — signer-agnostic.
- **+** `addressIsSmartAccount: true` siwe-verify flag for passkey path.
- **+** `/session/deploy` `initMethod` enum (eoa / passkey).
- **+** `/account/derive-address` server-side view-call relay.
- **+** CSRF middleware on mutating routes.
- **+** `/account/derive-address` validation + simple per-IP rate limit.
- **+** `RPC_URL` now a wrangler secret.
- **-** **N9** — `/session/package` persists even when ERC-1271 verification fails.
- **-** **N11** — deploy routes still parse untrusted BigInt values directly.
- **-** **N12** — credentialed CORS still reflects origin.

### `apps/demo-mcp`

- **+** M3 closed: `/_dev/seed` is guarded for production.
- **+** Service-MAC middleware verifies A2A requests before delegation parsing and emits audit events.
- **+** D1 audit sink (`audit_events`) wired via `composeSinks(console, d1)`.

### `packages/contracts`

- **+** `UniversalSignatureValidator` (116 LOC, ported from smart-agent) deployed live.
- **+** `AgentAccount.initializeWithPasskey` + `AgentAccountFactory.createAccountWithPasskey` + `getAddressForPasskey`.
- **+** `SmartAgentPaymaster` verifying mode deployed live at `0x7778c0F6...` with dev mode off.
- **+** 17 new Forge tests for passkey-owned accounts + 9 new for the universal validator.
- **-** Still no third-party audit.
- **-** **N1** — governance roles all held by the leaked deployer key.
- **-** Old orphaned contracts (N6).

### Deploy and CI

- **+** Validator address propagated through `gen-dev-vars.ts` + `deploy-cloudflare.ts`.
- **+** Playwright passkey e2e (`05-passkey-login.spec.ts`) with virtual authenticator.
- **+** C4 partially closed: `scripts/check-production-deploy.ts` exists and runs production-shape checks.
- **+** M7 closed: supply-chain workflow + local check + runbook exist.
- **+** Deploy/dev shell scripts are executable; stray `Zone.Identifier` metadata file removed.
- **-** **N10** — preflight is not yet strict enough for production.
- **-** **N5** — no post-deploy smoke / scheduled canary.

---

## Open Findings — Critical

| ID | Finding | Impact | Owner | Remediation |
| --- | --- | --- | --- | --- |
| **N1** | Leaked demo deployer key controls live demo governance. | **Accepted internal-demo risk only.** This blocks any external or production use of the current deployment. | contracts + ops | For production: generate a clean deployer, rotate `bundlerSigner` / `sessionIssuer` (factory) + paymaster ownership/governance, or redeploy with clean governance. Then burn the leaked key and document the runbook. |
| ~~**C1**~~ | ~~Service-to-service authentication is not load-bearing.~~ | **CLOSED 2026-05-20.** `mcp-runtime.{generateServiceMac,verifyServiceMac}` shipped + wired into demo-a2a/demo-mcp. MAC binds audience + service + route + nonce + timestamp + body digest. Nonce replay tracked via JTI store. 18 unit tests + e2e proof. Current production-acceptable path is shared-secret HMAC via wrangler secret; managed HMAC rotation remains N13. | — | Done. |
| ~~**C2**~~ | ~~Paymaster is not production-safe by default.~~ | **CLOSED 2026-05-20.** Verifying-paymaster mode is live, demo-a2a signs paymaster envelopes via the master KMS account, and dev mode is off on the current paymaster. | — | Keep contract tests and monitor signer/governance drift. |
| **C3** | Full product audit/forensics trail is incomplete. | Security incidents cannot be reconstructed end-to-end yet. **MOSTLY CLOSED 2026-05-20 (pass 5b)** — `@agenticprimitives/audit` package, mcp-runtime/service-MAC accept+reject events, delegation verify accept+reject events, delegation mint events, key-custody signA2AAction events (Local + GCP), D1 sink, and per-request correlationId all wired. Remaining: connect-auth caller-emit + key-custody envelope encrypt/decrypt emission + PII guardrail sink (`createPiiGuardrailSink`) — none are launch blockers. Demo-a2a uses console-only sink (no D1 binding yet); demo-mcp persists to D1 — unifying destinations is a future-spec item. | cross-cutting | Continue: connect-auth emit at caller sites, envelope encrypt/decrypt emit, PII guardrail sink, then make production preflight require a durable sink. |
| **C4** | Production deploy hard-fail gate is partial, not complete. | Demo shortcuts or missing production secrets can still slip through because checks are shape-based and incomplete. | deploy scripts, apps, contracts | Close N10: stricter checks for KMS, MAC secret/key, non-dev paymaster, exact CORS, audit sink, tool classification, and skip-flag policy. |
| **N8** | `tool-policy.evaluatePolicy()` fails open for unknown/incomplete classification. | An unclassified or malformed tool can be allowed by default. | tool-policy | **Top priority #1.** Deny missing/unknown classification fields and add negative tests. |

## Open Findings — High

| ID | Finding | Impact | Owner | Remediation |
| --- | --- | --- | --- | --- |
| ~~**H1**~~ | ~~CSRF is not enforced on cookie-authenticated A2A mutations.~~ | **CLOSED 2026-05-20.** demo-a2a now uses a double-submit CSRF token for mutating routes. | — | Keep tests and ensure production preflight rejects disabled CSRF. |
| ~~**H2**~~ | ~~Policy classification is not enforced in MCP runtime.~~ | **CLOSED 2026-05-20.** `withDelegation` now accepts `opts.classification` and runs `evaluatePolicy()` after delegation verify. Fail-closed on `deny` + `requires-consent`. demo-mcp wires `GET_PROFILE_CLASSIFICATION`. | — | Done. |
| ~~**H3**~~ | ~~Revocation check tolerates RPC failure.~~ | **CLOSED 2026-05-20.** `revocationFailMode` defaults closed in production. | — | Keep explicit dev/demo opt-out only. |
| ~~**N2**~~ | ~~/account/derive-address has no input validation or rate limit.~~ | **CLOSED 2026-05-20** for this endpoint. | — | Broader A2A BigInt validation remains open as N11. |
| ~~**N3**~~ | ~~Paymaster has no balance monitoring or auto-refill.~~ | **CLOSED 2026-05-20.** `/paymaster/status` exposes deposit health and threshold status for external monitors. | ops + apps/demo-a2a | Follow-up: wire alerting and document refill runbook under M8. |
| **H5** | Cross-delegation is not implemented. | Steward/data-owner and cross-agent flows cannot be supported. | delegation, mcp-runtime | Implement delegate-binding and data-scope verification with negative tests. |
| **N9** | `/session/package` stores delegations even when ERC-1271 verification fails. | Invalid sessions can be persisted and later confuse authorization state. | apps/demo-a2a | **Top priority #2.** Reject on false/reverted ERC-1271 result. |
| **N10** | Production preflight is incomplete. | Deploy can pass while still missing launch-critical guarantees. | deploy scripts + apps | **Top priority #3.** Expand preflight checks and define skip approval policy. |
| **N11** | Other A2A deploy routes still parse untrusted BigInts directly. | Malformed inputs can produce 500s and possible DoS. | apps/demo-a2a | **Top priority #4.** Reuse strict uint256/hex/address validation across deploy routes. |
| **N12** | Credentialed CORS reflects origin. | Cookie-authenticated API is exposed more broadly than intended. | apps/demo-a2a | **Top priority #5.** Exact whitelist via `ALLOWED_ORIGINS`; localhost only in dev. |

## Open Findings — Medium

| ID | Finding | Impact | Owner | Remediation |
| --- | --- | --- | --- | --- |
| **H4** | Google auth surface is incomplete. | Public API implies Google support; method throws. | connect-auth | Mark experimental in docs OR implement. (Passkey portion of original H4 is now closed.) |
| **M1** | AWS KMS backend is advertised but not implemented. | Consumers selecting AWS get runtime errors. | key-custody | Hide AWS from stable docs OR implement provider + signer + tests. |
| **M2** | Per-tool executor keys are not isolated. | Tool compromise has master-key blast radius. | key-custody | Implement per-tool KMS key selection + IAM separation. |
| ~~**M3**~~ | ~~Dev-only profile seeder exposed in MCP app.~~ | **CLOSED 2026-05-20.** Route is production-gated and preflight checks for unguarded `/_dev/*` routes. | — | Keep regression check. |
| **M4** | Test pyramid is incomplete in CI. | Integration regressions across packages, deployed contracts, browser flows may escape. | repo CI | Add cross-package integration, Anvil system tests, E2E, smoke, property tests, type locks. |
| **M5** | Local fallback and dev secret names remain in production-shaped app code. | Misconfiguration can route production through dev paths. | apps/demo-a2a, key-custody, deploy scripts | Production deploy must require GCP for session encryption/signing. Local MAC via `A2A_MAC_SECRET` is acceptable, but should be explicitly configured and rotated. |
| **M6** | Documentation drift exists. | Reviewers may trust stale comments. | key-custody | Refresh package docs after the LocalAesProvider MAC guard change + add doc drift check. |
| ~~**M7**~~ | ~~Supply-chain + static-analysis gates are minimal.~~ | **CLOSED 2026-05-20** (Phase 5a). `.github/workflows/security.yml`: CodeQL (security-extended) SAST + `pnpm audit --audit-level=high` + gitleaks + CycloneDX SBOM artifact. `pnpm check:supply-chain` mirrors locally. Dependabot weekly + security-update-immediate. Runbook + branch-protection setup in `docs/audits/supply-chain.md`. | — | Done. |
| **M8** | Reliability posture is not yet specified. | RPC outages, KMS errors, D1 failures may produce inconsistent auth. | apps, deploy docs | Define retry policy, timeout budgets, fail-closed paths, alerting, runbooks. |
| **N4** | Verification gas ceiling wasteful on RIP-7212 chains. | Paymaster deposit drains 4× faster than necessary. | agent-account, deploy config | Per-chain `verificationGasLimit` config (e.g. 400k on Base, 1.2M on anvil). |
| **N5** | No live canary / deployed smoke test. | Silent breakages only surface on real-user request. | repo CI + deploy scripts | Add post-deploy smoke + scheduled canary. |
| **N6** | Old orphaned contracts on Base Sepolia. | Funds locked in old paymaster's stake; same leaked key (N1) controls them. | ops | Withdraw stake from old paymaster after unstake delay; document deprecation. |
| **N13** | Managed production MAC key support is missing. | Shared secret works, but rotation/IAM/key-id story is immature. | key-custody + apps | Add GCP KMS HMAC backend or document shared-secret rotation policy as the production v0 posture. |
| **N14** | Passkey user verification is not required. | UV-less credentials may be accepted depending on platform behavior. | connect-auth + demo-web | Decide `required` vs `preferred`; encode in spec and tests. |
| **N15** | Contracts lack dedicated audit dossier. | Third-party reviewer lacks one place for invariants and threat model. | packages/contracts | Add `packages/contracts/AUDIT.md` covering factory, account, paymaster, enforcers, delegation manager, validator. |
| ~~**N16**~~ | ~~Smart-account multi-sig and recovery policy is not productized.~~ | **MOSTLY CLOSED 2026-05-20 (phase 6c).** Spec 207 (smart-account threshold policy) shipped end-to-end: contract surface (QuorumEnforcer / ApprovedHashRegistry / MultiSendCallOnly + AgentAccount with `_modeFlags` / threshold getters / propose-execute-cancel admin / T6 recovery with 48h timelock + 24h primary-owner cancel window + spec § 5.1 default threshold matrix), factory extension (`createAccountWithMode` refuses `threshold` / `org` mode with insufficient guardians), SDK (`@agenticprimitives/tool-policy` `ThresholdTier` + `evaluateThresholdPolicy`; `@agenticprimitives/delegation` `buildQuorumCaveat` + `requireQuorumCaveat` / `requireAcceptedOnChain` verify gates; `@agenticprimitives/agent-account` `packSafeSignatures` + admin/recovery ABI), and runtime wiring (`mcp-runtime.withDelegation` threads threshold-policy decision into verify). 181 Forge tests + workspace SDK tests green. Demo flow (`apps/demo-web-pro/src/flows/hybrid-recovery/`) scaffolded. Remaining: contracts redeploy + live wiring + Playwright e2e for spec § 9 rows 1/2/3/12 (T1-T3 happy paths + caveat composition). | agent-account + delegation + tool-policy + mcp-runtime | Ship contracts redeploy + Playwright e2e in a follow-up phase; productize demo-web-pro admin + recovery UX panels (phase 7). |

## Open Findings — Low

| ID | Finding | Notes |
| --- | --- | --- |
| **L1** | Demo browser stores mnemonic in localStorage. | Accepted demo risk. |
| **L2** | Memory JTI store is not distributed-safe. | Test-only; documented. |
| **L3** | Some docs still describe old deployment assumptions. | Reconcile after audit remediation pass. |
| **N7** | No documented account recovery for passkey-only accounts. | Will surface on first real passkey loss. Mitigation: encourage multi-passkey enrollment + multi-sig promotion via `addOwner`. |

---

## Product-Readiness Checklist (refreshed)

Must fix before production:

- [ ] **N1**: Rotate / replace the leaked deployer key controlling factory governance + paymaster ownership.
- [ ] **C3**: Finish append-only audit events for connect-auth, key-custody envelope encrypt/decrypt, deployment/paymaster actions, and PII guardrail sink.
- [ ] **C4/N10**: Production preflight that fails on demo mode, dev keys, missing KMS/MAC/audit/classification config, seed routes, accept-all paymaster, and unsafe CORS.
- [ ] **N8**: Make `tool-policy.evaluatePolicy()` fail closed for missing/unknown classification.
- [ ] **N9**: Reject `/session/package` when ERC-1271 verification fails.
- [ ] **N11**: Input validation + rate limits on all browser-facing A2A deploy/package routes.
- [ ] **N12**: Exact CORS allowlist for credentialed A2A requests.
- [ ] **M4**: Add system + E2E + smoke CI gates for the full deployed flow.
- [ ] **M5**: Production deploy hard-fails on local session encryption/signing backends.
- [ ] Third-party smart-contract audit.

Closed in current hardening passes:

- [x] **C1**: HMAC service envelopes for A2A-to-MCP.
- [x] **H1**: CSRF on browser-cookie mutating routes.
- [x] **H2**: `tool-policy.evaluatePolicy()` wired into `withDelegation()`.
- [x] **H3**: Production revocation check fail-closed.
- [x] **N2**: `/account/derive-address` input validation + rate limit.
- [x] **C2**: Verifying paymaster mode for sponsored UserOps.
- [x] **N3**: Paymaster status endpoint for deposit health monitoring.
- [x] **N16** (mostly): Smart-account threshold policy productized end-to-end (phase 6c). Contract + SDK + runtime layer all in place; pending live wiring + Playwright e2e.
- [x] **M3**: `/_dev/*` production route guard.
- [x] **M7**: Supply-chain checks (dependency audit, secret scanning, SAST, SBOM).

Should fix before beta:

- [ ] **H4**: Implement Google auth OR remove from product-facing promises.
- [ ] **H5**: Implement cross-delegation.
- [ ] **M1**: Implement AWS KMS OR mark unsupported.
- [ ] **M2**: Implement per-tool executor keys.
- [ ] **M6**: Doc drift cleanup.
- [ ] **M8**: Operational runbooks for RPC, KMS, D1, Worker, Durable Object failures.
- [ ] Paymaster alerting + refill runbook.
- [ ] **N4**: Per-chain `verificationGasLimit` config.
- [ ] **N5**: Live canary smoke test on schedule.
- [ ] **N7**: Documented passkey recovery / multi-passkey enrollment flow.
- [ ] **N13**: Managed MAC key or documented shared-secret rotation policy.
- [ ] **N14**: Passkey UV decision (`required` vs `preferred`) encoded in spec/tests.
- [ ] **N15**: `packages/contracts/AUDIT.md`.
- [ ] Property tests for caveat evaluation, AAD binding, policy decisions.
- [ ] Public API type tests.
- [ ] Rate limits + abuse controls for browser-facing and MCP-facing routes.

Accepted demo risks:

- Demo EOA mnemonic in browser localStorage (L1).
- Local Anvil secrets in `.dev.vars` (auto-generated).
- Demo profile data seeded in D1 via `/_dev/seed` (mitigation: M3).
- Single GCP service account for multiple key permissions.
- Minimal UI consent copy on delegation grants.

Deferred roadmap items:

- `a2a-runtime` package.
- Framework adapters (LangChain / Vercel AI SDK / etc.).
- Contracts ABI / deployments package.
- Account relay / paymaster policy package.
- External audit-chain anchoring (e.g. Sigsum, Rekor).

---

## Continuous Audit Process

Every PR that touches auth, keys, delegation, policy, MCP, contracts, or deploy should include:

```text
Security note:
- What authority does this introduce or change?
- What signs, decrypts, or stores sensitive material?
- What is the fail-closed path?
- What replay, expiry, nonce, or JTI protection exists?
- What audit event is emitted?
- Which package owns the invariant?
- Which demo shortcut, if any, is explicitly non-production?
```

Reviewer checklist:

- Package boundary still matches `capability.manifest.json`.
- Public API matches spec and architecture docs.
- Security invariants have tests.
- New runtime paths call existing primitives rather than reimplementing crypto or verification.
- Error messages do not leak auth failure mode to external callers.
- Production deploy cannot silently use local secrets.
- Production deploy cannot enable demo shortcuts.
- Data handling is reviewed for browser exposure, logs, PII retention, and seeded demo data.
- Agent/tool execution is gated by verified authority and policy, not just UI affordances.
- New docs update specs when behavior changes.

---

## Audit History

| Date | Pass | Highlights |
| --- | --- | --- |
| 2026-05-19 | Initial audit draft | 4 P0, 5 P1, 8 P2, 3 P3 findings catalogued. |
| 2026-05-20 | Phase 4b refresh | Closed: H4 partial (passkey done), passkey arc, RPC-in-config leak. Added: N1 (leaked deployer key), N2 (`/account/derive-address` validation), N3 (paymaster monitoring), N4 (gas ceiling), N5 (live canary), N6 (orphaned contracts), N7 (passkey recovery). |
| 2026-05-20 | Hardening pass 1 | Partially closed: **C4** (production preflight exists, stricter launch checks remain N10). Closed: **M3** (`/_dev/seed` gating), **H1** (CSRF middleware on demo-a2a), **H3** (fail-closed revocation in production), **N2** (input validation + rate limit on `/account/derive-address`). |
| 2026-05-20 | Hardening pass 2 | Closed: **C1** (HMAC service envelope A2A→MCP, load-bearing with nonce replay-tracking + clock-skew bound), **H2** (`tool-policy.evaluatePolicy()` wired into `withDelegation` with deny/requires-consent handling). Added follow-up **N8** for fail-closed policy metadata validation. N1 remains accepted internal-demo risk only; production must rotate to clean governance. |
| 2026-05-20 | Hardening pass 3a | Partially closed: **C3** (audit/forensics trail) — new `@agenticprimitives/audit` package with `AuditEvent` + `AuditSink` + console/memory/compose sinks, mcp-runtime emits accept/reject events from `withDelegation` + `verifyServiceMac`, demo-mcp wires console sink. Per-package emission across `delegation` / `key-custody` / `connect-auth` is the follow-up. |
| 2026-05-20 | Hardening pass 3b | C3 extended: `delegation.verifyDelegationToken` emits `delegation.verify.{accept,reject}` per call; sink threaded through from `mcp-runtime.withDelegation`. Durable D1 sink ships as `createD1AuditSink(db)` in demo-mcp alongside the existing JTI store adapter + migration `0002_audit_events.sql` (append-only audit_events table with action/outcome/correlation_id indices). demo-mcp now wires `composeSinks(console, d1)` so a D1 outage never blackholes forensics. Remaining: key-custody + connect-auth emission, mint/revoke events, runtime PII-leak guardrail sink. |
| 2026-05-20 | Hardening pass 3c | Refreshed after LocalAesProvider MAC guard split. Confirmed shared-secret HMAC is acceptable for service auth while local envelope encryption/signing remain non-production. Added N8-N15 residual findings and reprioritized next hardening pass. |
| 2026-05-20 | Phase 4 | Closed: **C2** (paymaster lockdown) — SmartAgentPaymaster gains a verifying-paymaster mode (ERC-4337 v0.7 reference pattern); on-chain ECDSA recovery against a designated KMS-backed signer; demo-a2a signs every paymaster envelope via the master KMS account; live paymaster at `0x7778c0F6...` with `verifyingSigner=0x3C7B58...` and dev mode off. **N3** (paymaster monitoring) — new `GET /paymaster/status` endpoint returns deposit + threshold + 503/200 toggle for external monitors. 8 new Forge tests; 103 total Forge tests passing. |
| 2026-05-20 | Phase 5a | Closed: **M7** (supply-chain CI). `.github/workflows/security.yml`: CodeQL `security-extended` SAST + `pnpm audit --audit-level=high` + gitleaks + CycloneDX SBOM. Dependabot weekly + security-update-immediate. `pnpm check:supply-chain` mirrors the workflow locally. Runbook + branch-protection setup in `docs/audits/supply-chain.md`. Local pre-flight clean (3 moderate deps below threshold; no high/critical). |
| 2026-05-20 | Phase 5b | C3 progressed to **MOSTLY CLOSED**. `delegation.mintDelegationToken` now accepts `{ auditSink, correlationId }` and emits `delegation.mint` per call (`subject: jti`, `audience` populated, fail-soft on sink errors, 2 new tests in `token.test.ts`). `key-custody.BuildOpts` gained an `auditSink` field threaded through `buildSignerBackend` into `LocalSecp256k1Signer` and `GcpKmsSigner`; both emit `key-custody.sign` on every `signA2AAction` with hashed sessionId (`keccak256(sessionId).slice(0,18)`) per the CLAUDE.md invariant "Raw sessionId MUST NEVER be logged". demo-a2a wires a console-only sink today (no D1 binding) and propagates `X-Correlation-Id` to demo-mcp for trail stitching. Spec drafted: `specs/206-audit.md`. Doctrine drift caught + fixed: manifest.publicExports + manifest.imports synced for agent-account / connect-auth / mcp-runtime / delegation / key-custody (carry-over from earlier passes). Remaining C3 slice: connect-auth caller-emit, envelope encrypt/decrypt emit, `createPiiGuardrailSink`. |
