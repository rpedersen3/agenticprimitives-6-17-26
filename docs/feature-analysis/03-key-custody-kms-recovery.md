# 03 — Key custody, KMS, MPC & recovery

**Focus area:** key holding, signing policy, HSM/KMS/MPC controls, enclave signing, account recovery, trustees/guardians.
**AP packages in scope:** `key-custody`, `account-custody`, `contracts` (`CustodyPolicy.sol`, `WebAuthnLib`, `SignatureSlotRecovery`).
**AP capability today:** custody-policy module with tier-graded approvals (T1–T6) + safety delays; trustee/guardian quorums; multi-credential self-recovery; credential rotation as a custody operation that never changes the SA address (ADR-0011); passkey/WebAuthn on-chain verification.
**Known production gap (from contract audits):** production KMS/HSM-backed per-subject derivation + session signing is not finished; local signer/envelope paths must be blocked in production. This is the **P0** custody gap.

> Gap layers: `[Contracts]` Solidity surface · `[SDK]` TS packages/backends · `[UX]` product surface (**deferred**). See [index](index.md#gap-layers-every-gap-is-classified-into-exactly-one).

---

## Category verdict at a glance

| Product | Type | Tags | Verdict |
| --- | --- | --- | --- |
| Turnkey | Commercial | CUSTODY WALLET POLICY DELEG RECOVERY | **Integrate** (gold-standard backend candidate) |
| Fireblocks | Commercial | CUSTODY POLICY TREASURY PAY | **Integrate** (institutional benchmark) |
| Lit Protocol | OSS/network | CUSTODY DELEG POLICY VAULT MCP | **Integrate** (TEE-attested action signing) |
| DFNS | Commercial | CUSTODY WALLET POLICY | Track / integrate option |
| AWS KMS / CloudHSM | Cloud | CUSTODY POLICY AUDIT | **Integrate** (production backend) |
| Google Cloud KMS / Cloud HSM | Cloud | CUSTODY POLICY AUDIT | **Integrate** (primary backend) |
| Azure Key Vault / Managed HSM | Cloud | CUSTODY POLICY AUDIT | Integrate (MS-heavy deployments) |
| HashiCorp Vault | OSS/commercial | CUSTODY POLICY AUDIT | Integrate (self-host session enc + audit sink) |
| OpenBao | OSS | CUSTODY POLICY AUDIT | Integrate option (OSS Vault fork) |
| Argent | Commercial wallet | RECOVERY WALLET POLICY | Adopt patterns (guardian/social recovery UX) |
| Clave | Commercial wallet | RECOVERY WALLET AUTH | Adopt patterns (passkey-first recovery) |
| Hanko/Corbado/OwnID/Passage | Commercial/OSS | AUTH RECOVERY | Adopt patterns (passkey recovery; see 01) |

---

## Deep dives — primary overlap products

### Turnkey — integrate (production custody backend candidate)

- **Identity:** commercial hardware-isolated (secure enclave) key infrastructure with a programmable policy engine.
- **Feature inventory:** keys generated/used inside TEEs, never exported; policy language gating every signature (who/what/conditions); sub-organizations; delegated access; short-lived sessions; wallet/key REST APIs; quorum approvals; full audit log of signing decisions.
- **Overlap with AP:** the closest match to AP's *intended* `key-custody` production posture. Turnkey policies ≈ AP CustodyPolicy tiers; delegated access ≈ AP session delegations; sub-orgs ≈ AP org/treasury accounts.
- **AP lacks:**
  - `[SDK]` finished enclave/KMS-backed signing (the P0 gap); policy *simulation* ("what would this policy allow?"); session-key issuance ergonomics; verifiable key-management attestation (proof keys never leave hardware).
- **Turnkey lacks:**
  - `[Contracts]` on-chain account model + canonical identity (Turnkey holds keys; it isn't the identity); open custody contracts; naming/attestation registries.
  - `[SDK]` delegation that reaches MCP/A2A and on-chain redemption.
- **Verdict:** integrate as a `key-custody` backend behind the existing provider interface, and adopt the policy-simulation + verifiable-custody narrative. Turnkey is the bar production custody is judged against.

### Fireblocks — integrate (institutional benchmark)

- **Feature inventory:** MPC-CMP custody, policy engine with approval workflows, transaction authorization governance, treasury + stablecoin infra, deep compliance/audit logging, insurance posture.
- **Overlap with AP:** custody policy + approvals overlap CustodyPolicy tiers + safety delays; treasury overlaps the org/treasury account model.
- **AP lacks:**
  - `[SDK]` institutional approval-workflow engine; compliance reporting export; MPC backend option for customers who won't use smart-contract custody.
  - `[UX]` (deferred) approval-workflow console; insurance/SOC2 posture marketing.
- **Fireblocks lacks:**
  - `[Contracts]` canonical on-chain identity; open custody contracts.
  - `[SDK]` agent-native delegation; MCP authorization; open package boundaries.
- **Verdict:** integrate for institutional customers; don't rebuild institutional custody. Benchmark the approval-workflow UX.

### Lit Protocol — integrate (TEE-attested action signing)

- **Feature inventory:** decentralized TEE network, programmable signing via "Lit Actions" (code-hash-bound), encrypted secrets, condition-based decryption, PKP (programmable key pairs).
- **Overlap with AP:** conditional signing ≈ caveat-gated delegation redemption; encrypted secrets ≈ tool-secret handling for MCP; access control ≈ `content-primitives`/vault (see 11).
- **AP lacks:**
  - `[SDK]` TEE-attested execution for high-risk tool operations (prove the exact code ran before signing); encrypted-secret storage tied to access conditions.
- **Lit lacks:**
  - `[Contracts]` ERC-4337 account model; custody tiers; naming/attestation registries.
  - `[SDK]` audit evidence discipline.
- **Verdict:** integrate Lit-style action attestation for high-risk MCP tool operations and encrypted tool secrets; complements rather than replaces CustodyPolicy.

### Cloud KMS/HSM (GCP, AWS, Azure) + HashiCorp Vault / OpenBao — integrate (production backends)

- **Feature inventory:** managed key protection, IAM-gated key use, key rotation, audit logging (CloudTrail / Cloud Audit Logs / Vault audit devices), HSM-backed key tiers; Vault adds transit signing, dynamic secrets, self-host.
- **Overlap with AP:** these ARE the intended backends for the unfinished `key-custody` production path.
- **AP lacks (= the P0 closure work):**
  - `[SDK]` workload-identity-based KMS access (no static creds); per-subject key derivation; session-signing through KMS; key-rotation runbook; IAM least-privilege evidence; CloudTrail/audit-log export into the AP audit sink; **fail-closed enforcement blocking `LocalAesProvider`/env-var signer when `NODE_ENV=production`**.
- **They lack:** everything above the key layer; they're infrastructure, not identity (no `[Contracts]`/`[SDK]` identity or delegation surface).
- **Verdict:** integrate. GCP Cloud KMS/HSM is the primary target given Cloudflare/GCP deployment; AWS KMS + Vault/OpenBao as alternates. This is roadmap **FG-SEC-2 (P0)**.

### Argent / Clave — adopt patterns (consumer recovery)

- **Feature inventory:** guardian/social recovery, daily limits, passkey-first onboarding (Clave), polished recovery journeys with human-readable guardian management.
- **Overlap with AP:** trustee/guardian quorum in CustodyPolicy (T6 recovery lifeline); the recovery ceremony.
- **AP lacks:**
  - `[UX]` (deferred) consumer-grade recovery UX — guardian invitation flows, recovery status tracking, plain-language trustee management. AP has the *mechanism* (trustee quorum, multi-credential self-recovery) but not the *experience*.
- **They lack:**
  - `[Contracts]` tiered custody policy; on-chain identity persistence across recovery (the SA address never changes — ADR-0011).
  - `[SDK]` agent delegation.
- **Verdict:** adopt recovery UX patterns; AP's recovery mechanism is arguably stronger but invisible without product surface.

---

## Compact entries — remaining products

| Product | Overlap with AP | AP lacks | Verdict |
| --- | --- | --- | --- |
| DFNS | `key-custody` enterprise API + policy | Enterprise wallet API ergonomics; governance controls UI | Track / integrate option |
| OpenBao | Self-host session encryption + audit sink | (same as Vault) OSS deployment recipe | Integrate option |

---

## Focus-area gap rollup — by layer

### `[Contracts]` gaps — active

*None new.* CustodyPolicy tiers + trustee recovery are an AP **advantage**; remaining contract issues (CP-1/CP-2 install-path validation) are tracked in the [contract audit](../audits/2026-06-10-contract-by-contract-audit.md), not as competitive gaps.

### `[SDK]` / package gaps — active

| Gap | Evidence | Roadmap ID | Priority |
| --- | --- | --- | --- |
| Production KMS/HSM per-subject derivation + session signing; block local signer in prod | GCP/AWS KMS, Turnkey, Fireblocks | FG-SEC-2 | **P0** |
| IAM/CloudTrail custody evidence export into audit sink | AWS/GCP KMS, Vault | FG-SEC-3 | P0 (pairs with FG-SEC-2) |
| Policy simulation ("what would this policy allow/deny?") | Turnkey, Fireblocks, Cerbos (04) | FG-SEC-5 | P1 |
| Verifiable custody attestation (keys never leave hardware) | Turnkey, Lit | FG-SEC-6 | P1 |
| Institutional approval-workflow engine + compliance export | Fireblocks | FG-ENT-3 | P2 |
| TEE-attested signing for high-risk tool ops + encrypted tool secrets | Lit Protocol | FG-SEC-7 | P2 |

### `[UX]` gaps — **deferred (recorded, not current focus)**

| Gap | Evidence |
| --- | --- |
| Consumer recovery UX (guardian invites, recovery status, plain-language trustees) | Argent, Clave |
| Approval-workflow console | Fireblocks, Turnkey |

**Substrate advantages to preserve:** custody tiers (T1–T6) with safety delays; recovery that never changes the SA address (ADR-0011); credential rotation as a governed custody op, not a delegation; on-chain passkey verification (rpIdHash + UV); own quorum with strict-increasing signer dedup + CEI.
