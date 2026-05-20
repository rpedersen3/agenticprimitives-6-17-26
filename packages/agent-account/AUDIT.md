# `@agenticprimitives/agent-account` — Security & Architecture Audit

**Status:** alpha
**Last refreshed:** 2026-05-20
**Owners:** agent-account package CODEOWNERS
**System audit cross-reference:** [docs/architecture/product-readiness-audit.md](../../docs/architecture/product-readiness-audit.md)

## 1. Charter

The ERC-4337 smart-account substrate. Owns: `AgentAccountClient`
(deterministic CREATE2 address derivation, `isDeployed`, ERC-1271
signature verification via `isValidSignature`, UserOp building +
deploy-via-paymaster), `BundlerClient` (UserOp hash + `handleOps`
submission), the EntryPoint + Factory ABI fragments, and the on-chain
**WebAuthn signature wire format** (`0x01 ‖ abi.encode(Assertion)` —
`webauthn-signature.ts`).

Account-agnostic of which signer signs — consumers pass an
`identity-auth.Signer` (EOA via viem, KMS via key-custody, or
PasskeySigner from demo-web) and this package builds the wire format
the on-chain `AgentAccount._validateSig` dispatch consumes.

What this package does NOT own (per its `CLAUDE.md`):
- Auth methods or signer concretions (`identity-auth`).
- KMS backends (`key-custody`).
- Delegation primitives (`delegation`).
- Paymaster policy ("which paymaster when").
- Solidity source — addresses by config only.

## 2. Security invariants (DO NOT BREAK)

1. **CREATE2 address math equals the on-chain factory.** The TS
   `getAddress` / `getAddressForPasskey` go through the factory's view
   functions rather than re-implementing the CREATE2 derivation, so TS
   and Solidity stay in lock-step by construction. Test:
   `test/unit/agent-account-client.test.ts`, plus Forge
   `AgentAccountFactory.t.sol`.
2. **`SIG_TYPE_WEBAUTHN = 0x01`** must match the on-chain
   `AgentAccount._validateSig` dispatch byte. Test: agent-account
   `webauthn-signature.test.ts` (6) + Forge `AgentAccount.t.sol`
   passkey tests (7).
3. **`encodeAssertion` does NOT prepend the type byte; `encodeWebAuthnSignature` does.** Easy to confuse; consumers MUST use the
   wrapped form. Test: `webauthn-signature.test.ts` line "does NOT
   prepend the SIG_TYPE byte".
4. **Counterfactual addresses MUST be derivable without on-chain
   deploy.** `getAddress` / `getAddressForPasskey` are view calls;
   `isDeployed` is the explicit deployment check.
5. **UserOp built here MUST validate on-chain.** `buildDeployUserOp` +
   `buildDeployUserOpWithPasskey` are responsible for setting gas limits
   that survive EntryPoint validation. The passkey path uses 1.2M
   verificationGasLimit ceiling — covers anvil's Daimo P-256 fallback;
   intersects system **N4** for waste on RIP-7212 chains.
6. **EntryPoint version drift is explicit.** `entryPointAbi` is v0.9.
   Address comes from caller config — cross-version drift is a
   migration gate, not a runtime fallthrough.
7. **The bundler helper is KMS-callable.** `BundlerClient.sendUserOps`
   accepts a viem account; the demo passes a `createKmsViemAccount`
   wrapping a GCP-KMS signer. No private key locally.

## 3. Public API surface (audit scope)

| Symbol | Kind | Trust boundary |
| --- | --- | --- |
| `AgentAccountClient` | class | Deterministic addressing, ERC-1271, UserOp building. |
| `AgentAccountClientOpts`, `CreateAgentAccountParams` | types | Configuration shape (rpc, factory, entryPoint). |
| `UserOperation`, `Address`, `Hex` | types | UserOp wire shape. |
| `BundlerClient`, `packGasLimits`, `unpackGasLimits` | class / helpers | UserOp hashing + `handleOps` submission. |
| `BundlerClientOpts`, `PackedUserOperation` | types | Wire shape. |
| `entryPointAbi` | const | EntryPoint v0.9 ABI fragments. |
| `SIG_TYPE_WEBAUTHN`, `encodeAssertion`, `encodeWebAuthnSignature` | const / fns | On-chain WebAuthn signature wire format. |

Subpath imports allowed by manifest:
- `@agenticprimitives/identity-auth` (Signer types only — per CLAUDE.md)
- `@agenticprimitives/identity-auth/passkey` (the `WebAuthnAssertion` type)

## 4. Threat model

| Threat | Likelihood | Impact | Mitigation | Status |
| --- | --- | --- | --- | --- |
| TS vs Solidity address derivation drift | Low | Critical (wrong account address → signature verifies against nothing) | Use factory view, not local CREATE2 | Covered |
| Wrong SIG_TYPE byte (0x00 vs 0x01) | Low | High (signature dispatch fails) | Forge tests cross-check the on-chain dispatch | Covered |
| Insufficient `verificationGasLimit` for first deploy | Medium | High (AA31, UserOp rejected) | 1.2M default; documented for chain config | Per-chain config (**N4**) recommended |
| Pre-fund overhead drains paymaster | High at scale | High (system N3) | Lower per-chain verifGas + paymaster monitoring | **Open: N3 + N4** |
| EntryPoint version mismatch | Low | High (everything breaks) | Address by config; explicit migration | Covered |
| KMS bundler key compromise | Low | High (malicious handleOps submission) | Key in GCP KMS; algorithm guard; SA scoped | Inherited from `key-custody`; **M5** open |

## 5. Findings (open)

| ID | Severity | Finding | Status | Notes |
| --- | --- | --- | --- | --- |
| **N4** (system) | P2 | `verificationGasLimit: 1.2M` ceiling is wasteful on RIP-7212 chains. | Open | Per-chain config: 400-500k on Base, 1.2M on anvil. |
| **AA-1** | P3 | `buildUserOp()` for arbitrary calls throws. | Open | Documented "out-of-scope for v0 demo"; only deploy + ERC-1271 implemented. Tracks original audit's `agent-account` "gaps". |
| **AA-2** | P3 | `walletFromSigner` is a placeholder. | Open | `createAccount` path uses raw private key; `createAccountFromAccount` is the real production path (viem account). |
| **AA-3** | P3 | No spec for the `WebAuthnAssertion` ABI shape outside of source comments + `apps/contracts/src/libraries/WebAuthnLib.sol`. | Open | Reference: `webauthn-signature.ts:8-15`. Should land in `specs/201-agent-account.md`. |

## 6. Test posture

- **Unit:** 6 files, 40 tests as of 2026-05-20:
  `abis.test.ts` (4), `agent-account-client.test.ts` (8),
  `bundler-client.test.ts` (9), `create-account-from-pk.test.ts` (3),
  `deploy-via-paymaster.test.ts` (10), `webauthn-signature.test.ts` (6).
- **Forge tests (on-chain cross-checks):** `apps/contracts/test/AgentAccount.t.sol` (16), `AgentAccountFactory.t.sol` (24),
  `UniversalSignatureValidator.t.sol` (9), `SmartAgentPaymaster.t.sol`. These prove the TS wire format + addressing match Solidity.
- **E2E:** Playwright `02-siwe-login.spec.ts` exercises ERC-1271 verification through the universal validator; `05-passkey-login.spec.ts` exercises `buildDeployUserOpWithPasskey` + `encodeWebAuthnSignature` end-to-end against anvil.
- **Live smoke:** demo-a2a `/health` returns the live factory address. Manually verified after each `pnpm deploy:cloudflare`.
- **Gaps:**
  - No system test that derives TS + Solidity address values for the same inputs in a CI step (system **M4**).
  - No public-API type-lock (`expectTypeOf` or `@arethetypeswrong`) — system **M4**.
  - No load test for `BundlerClient.sendUserOps` (latency / retry behavior under RPC pressure).

## 7. Hardening backlog

- [ ] **(N4)** Add per-chain `verificationGasLimit` config; default to 400k on chains with RIP-7212 (Base/Optimism/Arbitrum/etc.), 1.2M elsewhere.
- [ ] **(AA-3)** Add the WebAuthn assertion ABI shape to `specs/201-agent-account.md`.
- [ ] **(AA-1)** Either implement `buildUserOp()` for arbitrary calls or remove from public API surface.
- [ ] **(system M4)** Add a Forge → TS hash equivalence test as part of CI.
- [ ] **(system C3)** Emit audit events on UserOp build + submit (with userOpHash + initCode signature) for forensics.

## 8. External audit readiness

An external auditor evaluating this package needs:

- `pnpm build` + `pnpm test` (40 tests)
- `forge test` against `apps/contracts/test/AgentAccount*` (proves Solidity↔TS cross-check)
- `specs/201-agent-account.md`
- This audit doc + system audit
- Source: `client.ts` (deploy + ERC-1271), `bundler-client.ts` (UserOp submission), `webauthn-signature.ts` (wire format), `abis.ts` (EntryPoint + Factory + Account ABI fragments + FailedOp error decoding)
- Live deployment addresses (current `cloudflare-urls.json`)
- Cross-reference: `apps/contracts/src/AgentAccount.sol` (the actual Solidity dispatch logic)

## 9. Accepted limitations / scope exclusions

- Does NOT own paymaster policy — `paymaster` is a parameter on `buildDeployUserOp*`.
- Does NOT own auth methods — consumes `Signer` interface from `identity-auth`.
- Does NOT own delegation. Forbidden imports: `delegation`, `key-custody`, `tool-policy`, `mcp-runtime`.
- Does NOT ship Solidity source — addresses are provided by config (the demo contracts live in `apps/contracts/`).
- v0 demo arbitrary-call `buildUserOp` is unimplemented (AA-1).
