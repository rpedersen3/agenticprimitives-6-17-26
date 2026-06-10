# Spec 270 — DEL-001: connection-agnostic session-key ↔ identity binding

**Status:** Draft v4 (architect-of-record). v1 a flag flip; v2 a session-key-lifecycle decision; v3 a
self-authenticating delegate-authorized chain; **v4 (this)** generalizes it to **every connection
strategy across every app** — anchored on the on-chain `UniversalSignatureValidator` so the verifier
never branches on *how* a user connected.
**Severity:** Critical (last un-activated Critical of the 2026-06-09 independent package audit).
**Owns:** the binding + its connection-agnostic activation. The leaf-check primitive ships in
`@agenticprimitives/delegation` (`token.ts`); the universal verify surface ships on-chain
(`UniversalSignatureValidator.sol`). This spec wires them together.

Builds on: [ADR-0010](../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md) (the SA is
the identity), [ADR-0011](../docs/architecture/decisions/0011-credential-recovery-and-re-association.md)
(credentials rotate, the SA address never changes),
[ADR-0035](../docs/architecture/decisions/0035-recoverable-custody-and-self-authenticating-chains.md)
(self-authenticating chains), and [ADR-0031](../docs/architecture/decisions/0031-fedcm-and-browser-credential-apis-are-adapters.md)
(FedCM/browser-credential APIs are adapters — a gate, not an authority). Spec 271 `recoverCustodian`
serves *org* custody recovery, not the member-leaf path.

---

## 1. The vulnerability

A delegation token carries the full signed `delegation` in cleartext + a session-key signature. The
verifier checked only "*some* session key signed these claims," so **anyone who observes a token can
re-mint it** with their own session key and impersonate `delegation.delegator` for the token's scope +
TTL. *Observe-and-re-mint* — no key theft. The fix binds the presenting session key to the SA's
authority so a re-mint with a foreign key fails.

## 2. The principle, and why it generalizes

Binding is fundamental: a key may act for an SA only if **that SA's authority vouches for it**. The
decisive observation for *this* revision: **the Smart Account is the single universal validation surface
that every connection strategy already resolves to.** ADR-0010 makes the SA the canonical identity;
ADR-0011 keeps its address fixed across credential rotation; every credential — passkey, EOA, KMS,
multi-sig quorum, FedCM-gated, counterfactual — ultimately signs *as* that SA and is validated by *its*
signature surface. So if the binding is **bound to the SA (the delegator) and validated through that
universal surface, the verifier never has to know how the user connected.**

## 3. The keystone — bind to the SA, validate via `UniversalSignatureValidator`

The repo already ships the universal surface: **`UniversalSignatureValidator.sol`** (deployed
`0x7A282…`, ported from smart-agent) — a single `isValidSig(signer, hash, sig)` that resolves:

- **deployed SA** → `AgentAccount.isValidSignature` (ERC-1271), which routes on the signature's leading
  byte: `0x00` ECDSA (external custodian), `0x01` WebAuthn/P-256 (passkey, rpIdHash-pinned), `0x03`
  approved-hash sentinel, and recurses through an **ERC-6492** envelope;
- **counterfactual / not-yet-deployed SA** → **ERC-6492** (deploy-on-verify, then ERC-1271);
- **raw EOA** → ECDSA-recover (covers the admin-shortcut EOAs);
- **multi-sig / threshold SA** → the same ERC-1271 entry, with the account's `SignatureSlotRecovery`
  (v-byte-routed slots: ERC-1271 / approved-hash / WebAuthn / ECDSA) + `isCustodian` quorum check.

**Two changes make DEL-001 connection-agnostic:**

1. **Bind to the delegator (the SA), not the delegate.** The session-delegation leaf is
   `delegation.delegator (member SA) → session-key`; the verifier requires `leaf.delegator ==
   token.delegation.delegator` and `leaf.delegate == sessionKeyAddress`. (v3 bound to the *delegate*;
   v4 binds to the *delegator/principal* because that is the SA whose authority every connection
   strategy can sign for at connect time — §5.)
2. **Validate the leaf (and the delegation) through `UniversalSignatureValidator`, not raw
   `isValidSignature` + `requireDeployed`.** `token.ts:549` today calls `AgentAccount.isValidSignature`
   directly and hard-rejects undeployed SAs. Routing through the universal validator covers ERC-1271 +
   ERC-6492 + ECDSA + WebAuthn + multi-sig uniformly — *that single change is what lets every strategy
   below work through one code path.*

## 4. Connection-strategy × app coverage matrix (the acceptance surface)

Verified against source (2026-06-09 survey). Every row resolves to **SA → universal validation**; the
verifier special-cases nothing.

| App | Connect strategy | What signs the leaf | Identity | Leaf validated via |
| --- | --- | --- | --- | --- |
| demo-web | EOA / SIWE (`siwe-flow.ts`) | external EOA (ECDSA / EIP-191) | SA (deployed or counterfactual) | USV → ERC-1271 `_verifyEcdsa` / ECDSA / ERC-6492 |
| demo-web | passkey-direct (`passkey-siwe-flow.ts`, `deploy-flow.ts`) | WebAuthn P-256 (`0x01`) | SA (passkey-custodied) | USV → ERC-1271 `_verifyWebAuthn` (rpIdHash-pinned) / ERC-6492 |
| demo-web-pro | multi-sig / threshold custody (spec 207, `custody-flow.ts`) | M-of-N quorum (mixed credentials) | **same** SA | USV → ERC-1271 → `SignatureSlotRecovery` + `isCustodian` |
| demo-web-recovery | credential recovery / rotation (spec 221, `acts/`) | the **rotated** (current) credential | **same** SA address (ADR-0011) | USV → ERC-1271 against the updated custodian/PasskeyStorage |
| demo-jp / demo-gs | OIDC-via-home, ROOT-credential ceremony (`oidc/grant.ts`) | the member's ROOT credential (passkey / EOA / KMS `C_sub`) | member SA | USV → ERC-1271 (whichever credential) |
| demo-sso-next / any | **FedCM** (`fedcm-rp`, `fedcm-idp`, `server/fedcm.ts`) | — assertion is a *gate*; the substrate signs the leaf with the home SA credential | member SA | USV → ERC-1271 (same as the ceremony) |
| any | counterfactual SA (not yet deployed) | the predeploy credential, ERC-6492-wrapped | SA (counterfactual) | USV → **ERC-6492** deploy-on-verify → ERC-1271 |
| admin shortcut | raw EOA persona (Pete/Jill) | EOA (ECDSA) | EOA (not an SA) | USV → ECDSA-recover |

**Result:** one verifier path serves demo-web, -pro, -recovery, jp, gs, sso-next, the external Scripture
Agent / demo-bible consumers, and any future relying app — because they all terminate at the same SA
signature surface.

## 5. Where the leaf is signed (varies) vs. what validates it (universal)

The session-delegation leaf is signed **at connect, by whatever credential is live for the SA at that
moment** — there is no single "minter":

- **OIDC-via-home ceremony** (jp/gs, FedCM): the ROOT-credential ceremony that already signs
  `member→relying` (`oidc/grant.ts` verifies it) *also* signs `member→session-key`. One ceremony.
- **passkey-direct / SIWE** (demo-web): the connect flow that authorizes the agent signs the leaf in the
  same step (`authorize-flow.ts`).
- **multi-sig** (demo-web-pro): the quorum signs the leaf as a custody-grade slot set.
- **FedCM**: the assertion gates; the substrate signs the leaf with the home SA credential — FedCM adds
  no new custody path.

What they share — and all the verifier sees — is the SA + a universal signature. **WHERE differs; WHAT
validates is always `UniversalSignatureValidator`.**

## 6. Recovery and multi-sig need no special-casing

- **Recovery (ADR-0011 / spec 221):** rotation changes the *credential*, never the SA *address*. Session
  leaves are short-lived (per-session TTL) and re-signed each session with the SA's *current* credential,
  so there are no stale leaves — the verifier validates against the SA, which now reflects the new
  custodian/PasskeyStorage. A leaf signed by a removed credential simply fails (fail-closed); the next
  session re-signs.
- **Multi-sig (spec 207):** a threshold SA has one address; the quorum signs the leaf and the account's
  ERC-1271 + `SignatureSlotRecovery` validates it. No verifier change beyond routing through the SA.

## 7. Design decisions

- **D1 — Bind to the SA/delegator; validate via `UniversalSignatureValidator`** (§3). The two changes
  that make it connection-agnostic. Fail-closed; no permissive default (ADR-0013).
- **D2 — The leaf is signed at connect by the live credential; per session, reused across that
  session's tokens.** No per-token signing, no on-chain tx on the hot path.
- **D3 — Two-phase rollout (mandatory, fail-closed gate).** Phase A: every connect flow emits a leaf
  (gate off → old + new tokens verify). Phase B: flip `requireSessionDelegateBinding` on every verifier
  after the TTL drain. Separate, ordered deploys.
- **D4 — Apps + demo-a2a are presenters/verifiers, never minters-for-strangers.** The leaf is signed
  where the SA's credential lives (the client/ceremony); demo-a2a validates + relays (ADR-0035 pillar 2).
- **D5 — FedCM is a gate, not authority.** The assertion authenticates; the substrate signs the leaf
  with the SA credential — identical downstream to any other strategy.
- **D6 — `recoverCustodian` (spec 271) is the ORG path, not the member path.** Org SAs whose custodian
  must be reconstructed server-side use spec 271; member SAs sign their own leaf at connect.

## 8. Reference: smart-agent patterns to port

`UniversalSignatureValidator.sol` is **ported verbatim from smart-agent** (the ERC-6492 reference
shape) — we adopt it as the verify surface for the leaf, exactly as smart-agent uses it for
signer-agnostic verification. We diverge from smart-agent's on-chain `acceptSessionDelegation`/chained
redeem (it has no off-chain token verifier to run against); the in-token leaf + universal validator is
our off-chain equivalent. We port the **surface**, not the redeem path.

## 9. Waves

- **W1 — Universal verifier (Phase A core).** `verifyDelegationToken` validates the delegation + the
  `sessionDelegation` leaf through `UniversalSignatureValidator` (ERC-1271 / ERC-6492 / ECDSA), binding
  `leaf.delegator == delegation.delegator` + `leaf.delegate == sessionKey`. Replace the `requireDeployed`
  hard-reject with ERC-6492. Package-level; unit-tested with stubbed validator reads across all signature
  kinds. *(Gate stays off.)*
- **W2 — Connect-flow leaf emission (Phase A wiring).** Each connect surface signs the leaf with the live
  credential alongside the existing delegation: the home ceremony (`oidc/grant.ts` consumers), demo-web
  authorize flows, demo-web-pro quorum, FedCM substrate. Per-session key. Deploy.
- **W3 — Enforce (Phase B).** Flip `requireSessionDelegateBinding` in every verifier (mcp-runtime
  `withDelegation` + the a2a gate); deploy after the TTL drain; batch with the SC-4/SC-5 factory reset.
- **W4 — Multi-sig + recovery coverage tests** (spec 207 / 221 flows) as live acceptance.

## 10. Acceptance criteria

- **DEL-001-AC-1 (attack blocked):** a token re-minted with a foreign session key + leaf is rejected
  under Phase B (the universal validator fails for a key the SA never authorized). Two-key test.
- **DEL-001-AC-2 (matrix coverage):** for EACH row of §4 — EOA, passkey, multi-sig, recovery-rotated,
  OIDC-ceremony, FedCM, counterfactual — a correctly-signed leaf **verifies** through
  `UniversalSignatureValidator` and a foreign-key leaf is **rejected**, with no strategy-specific code.
- **DEL-001-AC-3 (counterfactual):** a leaf for an undeployed SA verifies via ERC-6492.
- **DEL-001-AC-4 (recovery):** after a credential rotation (spec 221), a fresh session leaf signed by
  the new credential verifies against the **same SA address**; one signed by the removed credential is
  rejected.
- **DEL-001-AC-5 (Phase A non-breaking):** gate off → leaf-bearing and legacy tokens both verify.
- **DEL-001-AC-6 (no branch on strategy):** the verifier contains **no** `if (strategy === …)` — proven
  by code review + the single-path tests.

## 11. Invariants

- **DEL-001-INV-1:** the verifier NEVER branches on connection strategy or credential type; it validates
  the SA signature through `UniversalSignatureValidator` only.
- **DEL-001-INV-2:** the leaf binds the session key to the **delegator SA**; `principal` after a bound
  verify is unchanged (`delegation.delegator`).
- **DEL-001-INV-3:** one leaf per session, signed by the SA's live credential at connect; never per
  token, never an on-chain tx on the read path.
- **DEL-001-INV-4:** the SA address is invariant across credential rotation (ADR-0011); leaf validity
  follows the SA's *current* credential set, fail-closed.
- **DEL-001-INV-5:** FedCM contributes identity only; the leaf is signed by the SA credential, never by
  the FedCM assertion.
