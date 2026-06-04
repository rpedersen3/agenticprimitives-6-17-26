# Spec 253 — One-prompt org-create via batched on-chain hash approval

**Status:** SHIPPED 2026-06-04 (R11 full Base Sepolia redeploy). **Security-auditor verdict:
GO-WITH-CONDITIONS** — all conditions met (see §5). PRs: spec #177/#178, contract #179, home+relayer #181,
redeploy #182. Live addresses (R11): factory `0x6f7Fc9B36977F55666548e0a73D9063F0D88A760`, impl
`0x11f1523D9883BdF382993d70C601D307ED0F1f13`, ApprovedHashRegistry
`0xE01c1356F4B10FEfa8Ab210020B802cf3e900759`, paymaster `0x0e54A8Cc986C86530f0593817E8CafE01FC52983`
(devMode). 9/9 Foundry gate tests pass; `factory.approvedHashRegistry()` verified on-chain.
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

- `packages/contracts/src/AgentAccount.sol`: add the sentinel branch in **`isValidSignature` ONLY** — when
  `signature == SENTINEL (0x03)`, return `ERC1271_MAGIC` iff `_approvedHashRegistry().isApproved(address(this), hash)`.
  **CRITICAL (auditor P0 / F-4):** the branch MUST be inlined in `isValidSignature` BEFORE it delegates to
  the shared `_validateSig`, and MUST be **provably unreachable** from `_validateSignature` (the ERC-4337
  userOp-authorization path) / `_validateSig` / `executeFromBundler`. `_validateSig` is shared by BOTH the
  userOp-auth path and ERC-1271; putting the approved-hash branch in `_validateSig` would let a userOp whose
  `userOpHash` is pre-approved authorize with `signature=0x03` — an auth bypass. So: sentinel handling is an
  ERC-1271-entrypoint-only wrapper; `_validateSig` is unchanged.
- **Registry address is IMMUTABLE (auditor P1 / F-5), NOT a factory-view.** Trusting an owner-mutable
  factory-view (`bundlerSigner`-style) would let a factory-owner-key compromise re-point every account at an
  attacker registry that returns `isApproved == true` for any `(account, hash)` → forge a "valid signature"
  for any hash on any account. Bind the registry as a compile-time `immutable` (or set-once in the impl
  initializer, never rotatable) = the deployed `0x0Fb3C1495CE94D947205422A0CE79590B714E4E0`. Rotation, if ever
  needed, goes through a custody-gated UUPS impl upgrade — never a setter.
- **Fail closed (auditor P1 / F-6, ADR-0013).** If the registry resolves to `address(0)` or the call reverts,
  `isValidSignature(hash, 0x03)` MUST return `0xffffffff` (reject) — never fall through to `_validateSig`
  (which would mis-parse `0x03` anyway) and never treat "no registry" as "skip the check." (An immutable
  non-zero registry largely subsumes this; the explicit reject is belt-and-suspenders.)
- UUPS upgrade: redeploy the impl; point `AgentAccountFactory`'s default impl at it so **freshly-deployed
  org SAs** (deployed in the same one-prompt op) carry the new `isValidSignature`. Existing delegator
  proxies that must use the sentinel elsewhere need a UUPS upgrade (org SAs created via this flow are new,
  so they get it at deploy).
- The on-chain redeem path (`DelegationManager._validateDelegation` → ERC-1271) also benefits — but it
  ALREADY gates on `_revoked[dHash]` first (`:410`), so redeem honors revocation; only the off-chain relayer
  is blind (see §5.2). One contract edit covers verify AND redeem.

## 4. Sentinel + verify

- Wire `signature = 0x03` — an **explicit 1-byte tag** (ADR-0013: never empty `0x`, which collides with
  "missing signature" and is rejected by the length gate). The home stamps it on the org-as-delegator
  delegations.
- `apps/demo-a2a/src/index.ts` `verifyDelegation`: no logic change needed once the contract honors the
  sentinel (delegate-match + timestamp-caveat checks are signature-independent); update the diagnostics tag
  switch to recognize `0x03` (skip WebAuthn parsing).

## 5. Security analysis — auditor verdict GO-WITH-CONDITIONS

A pre-implementation security-auditor review (2026-06-04) confirmed the core idea is sound — the load-bearing
ADR-0011 invariant **holds by construction**: custody/recovery never routes through `isValidSignature`
(`CustodyPolicy._verifyQuorum` recovers signers directly via `SignatureSlotRecovery` + `isCustodian`/`trustees`;
all custody mutators are `onlySelf`, not ERC-1271-gated). So a pre-approved hash can never be consumed as
custody consent. The verdict is **GO-WITH-CONDITIONS** — these are gates; the contract change MUST NOT merge
until conditions 1–4 land with their tests.

1. **(P0) Sentinel in `isValidSignature` ONLY.** `_validateSig` is shared with the userOp-auth path; the
   approved-hash branch must be unreachable from `_validateSignature`/`executeFromBundler` or it becomes a
   no-signature userOp-authorization bypass. (Implemented per §3.) Test: a userOp with `signature=0x03` over a
   pre-approved hash is REJECTED by `_validateSignature`, while `isValidSignature` accepts it.
2. **(P0) Off-chain revocation must fail closed.** `revokeDelegationByOwner` sets `_revoked[dHash]` but does
   NOT touch `ApprovedHashRegistry`, so `isApproved`/`isValidSignature(0x03)` stay valid forever after
   revocation. The off-chain relayer `verifyDelegation` does NOT check `isRevoked` today → it would accept a
   revoked sentinel delegation. FIX: `verifyDelegation` MUST call `DelegationManager.isRevoked(digest)` and
   fail closed — required for **all** delegations (the gap exists for signature-bearing ones too), critical for
   sentinel ones (the approved hash is otherwise a permanent credential). DECISION (document explicitly):
   `revokeDelegationByOwner` is the single kill switch; once relayer + on-chain redeem both gate on `isRevoked`,
   the stale `isApproved` bit is defense-not-relied-upon. We do NOT also `revokeHash` (it would be a second
   passkey prompt). Any future consumer that trusts the registry directly must be aware the bit outlives revoke.
3. **(P1) Immutable registry, fail-closed.** Per §3 — no owner-mutable factory-view (forge-any-signature
   pivot); `address(0)`/unreachable ⇒ reject. Test: registry==`address(0)` ⇒ sentinel rejected.
4. **(P2) Cross-purpose isolation + time-unbounded result.** The sentinel ERC-1271 result is **time-unbounded**
   (the registry has no expiry; expiry rides the `TimestampEnforcer` caveat, enforced by the relayer off-chain
   + the DM on-chain — NOT by `isValidSignature`, which knows nothing about caveats). Document: any consumer
   treating `isValidSignature(digest,0x03)==magic` as full authorization WITHOUT evaluating caveats is using it
   wrong. The same registry singleton backs CustodyPolicy's `v==1` quorum path; a delegation digest approved by
   an SA cannot satisfy `_verifyQuorum` (distinct domain separators/typehashes; SA not its own trustee) — ship a
   test proving this isolation.
5. **(doc) `approveHash` is permissionless but address-bound.** Anyone may call `approveHash`, but it records
   `msg.sender` as the approver, so `isApproved(orgSA, hash)` only matches what the org SA itself approved
   (made inside its custody-gated deploy op). Not "custody-gated function"; "approval bound to the caller."

**Digest determinism.** The struct hashed-for-approve MUST be byte-identical to the wire struct (same
delegator/delegate/caveats/salt; `hashDelegation` excludes only `args`, confirmed safe). Do not re-randomize
salt between approve and wire, or `isApproved` is false.

**Gas/atomicity.** The extra `approveHash` calls inflate the deploy `callGasLimit` (~20k each); size it up. The
whole op (deploy+name+approvals) is atomic + paymaster-sponsored — undersized ⇒ revert ⇒ no org (fail-closed,
acceptable).

**Testnet-demo scope.** The ERC-1271 approved-hash extension is novel/unaudited beyond this design review; the
pre-launch hardening dossier must cover the shipped implementation before any real pilot.

### Foundry test matrix (gate before merge)
1. userOp `signature=0x03` over a pre-approved hash ⇒ `_validateSignature` REJECTS (P0/F-4).
2. `isValidSignature(approvedHash, 0x03)` ⇒ magic; un-approved hash ⇒ `0xffffffff`.
3. Cross-account isolation: account B's `0x03` against a hash A approved ⇒ reject.
4. Registry `address(0)`/unreachable ⇒ sentinel rejected, no fallback (P1/F-6).
5. Revoked-by-owner sentinel delegation ⇒ rejected on on-chain redeem; off-chain `verifyDelegation` rejects
   once `isRevoked` lands (P0/F-1).
6. A delegation digest pre-approved by an SA cannot satisfy `CustodyPolicy._verifyQuorum` (P2/F-2).
7. Non-sentinel signatures byte-for-byte unaffected (regression).

## 6. Files to change

- `packages/contracts/src/AgentAccount.sol` (sentinel branch in `isValidSignature` ONLY + an `immutable`
  registry address) + the §5 Foundry test matrix (all 7).
- `packages/contracts/script/Deploy.s.sol` — wire the factory/impl to the (already-deployed) registry;
  redeploy impl + factory default.
- `apps/demo-sso-next/src/connect-client.ts` `createChildAgentForSite` — build the org-as-delegator
  delegation structs, append `approveHash(digest)` to the deploy `executeBatch`, stamp the sentinel,
  remove the #2/#3/#5 passkey prompts, defer #4.
- `apps/demo-sso-next/src/lib/delegation.ts` `issueSiteDelegation` — add an unsigned variant returning the
  delegation + digest (no `signHash`).
- `apps/demo-a2a/src/index.ts` `verifyDelegation` — recognize the `0x03` sentinel in diagnostics; **add a
  fail-closed `DelegationManager.isRevoked(digest)` check for ALL delegations** (the revocation-gap fix; the
  gap exists for signature-bearing ones too, critical for sentinel ones).

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
