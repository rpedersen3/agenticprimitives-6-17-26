# Independent Security Audit — Ethereum Contracts (`packages/contracts/src`)

**Date:** 2026-06-09
**Auditor:** Independent AI security-audit agent (full source read; findings only, no patches).
**Scope:** Every Solidity contract under `packages/contracts/src/` — AgentAccount, AgentAccountFactory, SmartAgentPaymaster, UniversalSignatureValidator, custody/CustodyPolicy, agency/DelegationManager + enforcers (CallDataHash, Value, AllowedMethods, Timestamp, Quorum, AllowedTargets), naming (AgentNameRegistry, UniversalResolver, PermissionlessSubregistry), relationships, attestation, agreement, content, skills, geo, ontology registries, and the WebAuthn/P256/MultiSend libraries — plus deploy scripts under `packages/contracts/script/` for deployment-security issues. Test files reviewed only to assess invariant coverage.
**Companion report:** [`2026-06-09-independent-package-audit.md`](./2026-06-09-independent-package-audit.md) (all 31 TS packages). This audit closes the contract-layer gap flagged in that report's §7.

---

## 1. Executive summary

**Verdict: NOT production-ready in current state.** The core account / delegation / custody / paymaster stack is generally well-hardened — strong pause wiring, nonce/domain separation in critical signature paths, non-reentrancy on the redeem/execute path, `onlySelf` gating for sensitive mutations, and explicit delegate binding in redemption. The blockers are **two trust-binding flaws in the agreement/attestation substrate** (caller-supplied digests not bound to record contents), a fail-open no-code-enforcer case in the delegation view verifier, and **two deployment gaps** that leave critical authority on a single deployer key.

**Important negative result (good news):** the on-chain `DelegationManager` redemption path **does** bind the leaf delegate to the redeemer (`msg.sender` check, `DelegationManager.sol:413-417`). The Critical off-chain finding DEL-001 (session key not bound to `delegate` in the TS token verifier) is **not mirrored on-chain** — the gap is confined to the off-chain verification path.

### Findings overview

| ID | Severity | Title |
| --- | --- | --- |
| SC-1 | **Critical** | Agreement issuer signature not bound to agreement contents |
| SC-2 | High | Association attestation allows subject spoofing |
| SC-3 | Medium | View verifier `verifyAuthorizationForCall` fails open for no-code enforcers |
| SC-4 | Medium | `.impact` TLD root ownership assigned to deployer key |
| SC-5 | Medium | Paymaster deploy defaults governance/owner to deployer |

---

## 2. Findings

### SC-1 — Agreement issuer signature is not bound to agreement contents

**Severity: Critical** · `packages/contracts/src/agreement/AgreementRegistry.sol:156-159, 89-100`

`register()` verifies `issuerSignature` only against the **caller-supplied** `attestationStructHash`; it never recomputes or enforces a binding between that hash and `agreementCommitment` / `schemaHash` / the contract's signing domain.

**Exploit:** An attacker obtains any valid issuer signature over an arbitrary digest `X` (from any context), sets `attestationStructHash = X`, and registers an attacker-chosen commitment as if issuer-backed. Downstream systems trusting on-chain issuer provenance of agreement rows are misled.

**Fix:** Recompute a canonical typed-data digest on-chain (binding at least `agreementCommitment`, `schemaHash`, `issuer`, `chainId`, `verifyingContract`) and verify the signature only over that digest; reject caller-supplied free-form hashes. *Remediation pending.*

### SC-2 — Association attestation allows subject spoofing

**Severity: High** · `packages/contracts/src/attestation/AttestationRegistry.sol:141-154, 160-173, 291-319`

`assertAssociation()` only checks the issuer signature over `credentialHash`; `subject` is caller-supplied and not cryptographically bound to the issuer signature or any holder signature.

**Exploit:** Once an issuer-signed credential hash becomes known (it travels publicly), an attacker anchors it on-chain to a **different** `subject`, creating a misleading issuer-backed association for the wrong party.

**Fix:** Require the signature to cover a typed struct binding at least `subject`, `issuer`, `schemaId`, `credentialType`, `credentialHash`, `chainId`, `verifyingContract`; optionally require a subject co-signature for unilateral association assertions. *Remediation pending.*

### SC-3 — View verifier `verifyAuthorizationForCall` fails open for no-code enforcers (asymmetric with live redemption)

**Severity: Medium** · `packages/contracts/src/agency/DelegationManager.sol:314-334` (raw `staticcall` at `:320`); incorrect doc claim at `:285-293`

*(Corrected after coordinator spot-check.)* Live redemption (`_runBeforeHooks`, `:441-452`) uses a **high-level** call to a void-returning hook, so solc 0.8's extcodesize check makes a no-code enforcer **revert** — redemption fails closed. But the view verifier `verifyAuthorizationForCall` evaluates each caveat via raw `staticcall` (`:320`); a staticcall to a no-code address **returns success**, so `passed = true` and the verifier can return `(true, "")` for a delegation whose caveat enforcer doesn't exist. The NatSpec at `:292-293` ("an unknown/no-code enforcer is a no-op here just as it is in redemption") is wrong about redemption and documents the fail-open as intended symmetry.

**Exploit:** Any on-chain or off-chain consumer (spec 249 / RW1-4 callers) that authorizes based on `verifyAuthorizationForCall == true` treats a delegation as constraint-checked when a typoed/undeployed enforcer address means the caveat constrains nothing. The doc explicitly markets `true` as "a genuine authorization guarantee for this exact call" — it isn't in this case.

**Fix:** In the view path, require `d.caveats[j].enforcer.code.length > 0` and return `(false, "no-code-enforcer")` otherwise; correct the NatSpec. Optionally also add the explicit code check in `_runBeforeHooks`/`_runAfterHooks` so the fail-closed behavior is intentional rather than a compiler artifact. *Remediation pending.*

### SC-4 — `.impact` TLD root ownership assigned to deployer key in the main deploy path

**Severity: Medium** · `packages/contracts/script/Deploy.s.sol:385-393, 401-402`

The `.impact` root is initialized with `rootOwner = deployer` rather than a resolved governance/authority role, leaving naming-root control on a hot deployer EOA. (Also an ADR-0021 vertical-leakage concern — see ARCH-3 in the companion report.)

**Exploit:** Compromise or loss of the deployer key gives unauthorized control of the production naming surface — subregistry reassignment, ownership changes, squatting.

**Fix:** Assign the root owner to the governance-controlled role (parity with `.agent`) and assert post-deploy ownership in the script/tests. *Remediation pending.*

### SC-5 — Incremental paymaster deploy defaults governance/owner to deployer

**Severity: Medium** · `packages/contracts/script/DeployPaymaster.s.sol:46, 68-73`

If `GOVERNANCE` is unset the script silently uses the deployer as governance; the constructor owner is also the deployer.

**Exploit:** A production misconfiguration leaves paymaster policy control (`setDevMode`, allowlist/signer management, deposit) on one hot key — drain/grief risk.

**Fix:** Require explicit non-EOA governance/owner env vars on non-testnet deployments; fail hard if missing. *Remediation pending.*

---

## 3. Positive findings

- **Delegate binding on-chain is correct:** leaf delegate must equal `msg.sender` at redemption (`DelegationManager.sol:413-417`) — the off-chain DEL-001 class does not exist in live redemption logic.
- `onlySelf` gating on sensitive account mutations; non-reentrancy on the delegation redeem + execute path.
- Explicit chain/contract binding in the major signature domains (custody, delegation, admin payloads).
- Strong pause wiring across the account, custody, naming, and enforcer surfaces.

## 4. Test / verification posture

- **Strong breadth:** 61 Foundry test files; dedicated invariant suites for custody/delegation/paymaster (`packages/contracts/test/invariant/`), Halmos symbolic proofs (`test/halmos/*.halmos.t.sol` — WebAuthn UV/UP, onlySelf closure), Echidna (`test/echidna/`), and Medusa (`test/medusa/`) with committed configs.
- **Well-covered:** custody threshold/mode invariants, delegation revocation monotonicity, paymaster governance gating.
- **Gaps:**
  - No invariant/property coverage asserting issuer-signature **binding completeness** in `AgreementRegistry.register()` and `AttestationRegistry.assertAssociation()` — existing tests validate present (weak) behavior, which is how SC-1/SC-2 survived.
  - No deploy-script assertion enforcing `.impact` ownership authority parity with `.agent`.

## 5. Remediation backlog (prioritized)

- [ ] **P0** SC-1: bind issuer signature to agreement contents on-chain + property test
- [ ] **P0** SC-2: bind `subject` (and schema/type/domain) into the attestation signature + property test
- [ ] **P1** SC-3: fail closed on no-code enforcers in `verifyAuthorizationForCall` + fix NatSpec
- [ ] **P1** SC-4: governance-owned `.impact` root + post-deploy ownership assertion
- [ ] **P1** SC-5: mandatory explicit governance/owner on non-testnet paymaster deploys

---

*Findings are evidence-based (file + line per finding). No code was patched as part of this audit; every finding is remediation-pending per the auditor charter.*
