# Independent Security & Architecture Audit — All Packages

**Date:** 2026-06-09
**Auditors:** Three independent AI audit agents (security-auditor ×2, technical-architect-auditor ×1), synthesized by the coordinating agent. Each auditor read source directly and did NOT trust `AUDIT.md`/`CLAUDE.md` claims.
**Scope:** All 31 packages under `packages/` (TypeScript source). The Solidity contract layer (`packages/contracts/src/`) was reviewed only where TS↔Solidity consistency required it (EIP-712 typehashes, ABI parity, on-chain verification counterparts). **A dedicated full Solidity contract audit was descoped from this engagement** and remains an open gap — see §7.
**Method:** Full source read of every in-scope package `src/`; tests read only to assess coverage; dependency graph measured from `package.json` + actual import statements; ADR compliance (0012 no-getLogs, 0013 no-silent-fallbacks, 0021 generic packages) verified against code, not docs.

---

## 1. Executive summary

**Verdict: NOT production-ready.** One Critical authorization bypass in the delegation keystone (DEL-001) breaks the entire off-chain MCP/A2A enforcement model. Three High findings sit in the trust roots that other packages compose against (verifiable-credentials verifier fail-open, VC digest binding, agent-naming write-path normalization). Fixes are surgical, not architectural.

**The good news is structural.** The dependency graph is fully compliant — zero cycles, zero back-edges, zero deep imports across all 31 packages, verified against real import statements. ADR-0012 (no `eth_getLogs`) and ADR-0013 (no silent fallbacks) hold in code. EIP-712 typehashes and domains match the on-chain `DelegationManager` / `CustodyPolicy` byte-for-byte. The CI enforcement surface (boundary scans, ABI sync, typehash equality, storage layouts, API-surface snapshots, vocab/domain firewalls) is unusually rigorous. JWT/session, OIDC, CSRF, and KMS hygiene in the core packages are genuinely well done.

**The risk concentrates in four places:**

1. `delegation` — token verification never binds the presenter to the delegation's `delegate` (DEL-001, Critical).
2. `verifiable-credentials` — the only verifier is structural-only and fail-open; the EIP-712 digest trusts attacker-supplied domain fields (VC-1/VC-2, High). Four other packages compose against this trust root.
3. `agent-naming` — the registration write path skips normalization, opening homoglyph/case squatting of `.agent` names (AN-1, High).
4. Audit-dossier honesty — seven `AUDIT.md` files claim "STUB, no code" over shipped, in one case security-load-bearing, code (ARCH-1, High).

### Top-priority remediation order

| # | Finding | Package | Severity |
| --- | --- | --- | --- |
| 1 | DEL-001 session-key↔delegate binding | delegation | **Critical** |
| 2 | VC-1 fail-open verifier | verifiable-credentials | High |
| 3 | VC-2 digest binds attacker-supplied `verifyingContract` | verifiable-credentials | High |
| 4 | AN-1 un-normalized registration labels | agent-naming | High |
| 5 | ARCH-1 false "STUB" AUDIT.md files | 7 packages | High (process) |

---

## 2. Critical finding (production blocker)

### DEL-001 — `verifyDelegationToken` never binds the session key to the delegation's `delegate`

**Severity: Critical** · `packages/delegation/src/token.ts:464-477` (verify), `:188-198` (mint claims)

`verifyDelegationToken` recovers the EIP-191 signer of the canonical claims and asserts `recovered === claims.sessionKeyAddress`, then validates the delegation via on-chain `isRevoked` + ERC-1271 `isValidSignature(hashDelegation(claims.delegation), claims.delegation.signature)`. ERC-1271 only proves *the delegator signed this delegation* — it says nothing about who presents it. The delegation's `delegate` field (the address actually authorized) is **never compared to `sessionKeyAddress`**. The off-chain `DELEGATE_BINDING` caveat is inert (`evaluator.ts:124-175` → `inertWhenAllowed`), and `MCP_TOOL_SCOPE` doesn't bind it either.

**Exploit:** The full signed `Delegation` struct travels in cleartext inside every token (`base64url(claims).sig`). Anyone who observes one token — a malicious/compromised MCP server, a log line, a network observer — extracts `claims.delegation` and re-mints a fresh token with their own session key, fresh `jti`, arbitrary `exp`, and the public `aud`. Verification passes; `verifyDelegationToken` returns `{ principal: delegator }`. Result: **permanent, unbounded impersonation of the delegator** for every off-chain MCP/data tool inside the delegation's caveat scope, defeating TTL, usage-limit, and original-token revocation. This is exactly the gate `mcp-runtime.withDelegation` relies on for data tools that never reach an on-chain redeem. It also makes JTI replay protection moot (attacker mints fresh `jti`s at will).

**Fix:** After recovering the session key, require `claims.delegation.delegate.toLowerCase() === recovered.toLowerCase()`; reject otherwise. Add a regression test asserting `delegate === sessionKeyAddress` as a load-bearing invariant. *Remediation pending.*

---

## 3. High findings

### VC-1 — Verifier is fail-open: `verifyCredentialStructural` never verifies the issuer signature

**Severity: High** · `packages/verifiable-credentials/src/verifier.ts:42-127`

The only verification function performs structural checks and returns `{ structural, expectedDigest, proofValue, issuerCaip10 }`, delegating the actual ERC-1271 check to the consumer. The function is named `verifyCredential*` and returns `structural: true` for a credential whose `proofValue` is **never checked against `expectedDigest`**. The `verifyCredential(vc, publicClient)` export promised in the package's CLAUDE.md does not exist. Additionally `proof.credentialHash` is only checked *if present* (`verifier.ts:101`) — a forger simply omits it.

**Blast radius:** `content-primitives` (entitlements), `agent-skills`, `geo-features`, and `related-agents` all compose against this trust root. Any consumer gating on `structural === true` accepts forged credentials.

**Fix:** Ship the real `verifyCredential` performing the ERC-1271 round-trip (`isValidSignatureNow(issuerSA, expectedDigest, proofValue)`); rename the structural helper to make its partiality unmistakable; make `credentialHash` mandatory. *Remediation pending.*

### VC-2 — `eip712Digest` trusts proof-supplied `verifyingContract`/`chainId`/`issuer` with no binding to the resolved issuer SA

**Severity: High** · `packages/verifiable-credentials/src/verifier.ts:107-117`, `src/proof.ts:55-81`

The digest is recomputed from `proof.eip712Domain.chainId` and `proof.eip712Domain.verifyingContract` — both attacker-controlled, inside the proof object. Nothing asserts `verifyingContract == issuer SA` or `issuerCaip10 == vc.issuer`. An attacker signs the digest against a contract they control and the verifier computes a "matching" digest.

**Fix:** Assert `eip712Domain.verifyingContract` and the `verificationMethod` address resolve to the same SA as `vc.issuer`, and that `chainId` is the expected chain. *Remediation pending.*

### AN-1 — `registerSubname` write path accepts un-normalized labels → homoglyph & case spoofing of `.agent` names

**Severity: High** · `packages/agent-naming/src/custody.ts:43-66, 272-286`, `src/client.ts:217-236`; on-chain `packages/contracts/src/naming/AgentNameRegistry.sol:225-256`

Normalization is enforced only on the read/derive path (`namehash()`/`normalizeAgentName()`). The write path passes `input.label` straight through, and the contract hashes raw bytes (`keccak256(bytes(label))`) with no charset check. `аdmin.agent` (Cyrillic а), `Admin.agent`, or `admin\u200b.agent` all register as distinct nodes whose stored raw labels render indistinguishably from the real name via `reverseResolveString`.

**Fix:** Normalize + reject non-conforming labels in `buildRegisterSubnameCall`/`registerSubname`/`buildSubregistryRegisterCall`; ideally enforce `[a-z0-9-]` on-chain in `register`. *Remediation pending.*

### ARCH-1 — Seven AUDIT.md files claim "STUB. No code yet" over shipped code

**Severity: High (process/dossier integrity)** · `packages/{attestations,agreements,fulfillment,payments,intent-marketplace,intent-resolver,verifiable-credentials}/AUDIT.md`

Each states "Status: STUB. No code yet" while `src/` ships 39–785 lines. Worst: `verifiable-credentials` (785 lines including the EIP-712 credential verifier, marked publishable). Spec 214's premise is a complete evidence trail; a reviewer relying on these files skips live attack surface — which is exactly where VC-1/VC-2 live.

**Fix:** Rewrite the seven AUDIT.md files against actual invariants; add a CI check failing when `AUDIT.md` contains "STUB" while `src/` is non-trivial. *Remediation pending.*

---

## 4. Medium findings

| ID | Package | Finding | Evidence |
| --- | --- | --- | --- |
| KC-001 | delegation (session-manager) | `SessionManager.resolve` returns the raw session private key as a first-class result field alongside the `signMessage` closure that already encapsulates it; any logging/serialization of the result leaks a token-forging key. Drop `privateKey` from `SessionResolveResult`. | `packages/delegation/src/session-manager.ts:265-303` |
| CA-001 | connect-auth | SIWE replay protection is caller-optional: nonce only checked when `expectedNonce` supplied; no one-shot consumption anywhere. A captured signature replays within the validity window against integrations that forgot the param. Make it mandatory or ship a nonce-store-backed variant. | `packages/connect-auth/src/methods/siwe.ts:152-183, 238-256` |
| CN-1 | connect | `verifyAgentSession` makes `expectedAud` mandatory but `expectedIss` optional; `kid` is random and not issuer-bound, so multi-IdP relying sites can accept a token from the wrong issuer. Make `expectedIss` mandatory. | `packages/connect/src/token.ts:113-178` |
| AN-2 | agent-naming | `displayName`/`a2aEndpoint`/`mcpEndpoint`/`metadataUri` written with zero validation (arbitrary Unicode, RTL-override, `javascript:` URLs). Validate `https:` and strip bidi/zero-width. | `packages/agent-naming/src/records.ts:117-119`, `src/custody.ts:233-235` |
| FED-1 | fedcm-idp | `Sec-Fetch-Dest: webidentity` CSRF gate is an optional helper apps must remember to call; no nonce replay store; assertion builder doesn't bind origin/nonce freshness. Fail-closed it inside `parseAssertionRequest`. | `packages/fedcm-idp/src/index.ts:176-181, 195-235` |
| ARCH-2 | doctrine docs | Boundary doctrine + consumer map cover 16 of 31 packages; the spine wave (attestations, agreements, payments, intent-*, VC, skills, geo, etc.) exists only in package.json, violating "specs precede code." | `specs/100-package-boundary-doctrine.md` §4, `docs/architecture/package-consumer-map.md` |
| ARCH-3 | contracts scripts | ADR-0021 vertical leakage: `.impact` TLD provisioned "on every deploy" + `impact-agent.me` references; the domain firewall only scans `packages/*/src/**/*.ts(x)` so Solidity + `script/` are structurally invisible to it. | `packages/contracts/script/Deploy.s.sol:380-401`, `script/AddImpactTld.s.sol`, `scripts/check-no-domain-in-packages.ts` |
| ARCH-4 | CI/doctrine | Context budgets stated in lines (CLAUDE.md ≤60, AUDIT.md ≤150) but CI checks self-adjustable per-package *word* budgets and never checks AUDIT.md; 21/31 CLAUDE.md exceed the stated limit (worst 180 lines); `contracts/AUDIT.md` is 324 lines. | `scripts/check-claude-context-budget.ts` |
| ARCH-5 | dependency truth | Phantom dependency edges: `delegation` declares `agent-account` + `connect-auth` (never imported), `mcp-runtime` declares `key-custody` (unused), spine packages declare deps they don't import. Nothing reconciles package.json ↔ manifest ↔ source. | `packages/delegation/package.json` et al., `scripts/check-dependency-graph.ts` |
| ARCH-6 | identity-directory-adapters | Production IndexerPort doesn't exist — only the in-memory adapter ships; ADR-0030 routes all discovery through an indexer and ADR-0012 forbids the log-scan alternative, so production discovery has no leg to stand on. | `packages/identity-directory-adapters/src/indexer.ts:1-7` |

---

## 5. Low / informational findings

| ID | Package | Finding | Evidence |
| --- | --- | --- | --- |
| DEL-002 | delegation | Exported `isRevoked`/`revokeDelegation` are throwing stubs (the ADR-0013 "public symbol lies about capability" anti-pattern); real revocation reads exist inline in `token.ts:491-509`. | `packages/delegation/src/onchain.ts:7-20` |
| DEL-003 | delegation | `decodeToken` doesn't validate claim field types; malformed `sessionKeyAddress` throws an unstructured `TypeError` out of the auth hot path instead of a clean opaque reject. | `packages/delegation/src/token.ts:389-410, 475` |
| KC-002 | delegation | Hardcoded `keyId: 'local-master'` passed to `decryptSessionDataKey` regardless of backend; latent coupling + forensics mislabeling. | `packages/delegation/src/session-manager.ts:202-204, 251-256` |
| KC-003 | key-custody | AAD canonicalization percent-encodes values but not keys; a future caller-supplied key containing `;`/`=` could collide two AAD contexts. | `packages/key-custody/src/aad.ts:7-19` |
| CA-002 | connect-auth | SIWE `chainId` parsed via `Number()` with no `NaN` check; no `uri` binding. | `packages/connect-auth/src/methods/siwe.ts:102` |
| CA-003 | connect-auth | No off-chain WebAuthn ceremony verification (challenge/origin/rpId/UV) and no `signCount` regression tracking; mitigated because the on-chain path (`AgentAccount.sol:1216-1233` + `WebAuthnLib` with `requireUv=true`) does verify — but document that off-chain consumers get nothing. | `packages/connect-auth/src/methods/passkey.ts:119-151, 245-259` |
| AA-001 | agent-account | `ADMIN_VERB_EXECUTE` constant truncated to 12 bytes ("ADMIN_EXECUT"); `computeAdminPayloadHash` recomputes correctly so SDK hashing is right, but a consumer importing the constant builds a wrong digest (fail-closed). | `packages/agent-account/src/quorum.ts:100` |
| MR-001 | mcp-runtime | `withDelegation` calls `evaluatePolicy` with a synthesized placeholder delegation (`delegate = delegator`, empty caveats); benign today, a landmine for any future caveat-inspecting policy rule. | `packages/mcp-runtime/src/with-delegation.ts:391-401, 602-612` |
| MR-002 | mcp-runtime | JTI stores: sqlite/pg upserts are correctly atomic; memory store non-atomic but production-gated. Moot until DEL-001 is fixed. | `packages/mcp-runtime/src/jti-stores.ts:95-178` |
| VC-3 | verifiable-credentials | `viemSignerFromWallet` uses `eth_sign` over a raw EIP-712 digest (blind-signing foot-gun; EOA-only path in an SA/ERC-1271 stack). | `packages/verifiable-credentials/src/proof.ts:132-150` |
| ID-1 | identity-directory | Name resolutions get `assurance: 'onchain-read'` without the forward/reverse round-trip the naming package advertises as squat protection; combined with AN-1 a squatted name earns a trusted tier. | `packages/identity-directory/src/directory.ts:86-98` |
| CP-1 | content-primitives | `evaluateEntitlement` trusts the caller's pre-verified VC — internally consistent, but the chain depends on VC-1 being closed. Merkle implementation (double-hashed leaves, sorted pairs) is sound. | `packages/content-primitives/src/entitlement.ts:23-46` |
| PAY-1 | payments | Advertised mandate signing/verification not implemented; `PaymentMandate.signature` is unverified; `computeMandateId` omits amount/payee — fine as a lookup key, dangerous if treated as a replay nullifier. | `packages/payments/src/index.ts` (127 lines) |
| IM-1 | intent-marketplace | `computeTopicSimilarity` returns `1.0` for empty topics — fail-open perfect match. Impact limited to match quality (no authority transfer). | `packages/intent-marketplace/src/index.ts:152-171` |
| GEN-1 | skills/geo/agreements/attestations | Hand-rolled `writeHex32` packing pads/truncates bad-length hex silently instead of rejecting → silently-wrong digests on malformed input. Validate `^0x[0-9a-fA-F]{64}$` or use `encodeAbiParameters`. | `packages/agent-skills/src/index.ts:285-300` et al. |
| ARCH-7 | connect-auth | `verifyUserSignature` silently downgrades to the view-only path when the client lacks `simulateContract` (ERC-6492 counterfactuals then return `invalid`). Fail-closed, but a two-mechanism auth path contra ADR-0013; return `reason: 'config'` instead. | `packages/connect-auth/src/verify-signature.ts:159-161` |
| ARCH-8 | docs | Root `CLAUDE.md` routes contract work to nonexistent `apps/contracts/*`; contracts live at `packages/contracts/`. | `CLAUDE.md:11,16` |
| ARCH-9 | docs | Vocabulary map claims "eight on-chain enforcers"; 6 exist in `src/enforcers/` and 6 in `deployments-base-sepolia.json`. | `docs/architecture/vocabulary-map.md` |
| ARCH-10 | contracts | `AgentAccount.sol` is "modular" (1,495 lines), not "thin": CustodyPolicy module + hooks satisfy the doctrine's substance, but WebAuthn validation, custodian set, pause, and upgrade machinery are inlined. Defensible (root credential non-uninstallable) — document the divergence in spec 209. | `packages/contracts/src/AgentAccount.sol` |
| ARCH-11 | related-agents | Imports `Address`/`Hex` via `delegation`'s re-exports instead of `types`. | `packages/related-agents/src/index.ts:33-34` |
| AUD-info | audit | `generateEventId` falls back to `Math.random` absent WebCrypto — fine for IDs, documented. | `packages/audit/src/index.ts` |

---

## 6. Per-package verdicts

| Package | Verdict | Maturity |
| --- | --- | --- |
| delegation | Strong design; ships the one Critical (DEL-001). **Blocker.** | live, keystone |
| key-custody | Solid: fail-closed KMS, low-s, AAD trip-wire, production guards, master-signer footgun removed. | live |
| connect-auth | JWT/CSRF/OIDC genuinely well done; tighten SIWE nonce (CA-001). | live |
| account-custody | Clean arg-builders; EIP-712 matches on-chain. No findings. | live |
| agent-account | Sound wire-format helpers; fix AA-001 constant. | live |
| mcp-runtime | Good production gates, opaque errors, atomic JTI stores; inherits DEL-001 blast radius. | live |
| tool-policy | Deterministic, fail-closed, byte-exact calldata matching. No findings. | live |
| audit | Clean schema, fail-soft/fail-hard split, PII guardrail sink. No findings. | live |
| types | Branded aliases only. No findings. | live |
| connect | Strong token core (alg-pinned, bound-id-token replay defense); pin `iss` (CN-1). | live |
| agent-naming | Read path correct; **write path skips normalization (AN-1)**; records unvalidated (AN-2). | live |
| agent-profile | Canonical-JSON content-hash enforced; ABI parity confirmed; endpoint verification honestly stubbed. | foundational |
| agent-relationships | Edge-id derivation matches contract; self-edge rejected. No issues. | live |
| identity-directory | Authoritative on-chain confirm, no fallback/getLogs; assurance tier slightly generous (ID-1). | live |
| identity-directory-adapters | Clean ports; production indexer missing (ARCH-6). | live (in-mem only) |
| verifiable-credentials | Real crypto but **fail-open verifier (VC-1) + digest binding gap (VC-2)**. Highest-priority fixes after DEL-001. | load-bearing, mislabeled stub |
| content-primitives | Merkle + domain separation correct; safe iff VC-1 fixed. | foundational |
| agent-skills / geo-features | Digest math sound; hex-validation gap (GEN-1). | foundational |
| agreements / attestations | Typehash math mirrors contracts (test-locked); signing helpers absent (stubs). | stubs (helpers only) |
| payments | Type stub; no signing/verification (PAY-1). | stub |
| intent-marketplace / intent-resolver | Typed stub / skeleton; matcher fail-open (IM-1). | stubs |
| fulfillment | Type/state-machine stub; transitions well-formed. | stub |
| fedcm-idp / fedcm-rp | Correct pure builders; app-enforced CSRF + no nonce store (FED-1). | draft (`private:true`) |
| browser-identity | Clean generic selector, SSR-safe. No issues. | thin seam |
| related-agents | Private-by-default, composes VC+delegation cleanly; fix import source (ARCH-11). | foundational |
| ontology | Declarative constants + loader; no auth logic. No issues. | declarative |
| contracts (TS pkg) | Audited only for TS↔Solidity parity (clean). Full Solidity audit descoped — see §7. | live |

---

## 7. Architecture & dependency-graph compliance (measured)

- Internal deps extracted from all 31 `package.json` files; every `packages/*/src` grepped for actual `@agenticprimitives/*` imports; 10 suspicious edges manually disambiguated (all comment-only). **Result: zero cycles, zero back-edges, zero deep imports.** Facet siblings don't import each other; `account-custody` is a leaf per spec 213; `identity-directory-adapters → agent-naming` is the documented exception.
- `pnpm check:all` passes end-to-end including ABI sync, EIP-712 TS↔Solidity typehash equality, storage layouts, API-surface snapshots, vocab/domain firewalls.
- No `eth_getLogs`/`watchContractEvent` in any package read path (ADR-0012 clean). No faith vocabulary or hostnames in package TS source (ADR-0021 clean in TS; ARCH-3 gap is Solidity/script scope).
- EIP-712 spot-checks verified consistent: `DELEGATION_EIP712_TYPES` ↔ `DelegationManager.sol:80-87,130-132`; custody typed-data ↔ `CustodyPolicy.sol:117-131`; admin payload hash field ordering ↔ on-chain tuple.
- ~~Descoped: the dedicated Solidity contract security audit~~ **Completed same day** — see [`2026-06-09-independent-contracts-audit.md`](./2026-06-09-independent-contracts-audit.md). Headline: SC-1 (Critical, AgreementRegistry signature binding), SC-2 (High, attestation subject spoofing); on-chain DelegationManager redemption correctly binds delegate to `msg.sender`, so DEL-001 is NOT mirrored on-chain.

## 8. Genuine strengths

- Source-scanning boundary CI (`check:package-boundaries`) validating real imports — rare in practice.
- Typehash-equality + ABI-sync checks killing TS↔Solidity drift at CI time.
- Authoritative-port / no-fallback discipline in `identity-directory`; fail-closed `rpc`-vs-`invalid` separation in signature verification.
- key-custody's removal of the master-signer footgun with an explicit production refusal.
- Fail-closed caveat evaluator, constant-time HMAC, PKCE+state+nonce+RS256-pinned OIDC, origin-bound CSRF.
- JCS canonicalization in verifiable-credentials looks RFC-8785-correct; merkle leaves double-hashed with OZ-compatible sorted pairs.

## 9. Test posture summary

- **delegation** (~10 files): good caveat/hash/token coverage; **no test asserts session-key↔delegate binding** — DEL-001 is exactly an untested invariant.
- **key-custody** (~11): strong (DER/low-s, AAD, production guards). Add a no-raw-privkey-leak test.
- **connect-auth** (~8): JWT/CSRF/OIDC well covered; SIWE replay path under-tested.
- **account-custody** (3): builder validation covered; light on struct-hash parity vs Solidity.
- **agent-account** (~8): decent; nothing catches the AA-001 constant drift.
- **mcp-runtime** (3): thin for its central role; add concurrent-writer JTI + info-leak tests.
- **tool-policy** (6): good golden-table coverage. **audit** (1): light. **types** (0): acceptable.
- Non-core packages: typehash-parity tests are the strength; input-validation and verifier-roundtrip tests are the gap.

## 10. Remediation backlog (prioritized)

- [ ] **P0** DEL-001: bind `delegate === sessionKeyAddress` in `verifyDelegationToken` + regression test
- [ ] **P0** VC-1: ship real `verifyCredential` with ERC-1271 round-trip; rename structural helper; mandatory `credentialHash`
- [ ] **P0** VC-2: pin `verifyingContract`/`chainId`/issuer binding in the VC verifier
- [ ] **P1** AN-1: normalize labels on the registration write path (+ on-chain charset check)
- [ ] **P1** ARCH-1: rewrite 7 false-"STUB" AUDIT.md files + CI guard
- [ ] **P1** KC-001: drop raw `privateKey` from `SessionResolveResult`
- [ ] **P1** CA-001: mandatory SIWE `expectedNonce` / nonce-store variant
- [ ] **P1** CN-1: mandatory `expectedIss` in `verifyAgentSession`
- [x] **P1** Full Solidity contract audit — done: [`2026-06-09-independent-contracts-audit.md`](./2026-06-09-independent-contracts-audit.md) (adds SC-1 Critical, SC-2 High to the P0 queue)
- [ ] **P2** ARCH-2/3/4/5: doctrine coverage to 31 packages; extend domain firewall to `.sol`+`script/`; reconcile the three dependency-truth sources; enforce stated context budgets
- [ ] **P2** ARCH-6: production IndexerPort backend
- [ ] **P2** AN-2, FED-1, AA-001, MR-001, DEL-002/003, GEN-1, ID-1, VC-3, ARCH-7/8/9/11 (per tables above)

---

*Findings are evidence-based (file + line cited per finding). No code was patched as part of this audit; every finding is remediation-pending per the auditor charter. Source subagent reports: critical-package security audit, non-core package security audit, technical architecture audit (2026-06-09).*
