# Threat Model — agenticprimitives

**Owner:** [security-auditor](../agents/security-auditor.md).
**Refresh cadence:** every hardening wave; date-stamp each section
on touch.
**Last refresh:** 2026-05-23 (post security-auditor H5 audit — CT-8/9/10/11/12 landed).
**Method:** STRIDE per trust boundary, mapped to package owners.
**Companion docs:** [`architecture-diagram.md`](./architecture-diagram.md) ·
[`evidence-checklist.md`](./evidence-checklist.md) ·
[`specs/214-production-audit-dossier.md`](../../specs/214-production-audit-dossier.md).

---

## 0. Reading guide

For each trust boundary we list:
- **Assets at risk** (what the attacker is trying to compromise).
- **Attacker capability** (what they bring to the boundary).
- **STRIDE rows**: Spoofing / Tampering / Repudiation / Info-disclosure
  / DoS / Elevation-of-privilege.
- **Controls in place** (file paths + wave that landed them).
- **Residual risk** (what's still open + the OPEN finding it maps to).

---

## 1. Trust boundaries (system-wide)

```
┌────────────┐  origin allowlist  ┌────────────┐  service MAC  ┌────────────┐
│  Browser   │ ─── HTTPS ────────▶│ demo-a2a   │ ─── HTTPS ───▶│ demo-mcp   │
│ (web-pro / │                    │  Worker    │               │  Worker    │
│  recovery) │  CSRF / JWT cookie │  Cloudflare│  per-audience │  Cloudflare│
└────────────┘                    └────────────┘               └────────────┘
       │                                 │                            │
       │ passkey                         │ KMS / RPC                  │ D1 audit
       ▼                                 ▼                            ▼
  WebAuthn / wallet           GCP-KMS · Base Sepolia RPC      ─── chain RPC
                              · Paymaster deposit              · CustodyPolicy
                              · DEPLOYER_PRIVATE_KEY           · DelegationManager
                              · EntryPoint relay               · QuorumEnforcer
```

Each boundary below has its own section.

---

## 2. Boundary A — Browser ↔ demo-a2a Worker

**Assets at risk:**
- JWT session cookies + SIWE/passkey-bound smart-account.
- CSRF token.
- Deploy-time params (initParams + trustees + custodians).
- The deployer EOA private key (server-side, but exposed via direct-deploy).

**Attacker capability:**
- Any browser. May control the user's session via XSS in the demo
  frontend, network MITM, or social-engineering the user into pasting
  a payload into a malicious page that posts to the worker.

| STRIDE | Threat | Control | Wave | Residual |
| --- | --- | --- | --- | --- |
| **S** | Attacker forges a `/session/package` request as the user. | Exact-origin CORS allowlist (`buildAllowedOriginMatcher`) + CSRF token HMAC-bound to origin + timestamp + JWT session cookie. | N12 close (Wave R-pre) | If user runs malicious JS in the demo origin, XSS hijacks the session. Mitigated by no third-party JS in demo bundle; no in-flight finding. |
| **T** | Attacker mutates a delegation envelope in transit. | TLS (Cloudflare termination). Body parsing through `validate.ts` helpers; delegation signature re-verified server-side. | N11 close | TLS termination at Cloudflare; trust depends on Cloudflare. |
| **R** | User denies issuing a delegation. | EIP-712 typed-data + ERC-1271 signature persisted on `/session/package`. Verification re-runs on every redeem (delegation.verify). | N9 close | None — sig binds to the delegator's smart account on chain. |
| **I** | Attacker exfiltrates session-data-key. | Session key wrapped via `key-custody` envelope encryption; AAD-bound; production guard rejects local-aes. | H1 (key-custody prod-default) | If wrapped key + AAD leak together (e.g., D1 dump), an attacker with the KMS key can decrypt. Real mitigation: separate IAM scopes for KMS encrypt/decrypt vs sign. **OPEN: P1 in `evidence-checklist.md` KH-3.** |
| **D** | Spam `/account/derive-address` / `/session/direct-deploy` to drain RPC quota or paymaster. | Input validation rejects malformed early. Paymaster monitor + threshold alert. **No rate limit yet.** | N2 partial | **OPEN: P2 — add per-IP token bucket via Durable Object.** |
| **E** | Attacker uses the deployer EOA to mint admin txs. | DEPLOYER_PRIVATE_KEY wrangler-secret; never echoed; no client-facing endpoint to extract. | — | The deployer EOA is **disclosed in chat transcripts** (audit finding N1). Treat as compromised. **OPEN: P0 — rotate to clean key + redeploy.** |

---

## 3. Boundary B — demo-a2a ↔ demo-mcp (service-to-service)

**Assets at risk:**
- Service-MAC secret (`A2A_MAC_SECRET`).
- Tool-call requests + responses (PII / org-sensitive data).

**Attacker capability:**
- Network-position attacker (Cloudflare-internal — extremely
  restricted) OR a compromised demo-a2a instance.

| STRIDE | Threat | Control | Wave | Residual |
| --- | --- | --- | --- | --- |
| **S** | Replay an a2a→mcp envelope. | `verifyServiceMac` (in mcp-runtime) checks HMAC + timestamp + audience. Constant-time compare. | (existing) | Time-window replay possible within freshness window. Bound is 60s in production. |
| **T** | Modify the canonical message between sign + verify. | HMAC binds the canonical message bytes — any byte change invalidates. | (existing) | None. |
| **R** | demo-mcp denies receiving the request. | Audit row `mcp-runtime.service-mac.{accept,reject}` per attempt; durable in production. | — | **OPEN: CT-8 (a2a-side audit) + CT-9 (`generateServiceMac` has no issuing-side sink). H5 task.** |
| **I** | Leak MAC secret via worker logs. | Secret in wrangler env; never logged; preflight rejects local MAC in prod unless explicit opt-in. | (existing) | If GCP-KMS HMAC binding is missed, an operator with worker access could exfiltrate. **OPEN: P1 — managed HMAC rotation + audit (KH-5).** |
| **D** | Flood mcp with requests. | Cloudflare WAF + per-account JTI usage cap (replay store). | (existing) | Per-IP rate limit not yet wired in mcp-runtime. Same as Boundary A. |
| **E** | Compromise demo-a2a → mint arbitrary tokens. | Tokens are EIP-712 signed by the user's smart account, not by demo-a2a. demo-a2a holds the deployer EOA but cannot mint user delegations. | (existing) | If a malicious demo-a2a routes the bundler signer for paymaster envelope-signing, an attacker could drain the paymaster. **OPEN: P0 governance (N1).** |

---

## 4. Boundary C — demo-mcp ↔ tool handler (in-process)

**Assets at risk:**
- Tool execution authority (PII reads, treasury spend prep, etc.).
- Audit trail integrity.

**Attacker capability:**
- A misclassified or unclassified tool definition shipped to
  production.

| STRIDE | Threat | Control | Wave | Residual |
| --- | --- | --- | --- | --- |
| **S** | Tool runs without verified delegation. | `withDelegation` mandatory; production-default refuses to wrap unclassified tool. | **H1** | If a future tool is registered WITHOUT going through `withDelegation` at all, no gate fires. Mitigated by code review + `pnpm check:all` enforcing wrapper presence on MCP route registration. **PARTIAL: P2 — wrapper presence not yet enforced by lint.** |
| **T** | Modify the delegation token in flight. | JWT-style signature on the canonical claims; any byte change → signature recovery mismatch → reject. | (existing) | None — token is signed by the user's smart account or session key. |
| **R** | Caller denies tool invocation. | `mcp-runtime.with-delegation.{accept,reject}` audit row per call. Correlation-stitched via `correlationId`. | (existing) | Telemetry path is bounded-cardinality + safe for Prometheus. |
| **I** | Tool leaks PII the caller wasn't authorized for. | `tool-policy.evaluatePolicy` fail-closed shape gate; `DataScopeGrant` enforced at handler level. | **N8 close** | If a tool's classification is wrong (e.g., PII tool tagged low-risk), policy will permit. Mitigated by `lintMcpClassification` + classification review at registration. **PARTIAL: P2 — classification linter only suggests, doesn't fail CI.** |
| **D** | Flood `withDelegation` to exhaust JTI store. | `JtiStore.trackUsage` atomic + bounded; per-token usage cap; per-store size cap (sqlite + postgres). | (existing) | A unique-jti flood (each new jti consumes a row) hits storage limits. Mitigated by JTI store TTL — old rows expire. **P3 — operational, not a code finding.** |
| **E** | Use a quorum-required tool without quorum sigs. | `verifyDelegationToken` refuses caveat-presence as proof; requires explicit `quorumProof`. Off-chain mode stubbed (`quorum_off_chain_not_implemented`); on-chain mode passes through. | **H3** | Off-chain quorum is not yet implemented. PII / org-sensitive tools that need quorum must currently route through on-chain redemption OR remain at non-quorum tiers. **OPEN: P1 — off-chain quorum verification implementation (out-of-scope until spec'd).** |

---

## 5. Boundary D — AgentAccount ↔ EntryPoint ↔ Bundler

**Assets at risk:**
- Account control (the ability to mutate signer set / install modules
  / upgrade impl).
- Paymaster deposit (sponsored gas budget).

**Attacker capability:**
- A custodian of the account (signing authority via EOA or passkey).
- A bundler operator (relayer that submits userOps).

| STRIDE | Threat | Control | Wave | Residual |
| --- | --- | --- | --- | --- |
| **S** | A custodian forges admin actions outside the CustodyPolicy quorum. | `_requireForExecute` checks msg.sender ∈ {EntryPoint, self, DelegationManager}. `setDelegationManager`, `installModule`, `uninstallModule`, `upgradeToWithAuthorization` are `onlySelf` (factory-init exception for first install, one-shot). | **Wave 2A C-1/C-2/C-3** | None. 12 regression tests in `AuthorityClosureWave2A.t.sol`. |
| **T** | Mutate calldata between schedule and apply. | Quorum signatures bind to the canonical execution payload hash (chainId + enforcer + delegation hash + delegator + redeemer + target + value + keccak(callData)). | **Wave 2B C-4** | None. Replay across delegations / values / call data / targets / chains all blocked. 6 regression tests. |
| **R** | Account holder denies authorizing an upgrade. | `upgradeToWithAuthorization` body now `revert LegacyUpgradePathDisabled()`; upgrades require a self-call routed through CustodyPolicy.ApplySystemUpdate quorum + timelock. | **Wave 2A C-3** | None. |
| **I** | Leak the user's passkey credentialId via account state. | `credentialIdDigest` stored, not raw credentialId. PIA (passkey identity address) = keccak256(abi.encode(x, y))[12:32] — derivable from on-chain pubkey only. | (existing) | None. |
| **D** | Drain paymaster deposit by spamming deploys. | Paymaster verifying-signer mode (audit C2); demo-a2a signs every paymaster envelope. Per-account budget enforcement is the next layer. | (existing) | **OPEN: P1 — per-account / per-target sponsorship budgets.** Audit P1-4 in original audit. |
| **E** | A custodian elevates to sole authority. | T1-T5 quorum required for admin actions per `CustodyPolicy.defaultApprovals(N, t)`. T6 recovery requires trustee quorum, not custodian quorum. | **Wave 2C C-8** | None. ChangeApprovalsRequired tier-escalates on reductions. |

---

## 6. Boundary E — CustodyPolicy ↔ AgentAccount

**Assets at risk:**
- Account custody graph (custodian set, trustee set, recovery
  threshold, timelock per tier).

**Attacker capability:**
- A custodian or trustee with valid quorum.

| STRIDE | Threat | Control | Wave | Residual |
| --- | --- | --- | --- | --- |
| **S** | Use a stale module to install on a fresh-looking account. | `permanentlyUninstalled` flag; reinstall after uninstall reverts with `ReinstallForbidden(account)`. | **Wave 2C C-11** | None. |
| **T** | Hand-craft RotateAllCustodians with only adds, never removes. | New args shape `(address[] addCustodians, address[] removeCustodians)`; `CustodiansRemovedDuringRotation` event surfaces count. | **Wave 2C C-10** | None. |
| **R** | A trustee denies signing recovery. | EIP-712 `ScheduleCustodyChangeRequest` / `ApplyCustodyChangeRequest` — each trustee's signature is on the bound payload hash. Audit row per schedule/apply. | (existing) | **OPEN: CT-8** — `/session/custody-schedule` and `/session/custody-apply` in demo-a2a currently emit NO audit row (not even console). H5 task. |
| **I** | Reveal who the trustees are via on-chain state. | Trustees are on-chain custodians of the target account; this is intentionally public (recovery is a public ceremony). | — | Acceptable per spec 207. |
| **D** | Spam scheduleCustodyChange to fill changeId space. | uint256 changeId — never wraps in practice. Per-account scheduled-change counter; cancel path exists. | (existing) | None. |
| **E** | Use a recovery flow to install non-custodian as custodian without trustee quorum. | T6 timelock + trustee quorum required. SetRecoveryApprovals(0) rejected (cannot silently disable recovery via T4 admin). | **Wave 2C C-9** | None. |

---

## 7. Boundary F — Factory ↔ Account deploy

**Assets at risk:**
- The deterministic CREATE2 address mapping.
- The init-time custodian / trustee / passkey configuration.

**Attacker capability:**
- Any caller (the factory is permissionless).

| STRIDE | Threat | Control | Wave | Residual |
| --- | --- | --- | --- | --- |
| **S** | Front-run a deploy to deploy a different impl at the predicted address. | Salt + init data fully determine CREATE2 address; an attacker can deploy AT the same address but the bytecode they deploy is the SAME bytecode (the factory always uses `accountImplementation` as the proxy target). Net: front-running is a no-op. | (existing) | None. |
| **T** | Pass mode>0 with no trustees → recovery disabled at deploy. | `_validateInitParams` rejects mode>0 with `trustees.length == 0` (`TrusteesRequiredForRecoverableMode`). | **Wave R0** | None. |
| **R** | Account-holder denies asking for this deploy. | Factory call is permissionless and idempotent. The init data + salt are the auditable inputs. | (existing) | None — anyone can deploy ANY account, the question is who controls the resulting key set. |
| **I** | Leak custodian set via factory events. | `AgentAccountCreated` event is intentionally public; the custodian set is public on chain. | — | Acceptable. |
| **D** | Spam deploys to drain RPC. | Worker validation rejects malformed early; CORS + CSRF + rate limit (Boundary A) gate the path. | (existing) | Same residual as Boundary A. |
| **E** | Deploy at the wrong impl version via a hostile factory. | Factory address is itself a security parameter; consumer apps read it from `deployments-<network>.json`. | (existing) | Operator must trust the deploy script; preflight runs against deploy state. |

---

## 8. Boundary G — KMS ↔ key-custody

**Assets at risk:**
- Asymmetric signing keys (deployer EOA, paymaster verifying signer,
  per-tool executor keys).
- Symmetric envelope keys (session-data-key wrapping).
- HMAC secrets (service MAC).

**Attacker capability:**
- Cloud-platform IAM access (GCP / AWS) OR access to an operator's
  workstation OR a compromised worker.

| STRIDE | Threat | Control | Wave | Residual |
| --- | --- | --- | --- | --- |
| **S** | Reuse a session-data-key envelope across contexts. | AAD-bound (canonical context bytes). Encrypt/Decrypt MUST pass identical AAD. KMS EncryptionContext + AES-GCM AAD bound identically. | (existing) | None when implemented correctly; audit invariant. |
| **T** | Mutate envelope ciphertext. | AES-GCM tag binds plaintext + AAD. Tag mismatch on decrypt → throw. | (existing) | None. |
| **R** | Operator denies signing a tx. | `signA2AAction` emits audit row with hashed sessionId + toolId + actionId. Never raw sessionId. | (existing) | Audit must persist durably in production. **OPEN: P1 H5.** |
| **I** | Leak signing key via worker memory dump. | KMS holds private material; signing happens via REST call; worker holds only the access token at boot. | (existing) | Worker access tokens have TTL; rotation procedure should be documented. **OPEN: P2 KH-5.** |
| **D** | Exhaust KMS quota by signing flood. | Per-key quota at the cloud provider; preflight asserts production quota. | (existing) | Mitigated by JTI / rate limit upstream. |
| **E** | Use the master signer for unauthorized targets. | Master signer is for bundler / paymaster only. Tool execution uses per-tool executor signer (v0 falls back to master; v1 HKDF-derived). | (existing) | **OPEN: P2 — per-tool HKDF derivation not yet implemented (KH-4 in evidence checklist).** |

---

## 8.5. Boundary H — Naming (registry / resolver / Smart Agent owner)

**Phase status:** scaffolded Phase 1 (2026-05-23); contracts deploy in
NS Phase 3; cross-package integration lands NS Phase 2.

**Assets at risk:**
- Name → address forward records.
- Address → primary name reverse records.
- Per-name resolver records (`a2a-endpoint`, `mcp-endpoint`,
  `display-name`, `passkey-credential-digest`, `custody-policy`).
- Subname issuance authority for a subtree (e.g. `*.acme.agent`).

**Attacker capability:**
- Any chain caller (registry is permissionless for reads; writes
  require the owner Smart Agent's ERC-1271 signature).
- A custodian or trustee of the owning Smart Agent (subject to the
  agent's CustodyPolicy quorum).

| STRIDE | Threat | Control | Wave | Residual |
| --- | --- | --- | --- | --- |
| **S** | Squat a primary-name reverse record without owning the forward record. | Universal resolver enforces round-trip: `reverseResolve(agent)` returns `name` ONLY when `resolveName(name) === agent`. Documented as the security invariant in spec 215 § 10. | NS Phase 1 (SDK invariant; Phase 3 contract enforcement) | None when correctly implemented. Phase 3 Forge test required. |
| **T** | Mutate a name's records after registration without the owner's signature. | Resolver `setText / setAddr` calls go through the owner Smart Agent's `IERC1271.isValidSignature` (Phase 4). For mode>0 owners, this routes through CustodyPolicy quorum + timelock. | NS Phase 4 | None when implemented. **OPEN — NA-2** until then. |
| **R** | Owner denies authorizing a name rotation. | EIP-712 (Phase 4) signature recoverable to owner agent. Audit row `agent-naming.records.update` emitted with correlationId + actor. | NS Phase 4 + audit integration | **OPEN — NA-3** until Phase 2 audit hook lands. |
| **I** | Leak passkey credential id via resolver records. | Schema only allows `passkey-credential-digest` (a hash); raw `credentialId` not in any encoder. Encoder refuses unknown keys (fail-loud write); decoder drops them (fail-closed read). | NS Phase 1 | None. Verified by `packages/agent-naming/test/records.test.ts`. |
| **D** | Spam subname registrations to fill registry storage. | Phase 3 registry includes expiry + per-parent registration gating. Phase 4 worker direct-deploy path is rate-limited at the edge (shared with the other direct-deploy routes). | NS Phase 3 + Phase 4 | **OPEN — NA-4** rate-limit at the edge not enforced today. |
| **E** | Use a stale name → address record to phish a delegation. | Off-chain claims envelope (Phase 2) carries `delegateName` SIGNED alongside the delegation hash. The cryptographic primary key is the address. Name in claims is a display + signed mapping witness; the delegation can't be silently re-pointed. | NS Phase 2 | Name transfer between sign-time and redeem-time can still mislead a human reviewer if the UI doesn't show "name AT SIGNING TIME" vs "current name". Demo UI must surface this. **OPEN — NA-5** UX-side. |

### Naming-domain open findings (NA-*)

| ID | Severity | Finding | Maps to |
| --- | --- | --- | --- |
| **NA-1** | P2 | Phase 1 client write methods throw `NS Phase 4`; until that lands, demos that try to register a name will hit the throw + must handle it gracefully. | NS Phase 4. |
| **NA-2** | P2 | Resolver write authority enforcement is Phase 4 (Forge tests + Phase 4 wire). Until then, any deployed registry MUST reject non-owner calls; Phase 3 contract tests are the verification step. | NS Phase 3 + Phase 4. |
| **NA-3** | P2 | Audit hook for `agent-naming.records.update` / `register` / `primary-name.update` / `subregistry.update` is Phase 2 integration. | NS Phase 2. |
| **NA-4** | P3 | Per-IP rate limit at the worker / Cloudflare edge not yet wired for `/session/naming-register` (route doesn't exist yet either). Adds to CT-2-era rate-limit gap. | NS Phase 5 demo wiring. |
| **NA-5** | P3 | UX must distinguish "delegate name AT SIGNING TIME" from "current delegate name" when displaying a delegation card whose subject name has transferred. Otherwise a name transfer between sign and redeem can mislead a human reviewer. | NS Phase 5 demo wiring. |

---

## 9. System-wide assumptions

- **TLS** to Cloudflare is trusted. We do not protect against
  Cloudflare-internal compromise.
- **GCP-KMS** is trusted for key custody. Compromise of the GCP
  organization is out of scope.
- **Base Sepolia chain** state is trusted; we do not mitigate against
  L2 sequencer compromise.
- **Browser sandbox** is trusted; we do not protect against
  passkey export via OS-level malware.
- **The user's own choices** — picking a strong passkey provider,
  not pasting tokens into hostile pages — are out of scope.

---

## 10. Cross-cutting open threats (not boundary-specific)

| ID | Severity | Threat | Where it lives | Maps to |
| --- | --- | --- | --- | --- |
| **CT-1** | P0 | Disclosed deployer EOA controls live governance. | N1 in `product-readiness-audit.md` | OP-1 (preflight should block) + operator rotation. |
| **CT-2** | superseded | Older wording: "A2A audit is console-only". | Refined as **CT-8** below. | — |
| **CT-8** | P1 | demo-a2a is the primary signing / mint / direct-deploy / custody-relay service yet emits only to console — no D1 (or any durable) sink. Six call-sites have **zero audit emission anywhere** (not console either): direct-deploy, custody-schedule, custody-apply, paymaster topup, SIWE JWT mint, ERC-1271 reject on /session/package. Boundary B + E Repudiation rows below are unmet on the a2a side. | `apps/demo-a2a/src/index.ts:75-77` + zero-emission sites | OP-2 + OA-2 cross-references; drives H5 task. |
| **CT-9** | P2 | `generateServiceMac` accepts no audit sink; MAC issuance is structurally invisible from the issuing side (only verify-side emits). | `packages/mcp-runtime/src/service-mac.ts` | Lands alongside CT-8. |
| **CT-10** | P2 | Production preflight does not assert wrangler D1 binding presence — a future regression dropping the binding would silently revert to console-only. | `scripts/check-production-deploy.ts` | Regression test that keeps CT-8 closed. |
| **CT-11** | P3 | `composeSinks` swallows per-sink errors quietly; durable-sink failure rate is invisible at the metrics layer. | `packages/audit/src/index.ts:182-200` | Observability gap; wire into `MetricsSink`. |
| **CT-12** | P3 | `NODE_ENV` may default to "development" in Cloudflare Workers prod env if not explicitly set in `[env.production.vars]`. PII guardrail + several emitters key off `process.env.NODE_ENV`. | `apps/demo-{a2a,mcp}/wrangler.toml` | Re-verify production-env blocks. |
| **CT-13** | P2 | Agent-naming Phase 1 ships SDK skeleton; cross-package integration (audit / tool-policy / delegation / mcp-runtime / identity-auth) is Phase 2. Until Phase 2 lands, `NameContext` is defined in `types` but no package CONSUMES it — audit rows + policy decisions + delegation context lack name fields. Demo UIs can resolve + render names directly, but audit forensics + policy DSL still address-only. | `@agenticprimitives/types` `NameContext` exported; `audit.buildEvent`, `tool-policy.evaluatePolicy`, `delegation.mintDelegationToken` not yet updated. | Tracked as the NS Phase 2 task. Threat-model rows for naming (NA-*) added inline; full coverage lands when Phase 2 + Phase 4 close. |
| **CT-3** | P1 | Off-chain quorum signature verification not implemented; MCP-only PII/org-sensitive tools can't be promoted to quorum-required without on-chain redemption. | Wave H3 stub | OA-3. |
| **CT-4** | P1 | Third-party contract audit not yet run. | Gate 6 in `specs/214`. | EXT-* findings will land here. |
| **CT-5** | P2 | Per-account / per-target paymaster sponsorship budget not enforced; deposit drain DoS possible. | Original audit P1-4 | OP-3 partial. |
| **CT-6** | P2 | Per-tool KMS-key isolation (HKDF) not implemented; tool executor reuses master signer. | `key-custody/src/factories.ts:42` | KH-4. |
| **CT-7** | P3 | Stranded localStorage state on contract redeploy — visible UX cliff but no security risk. | demo-only | DS-1. |

---

## 11. Change log

| Date | Wave | What changed in this doc |
| --- | --- | --- |
| 2026-05-23 | H1-H4 | Boundary D updated for Wave 2A authority closures + Wave 2C custody hardening confirmed. Boundary C OA-2 / OA-3 marked closed (H1, H3). KH-1 closed for key-custody prod-default (H1). Added CT-2 (durable A2A audit) + CT-3 (off-chain quorum) + CT-4 (external contract audit). |
| 2026-05-23 | security-auditor run on H5 | CT-2 superseded by detailed **CT-8** (call-site-level inventory, including 6 zero-emission sites); added **CT-9** (`generateServiceMac` no issuing-side sink), **CT-10** (preflight binding-presence assertion), **CT-11** (`composeSinks` failure-rate metric), **CT-12** (NODE_ENV default-to-dev footgun). Boundary B + Boundary E Repudiation rows annotated with CT-8 reference. |
| 2026-05-23 | NS Phase 1 + ADR-0006 | Added **Boundary H** (naming attack surface) with NA-1..NA-5 open findings. Added **CT-13** (Phase 1 ships SDK skeleton; cross-package integration is Phase 2). Threat-model + evidence checklist reference the architecture-lock-in in ADR-0006 (refused: names-in-CREATE2, names-in-EIP-712, identity-auth auto-registration, every-package import, parallel RBAC on registry). |
| 2026-05-23 | NS lockdown (ADR-0007 + ADR-0008 + specs 216/217) | Three-package decomposition locked: agent-naming (shipped) + agent-identity (HCS-11 + HCS-14 + verification) + agent-relationships (edges + types). CAIP-10 `nativeId` predicate added to agent-naming records with grammar validation (NM-14 closed via code in same turn — 7 tests). UAID generation explicitly refused (NM-15 closed by absence). Cross-resolver interop achieved at low cost via the record predicate — third-party HCS-14 / ERC-8004 resolvers can route to our agents without us shipping UAID code. Refused: GoDaddy DNS-namespace model, X.509/SCITT PKI, HCS-10 inbox/outbox topology, HCS-15 petal accounts, HCS-16 Flora native ThresholdKey. Deferred to v2: agent-credentials, agent-skills, HCS-19 privacy compliance, AgentAssertion + AgentRelationshipResolver. |
| earlier | various | Initial threat model. |
