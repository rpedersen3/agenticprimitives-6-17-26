# Spec 253 — One-prompt org-create via batched on-chain hash approval

**Status:** draft, 2026-06-04.
**Owner:** `packages/contracts` (`AgentAccount.isValidSignature` + the `ApprovedHashRegistry` it must
honor) + `apps/demo-sso-next` (the home org-create ceremony) + `apps/demo-a2a` (the delegation verify
path). Affects BOTH demo-jp and demo-gs (shared Impact home).
**Architecture-of-record:** [ADR-0019](../docs/architecture/decisions/0019-relying-site-authority-is-a-scoped-delegation.md)
(relying-site authority is a scoped delegation — whose *signature mechanism* this changes),
[ADR-0011](../docs/architecture/decisions/0011-credential-recovery-and-re-association.md) (a delegation
must NEVER grant custody — the new sentinel path must not widen authority),
[ADR-0013](../docs/architecture/decisions/0013-no-silent-fallbacks.md) (explicit sentinel, never an
ambiguous/empty signature), [ADR-0021](../docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md)
(the `isValidSignature` change lives in `packages/contracts`; the ceremony orchestration in the app).

## Reference: smart-agent patterns to port

`/home/barb/smart-agent` ships the **`ApprovedHashRegistry`** + the batched-approve pattern: a passkey
smart account `approveHash`es + performs the delegated action in one userOp, consumed via the
**QuorumEnforcer `v==1`** path (`SignatureSlotRecovery.recoverFromSlot` →
`ApprovedHashRegistry.isApproved`), exercised in `packages/contracts/test/{TreasuryCaveatStack,QuorumEnforcer}.t.sol`.
We **port the registry + the batched-approve-in-deploy pattern verbatim**. We **deliberately diverge** by
extending approved-hash to the **ERC-1271 `isValidSignature`** path (smart-agent only honors it in the
QuorumEnforcer consumer). That extension is NOVEL and unaudited — this spec scopes it tightly and routes
it through a security review before it ships.

## 1. Problem

Creating an organization at the Impact home (`createChildAgentForSite`) fires **up to 5 separate passkey
(WebAuthn) assertions**: (1) deploy+name (one userOp, already batched), then a per-delegation off-chain
EIP-712 signature for (2) org→app site grant, (3) org→broker grant, (4) person→org membership read
delegation, (5) org→person stewardship read delegation. Five device prompts to create one org is hostile
UX (memory `feedback_value_steps_not_signatures`: batch on-chain ops → one confirm).

## 2. Target: one prompt

Collapse the **org-as-delegator** authorizations into the SAME deploy userOp the org SA already runs, so
org-create costs **one passkey assertion**:

Deploy userOp `executeBatch` (msg.sender = the freshly-deployed org SA), one signature:
1. `permissionlessSubregistry.register(label, orgSA)` (existing)
2. `agentNameRegistry.setPrimaryName(node)` (existing)
3. `approvedHashRegistry.approveHash(digest_siteGrant)` — org→delegateSA
4. `approvedHashRegistry.approveHash(digest_brokerGrant)` — org→grantOrg (when `grantOrg` set)
5. `approvedHashRegistry.approveHash(digest_stewardship)` — org→personAgent

where `digest = hashDelegation(d, CHAIN_ID, delegationManager)` for each `Delegation` (computed exactly as
`apps/demo-sso-next/src/lib/delegation.ts` does today). Those delegations travel on the wire with a
**sentinel signature `0x03`** instead of a passkey assertion. The relayer's `verifyDelegation` calls
`isValidSignature(digest, 0x03)`; the org SA returns the ERC-1271 magic value because
`ApprovedHashRegistry.isApproved(orgSA, digest) == true`.

**Person-side membership (#4) is DEFERRED** — its delegator is the PERSON SA (not the org), so it cannot
be approved inside the ORG's deploy op. It is already best-effort; re-mint it later from the person's home
(a person-SA `approveHash` op) or on first need. Stewardship (#5) is split out of the current #4/#5
try-block and rides the org batch.

## 3. The required contract change (the crux)

`AgentAccount.isValidSignature` does **NOT** consult the `ApprovedHashRegistry` today — the registry is
wired only into the QuorumEnforcer `v==1` path, never the ERC-1271 path the delegations verify through. So
this is a **contract change + impl redeploy**, not a home-only tweak.

- `packages/contracts/src/AgentAccount.sol` `isValidSignature` / `_validateSig`: add a branch that, when
  `signature == SENTINEL (0x03)`, returns `ERC1271_MAGIC` iff `ApprovedHashRegistry.isApproved(address(this), hash)`.
  The branch MUST run **before** the `sig.length < 1` reject and MUST be sentinel-gated (never check the
  registry for a normal signature). The account learns the registry address via a **factory-view lookup**
  (mirroring `bundlerSigner()`) so it rotates without per-account migration.
- UUPS upgrade: redeploy the impl; point `AgentAccountFactory`'s default impl at it so **freshly-deployed
  org SAs** (deployed in the same one-prompt op) carry the new `isValidSignature`. Existing delegator
  proxies that must use the sentinel elsewhere need a UUPS upgrade (org SAs created via this flow are new,
  so they get it at deploy).
- The on-chain redeem path (`DelegationManager._validateSignature`) also uses ERC-1271 → the same change
  covers verify AND redeem with one contract edit.

## 4. Sentinel + verify

- Wire `signature = 0x03` — an **explicit 1-byte tag** (ADR-0013: never empty `0x`, which collides with
  "missing signature" and is rejected by the length gate). The home stamps it on the org-as-delegator
  delegations.
- `apps/demo-a2a/src/index.ts` `verifyDelegation`: no logic change needed once the contract honors the
  sentinel (delegate-match + timestamp-caveat checks are signature-independent); update the diagnostics tag
  switch to recognize `0x03` (skip WebAuthn parsing).

## 5. Security analysis (MUST be reviewed before shipping)

This widens the ERC-1271 surface; it is the riskiest part and goes through the **security-auditor** before
the contract change merges.

1. **Novel ERC-1271 approved-hash surface.** `isValidSignature` now returns "valid" for any hash the
   account pre-approved. Mitigations: (a) sentinel-gated — only when `signature == 0x03`; (b) registry
   keyed by `address(this)` (an account can only approve its OWN hashes); (c) `approveHash` is only callable
   via the account's own `execute`/`executeBatch` (msg.sender = the account), i.e. already custody-gated.
   ADR-0011 invariant: this must NOT let a delegate gain custody — an approved delegation hash authorizes
   the *delegation*, not a custody change; custody operations do not flow through `isValidSignature`-of-a-
   delegation. Verify no custody/recovery path treats an approved hash as consent.
2. **Revocation gap (FIX REQUIRED).** `approveHash` is permanent until `revokeHash`. The off-chain
   `verifyDelegation` does NOT check `DelegationManager.isRevoked` today — so an approved-hash delegation
   could pass off-chain verify after the delegation was revoked off-chain. FIX: `verifyDelegation` MUST
   check `isRevoked(delegator, digest)` for sentinel (approved-hash) delegations (it can skip it for
   signature-bearing ones as today, or add it for all). A delegation's expiry still rides its timestamp
   caveat (checked off-chain + on-chain at redeem); the approved hash itself never expires, so revocation is
   the only kill switch — it must be honored on BOTH paths.
3. **Digest determinism.** The struct hashed-for-approve MUST be byte-identical to the struct put on the
   wire (same salt, caveats, delegate) or `isApproved` is false. Do not re-randomize salt between approve
   and wire.
4. **Gas/atomicity.** The extra `approveHash` calls inflate the deploy `callGasLimit` (~20k each); size it
   up. The whole op (deploy+name+approvals) is atomic + paymaster-sponsored — if undersized it reverts and
   no org is created (fail-closed, acceptable).
5. **Testnet-demo scope.** Ship behind the existing demo posture; the ERC-1271 approved-hash extension is
   unaudited. Pre-launch hardening (the audit dossier) must cover it before any real pilot.

## 6. Files to change

- `packages/contracts/src/AgentAccount.sol` (`isValidSignature`/`_validateSig` + registry-address source)
  + Foundry tests (approved-hash sentinel validates; non-sentinel unaffected; revoked → rejected;
  cross-account approval isolation).
- `packages/contracts/script/Deploy.s.sol` — wire the factory/impl to the (already-deployed) registry;
  redeploy impl + factory default.
- `apps/demo-sso-next/src/connect-client.ts` `createChildAgentForSite` — build the org-as-delegator
  delegation structs, append `approveHash(digest)` to the deploy `executeBatch`, stamp the sentinel,
  remove the #2/#3/#5 passkey prompts, defer #4.
- `apps/demo-sso-next/src/lib/delegation.ts` `issueSiteDelegation` — add an unsigned variant returning the
  delegation + digest (no `signHash`).
- `apps/demo-a2a/src/index.ts` `verifyDelegation` — recognize the `0x03` sentinel in diagnostics; **add the
  `isRevoked` check for sentinel delegations** (the revocation-gap fix).

## 7. Phasing

1. Spec (this) + **security-auditor review of the design** (gate before the contract change).
2. Contract: `AgentAccount` approved-hash sentinel branch + Foundry tests; factory wiring. Redeploy impl +
   factory on Base Sepolia (the impl/factory churn re-points dependent addresses — coordinate like R8/R9).
3. Home ceremony: batch the approvals + sentinel; defer membership.
4. Relayer: sentinel diagnostics + the `isRevoked` revocation-gap fix.
5. Verify end-to-end: a real org-create completes with ONE passkey prompt; the org→app + org→broker grants
   read the org's vault; a revoked approved-hash delegation is rejected; a non-sentinel signature is
   unaffected.

## 8. Acceptance

- Org-create at the Impact home requires exactly **one** passkey assertion (deploy+name+approvals).
- The org→app (site) + org→broker grants validate via the approved hash (sentinel `0x03`) on both the
  off-chain relayer verify and the on-chain redeem path; demo-gs GCO + demo-jp adopter/facilitator org
  flows work end-to-end.
- A revoked approved-hash delegation is rejected on BOTH paths (revocation gap closed).
- A normal signature-bearing delegation is byte-for-byte unaffected (no regression).
- Foundry tests + `pnpm check:all` green; security-auditor sign-off on the `isValidSignature` change.
