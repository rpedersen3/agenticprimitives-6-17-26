# `@agenticprimitives/delegation` — Security & Architecture Audit

**Status:** alpha
**Last refreshed:** 2026-06-01 (R9 substrate coverage references + R11.1 fail-hard audit + R11.3 public-surface cleanup)
**Prior refresh:** 2026-05-20
**Owners:** delegation package CODEOWNERS
**System audit cross-reference:** [docs/architecture/product-readiness-audit.md](../../docs/architecture/product-readiness-audit.md)

## R9 substrate coverage (2026-06-01)

- **Heavy R9 substrate coverage** + R11.1 audit-contract changes:
  - R9.2 DelegationManager Foundry stateful invariants (`packages/contracts/test/invariant/DelegationManager.invariant.t.sol` — 5 × 25,600 calls): revocation irreversibility, hash determinism, DOMAIN_SEPARATOR immutability, ROOT_AUTHORITY + OPEN_DELEGATION constants unchanged, revoked-set monotonic.
  - R1 / H7-D.9 closure: cross-stack EIP-712 typehash equality test at `packages/delegation/test/integration/cross-stack-typehashes.test.ts` (6 tests) — now surfaced as a CI gate via `pnpm check:eip712-typehash-equality` (R11.4).
  - **R11.1 fail-hard audit propagation.** `mintDelegationToken` + `verifyDelegationToken` (3 sites) had their wrapper-level `try/catch` removed; sink composition now determines fail-hard vs fail-soft. Tests: `packages/delegation/test/unit/token.test.ts::R11.1: a throwing audit sink PROPAGATES`.
- See [audit-evidence-index.md § 3.1 + § 4](../../docs/audits/audit-evidence-index.md).

## 1. Charter

The keystone authorization package. Owns: the `Delegation` data shape, the
canonical EIP-712 domain + types + hash, caveat builders + the
deterministic evaluator, `SessionManager` lifecycle (session keypair
generation → envelope-encryption via `key-custody` → AAD-bound storage →
package + revocation), and the `DelegationToken` mint/verify path the
A2A→MCP boundary depends on. Imports `types`, `connect-auth`,
`agent-account`, `key-custody`.

What this package does NOT own (per its `CLAUDE.md`):

- JWT session cookies (those live in `connect-auth`).
- Concrete KMS backends (`key-custody`).
- Tool execution / MCP transport (`mcp-runtime`).
- The smart account itself (`agent-account`).
- Tool classification / risk-tier policy (`tool-policy`).

## 2. Security invariants (DO NOT BREAK)

1. **EIP-712 domain + struct hash MUST match the on-chain `DelegationManager`**
  *bit-for-bit*. Off-by-one in name / version / chainId / verifyingContract
   means consumers sign one thing while the chain expects another →
   ERC-1271 verification silently fails OR (much worse) accepts the
   wrong message.
   Tests: `test/unit/hash.test.ts` (8 tests, includes domain-separator
   golden values). **Gap:** no cross-language test that derives the same
   digest from a Solidity helper.
2. **Caveats are fail-closed.** Unknown enforcer → reject. Failed
  evaluator call → reject. Test: `test/unit/evaluator.test.ts:14` cases.
   Reference: `evaluateCaveats(opts.failClosed=true)` (the default).
3. **JTI is bound to a delegation + minted-once.** The MCP-side store
  must atomically `INSERT ... ON CONFLICT ... RETURNING` so a replay
   loses the race. Test: `test/unit/token.test.ts`, plus
   `mcp-runtime/test/unit/jti-stores.test.ts`.
4. **Revocation read must be fail-closed in production mode.** If the
  on-chain `isRevoked(delegationHash)` read throws, `verifyDelegationToken`
   today catches and continues (`src/verify.ts` ~line 250). System audit
   **H3** open — must be gated on `NODE_ENV` or an explicit `failClosed`
   flag.
5. `**requireDeployed: true` is the default.** A counterfactual delegator
  account whose code isn't on-chain cannot satisfy ERC-1271, so
   `verifyDelegationToken` must refuse unless the caller explicitly
   opted into `requireDeployed: false` (which is a demo-only path).
6. **Session manager AAD binding.** The session-key envelope is
  `key-custody`-encrypted with an AAD derived via
   `canonicalContextBytes()` from `key-custody`. Decryption with the
   wrong AAD → AEAD failure. Test: `test/integration/session-manager.test.ts`.
7. **Token verifier MUST consult the on-chain delegation chain** —
  `ROOT_AUTHORITY` is the only delegator whose signature is the root.
   No partial-chain shortcut.

## 3. Public API surface (audit scope)


| Symbol                                                                                              | Kind             | Trust boundary                                                                       |
| --------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------ |
| `ROOT_AUTHORITY`                                                                                    | const            | Sentinel address used as the root of every chain — must equal the on-chain constant. |
| `Delegation`, `DelegationToken`, `Caveat`, `SessionRow`                                             | types            | Wire-format types; consumers serialise/deserialise across HTTP.                      |
| `hashDelegation`, `hashCaveats`, `DELEGATION_EIP712_TYPES`, `delegationDomain`                      | functions/consts | Off-chain digest — must match Solidity.                                              |
| `evaluateCaveats`                                                                                   | function         | Deterministic policy decision; fail-closed default.                                  |
| `buildCaveat`, `buildMcpToolScopeCaveat`, `encodeTimestampTerms`, `encodeAllowedTargetsTerms`, etc. | builders         | Produce wire-format terms for known enforcers.                                       |
| `DelegationClient`                                                                                  | class            | Signs delegations off-chain.                                                         |
| `SessionManager`, `createMemorySessionStore`                                                        | class / factory  | Session lifecycle + envelope encryption.                                             |
| `mintDelegationToken`, `verifyDelegationToken`, `verifyCrossDelegation`                             | functions        | Token mint/verify; the A2A↔MCP trust boundary.                                       |
| `isRevoked`, `revokeDelegation`                                                                     | functions        | On-chain revocation surface.                                                         |


## 4. Threat model


| Threat                                     | Likelihood              | Impact                                             | Mitigation                                           | Status                                    |
| ------------------------------------------ | ----------------------- | -------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------- |
| EIP-712 domain drift between TS + Solidity | Low                     | Critical (silent verify failure or false-positive) | Golden hash tests; spec 202; on-chain CI cross-check | **Gap:** no automated cross-check; TODO   |
| Replay of delegation token                 | Medium                  | High (unauthorized tool call after expiry)         | JTI atomic-insert in MCP store                       | Covered (jti-stores tests)                |
| Revocation read failure swallowed          | High (RPC flake)        | High (revoked delegation accepted)                 | TODO: NODE_ENV gate (H3)                             | **Open: H3 (system)**                     |
| Counterfactual account spoofed             | Low (validator handles) | High                                               | `requireDeployed=true` default + universal validator | Covered                                   |
| Caveat parser parses unknown enforcer      | Medium                  | High (policy bypass)                               | Fail-closed on unknown selector                      | Covered (`evaluator.ts`)                  |
| AAD mismatch on session decrypt            | Low                     | Low (decryption fails closed)                      | AEAD tag verification                                | Covered                                   |
| Session key leakage at rest                | Medium                  | High                                               | Envelope encryption via `key-custody`                | Covered, depends on KMS provider strength |
| Cross-delegation forgery                   | N/A                     | High when shipped                                  | Currently stub; **H5** open                          | **Not implemented**                       |


## 5. Findings (open)


| ID              | Severity | Finding                                                                          | Status     | Notes                                                                                                                             |
| --------------- | -------- | -------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **H3** (system) | P1       | Revocation check tolerates RPC failure.                                          | **CLOSED 2026-05-20** | New `revocationFailMode: 'closed' \| 'open'` opt; defaults by `NODE_ENV`. Production hard-fails on RPC outage. |
| **C3** (system) | P0       | No audit events from delegation verify.                                          | **MOSTLY CLOSED 2026-05-20** (passes 3b + 5b) | `verifyDelegationToken` emits `delegation.verify.{accept,reject}` per call (pass 3b). `mintDelegationToken` emits `delegation.mint` (pass 5b — `subject: { type: 'jti', id: jti }`, `audience` populated, fail-soft on sink errors, tests in `token.test.ts`). `revokeDelegation` emission remains as a follow-up but is lower-priority since revocation is a one-time admin op. |
| **H5** (system) | P1       | Cross-delegation is not implemented.                                             | Open       | `verifyCrossDelegation` returns not-implemented; `withCrossDelegation` (in mcp-runtime) similarly stub.                           |
| ~~**N16** (system)~~ | ~~P2~~ | ~~Smart-account multi-sig + recovery policy not productized.~~ | **MOSTLY CLOSED 2026-05-20** (phase 6c.3-b) | This package's slice: `buildQuorumCaveat({enforcer, signers, threshold, approvedHashRegistry})` peer of the existing caveat builders, with validation (non-empty signers, threshold ∈ [1, signers.length], threshold ≤ 255). `verifyDelegationToken` gains two threshold-policy gates: `requireQuorumCaveat?: { enforcer }` (fails closed when delegation lacks the named quorum caveat) + `requireAcceptedOnChain?: boolean` (chain-reads `account.isAcceptedSessionDelegation(hash)` for spec § 6 high-risk gate). Audit emit's accept row gains a new `context.acceptedOnChain` boolean. 6 new buildQuorumCaveat unit tests; 63 total in delegation. |
| **DEL-1**       | P2       | No automated cross-language hash check.                                          | Open       | Need a Forge test or Anvil helper that derives `hashDelegation` from Solidity and compares to a TS golden. Prevents domain drift. |
| **DEL-2**       | P3       | `verifyDelegationToken` error messages may leak chain state to external callers. | Open       | E.g. `"delegator smart account ... is not deployed"` reveals address state. Consider opaque external error + internal log.        |
| **DEL-3**       | P3       | Memory session store is process-local.                                           | Documented | `createMemorySessionStore()` is test-only; production must use Durable Object or D1. Linked to system L2.                         |
| **DEL-4**       | P2       | MetaMask DTK alignment audit + caveat parity inventoried 2026-05-21.             | **MOSTLY CLOSED** | [`docs/architecture/dtk-alignment-audit.md`](../../docs/architecture/dtk-alignment-audit.md) ships the parity inventory. [`docs/architecture/enforcer-registry/enforcers.json`](../../docs/architecture/enforcer-registry/enforcers.json) is the machine-readable registry CI walks. Per-enforcer audits at `packages/contracts/src/enforcers/<Name>.AUDIT.md`. Remaining work: spec 208 ArgumentRuleEnforcer (planned), RateLimitEnforcer port (phase 7), interop fixture corpus (phase 7). |
| **DEL-5**       | P1       | SDK exports 3 sentinel-only enforcers (`MCP_TOOL_SCOPE_ENFORCER`, `DATA_SCOPE_ENFORCER`, `DELEGATE_BINDING_ENFORCER`) pointing at non-deployed addresses; would revert at redeem. | Open      | Detected by `pnpm check:sentinel-enforcers` CI rail (phase 6b.1). Cleanup options: (a) ship the corresponding contracts (port from smart-agent for `MCP_TOOL_SCOPE`, `DATA_SCOPE`; await H5 cross-delegation work for `DELEGATE_BINDING`), or (b) remove from SDK exports. Tracked in [`enforcer-registry/enforcers.json`](../../docs/architecture/enforcer-registry/enforcers.json) with `status: sentinel-footgun`. |


## 6. Test posture

- **Unit:** 7 files, 57 tests passing as of 2026-05-20:
`caveats.test.ts` (13), `delegation-client.test.ts` (3), `evaluator.test.ts`
(14), `hash.test.ts` (8), `token.test.ts` (6 — pass 5b adds
delegation.mint audit-emit + fail-soft sink tests),
`verify-require-deployed.test.ts` (5), `session-manager.test.ts`
(8 integration).
- **Cross-package:** consumed by `mcp-runtime` (`with-delegation.ts`),
`apps/demo-a2a` (session/init + session/package), `apps/demo-web`
(signing). Integration coverage via Playwright specs `03-authorize-agent`
  - `04-read-profile` + `05-passkey-login`.
- **Forge tests (consumer-side):** `packages/contracts/test/DelegationManager.t.sol`
exercises the on-chain side.
- **Gaps:**
  - No property test for caveat evaluation (system M4 + should-fix-before-beta).
  - No cross-language hash check (DEL-1).
  - No negative test for `verifyCrossDelegation` shape (H5 — stub is fine until implementation lands).
  - No deployed smoke test of the full A2A→MCP delegation chain (system N5).

## 7. Hardening backlog

- **(H3)** Gate the `isRevoked` swallowed-error path on `NODE_ENV !== 'production'`. Add `failClosed: true` opt to `verifyDelegationToken`. Top-5 pass.
- **(DEL-1)** Add a Forge test that calls `hashDelegation` (on-chain) and compares to a TypeScript golden vector exported from this package's tests.
- **(DEL-2)** Audit external error messages from `verifyDelegationToken` for chain-state leakage.
- **(H5)** Design + implement `verifyCrossDelegation` with negative tests; coordinate with `mcp-runtime/with-cross-delegation.ts`.
- **(system M4)** Add property tests for `evaluateCaveats` over a random caveat-set generator.
- **(system C3)** ~~Emit audit events from `mintDelegationToken`~~ (pass 5b), ~~`verifyDelegationToken`~~ (pass 3b). `revokeDelegation` emission remains — lower priority.
- **(DEL-4 follow-up)** Ship `ArgumentRuleEnforcer` (spec 208) — closes the biggest cluster of DTK gaps in one contract. Add DTK-shape interop fixture corpus (~10 fixtures, one per shipped enforcer) at `packages/contracts/test/interop/dtk-fixtures/` to prove the "byte-identical" claim from the audit.
- **(DEL-5)** Resolve sentinel-only enforcers — either ship contracts or remove SDK exports. Lint rail prevents new ones from slipping in.

## 8. External audit readiness

An external auditor evaluating this package needs:

- `pnpm build` + `pnpm test` (vitest) green
- `specs/202-delegation.md` (the spec)
- This audit doc
- The system audit (`docs/architecture/product-readiness-audit.md`)
- The `evaluator.ts` + `verify.ts` + `token.ts` + `session-manager.ts` source — these are where security invariants live
- The on-chain `DelegationManager.sol` + EIP-712 domain to cross-check
- Open findings list (above) + system audit findings cross-referenced

## 9. Accepted limitations / scope exclusions

- Does NOT implement KMS / signer concretions; consumes `Signer` interface from `connect-auth` and persistence backends from `key-custody`.
- Does NOT define the wire format of MCP requests; that's `mcp-runtime`.
- Does NOT enforce policy tiers — that's `tool-policy` (consumed inside `mcp-runtime`).
- Does NOT issue JWT sessions for user identity; that's `connect-auth`.
- Forbidden imports: `apps/`*, `mcp-runtime`, `tool-policy` (would create back-edges).

