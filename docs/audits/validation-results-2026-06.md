# Validation Results — June 2026 Public Self-Audit

| Field | Value |
|---|---|
| Status | Captured |
| Packet | [`self-audit-2026-06.md`](./self-audit-2026-06.md) |
| Date opened | 2026-06-03 |
| Commit | `a2ebfa05e882c4f16ee7c238bd18994352cd650e` + working-tree packet updates |

## How To Read This File

This ledger records validation evidence for the public self-audit packet. Each row should contain the exact command, commit, date, result, and notes. When a command is too expensive to run locally during a packet refresh, link to the retained CI artifact instead.

## Local Validation Run

| Command | Date | Commit | Result | Notes |
|---|---|---|---|---|
| `pnpm check:all` | 2026-06-03 | `a2ebfa0` + packet changes | Pass | Doctrine gate passed: manifests, docs, boundaries, dependency graph, public exports, context budget, forbidden terms, no app private keys, no deployment domains in packages, cross-cutting capabilities, sentinel enforcers, supply chain. |
| `pnpm -r test` | 2026-06-03 | `a2ebfa0` + packet changes | Pass (packages); **e2e blocked on Node 20 ONLY** | All package unit + integration suites pass (after the root Vitest config fix). The ONLY thing that does not run is `tests/e2e`, which never executes because Wrangler requires Node `>=22.0.0` and this run used Node `v20.18.2`. This is an environment limitation scoped to the **Wrangler-based e2e suite only** — it does NOT affect package tests or any contract/doctrine gate. Re-run under Node 22 (`nvm use 22`) for the full e2e pass. |
| `pnpm check:contracts` | 2026-06-03 | `a2ebfa0` + packet changes | Pass | Corrected root script now targets `@agenticprimitives/contracts`; Forge result: 54 suites, 710 tests passed, 0 failed. |
| `pnpm check:contracts-lint` | 2026-06-03 | `a2ebfa0` + packet changes | Pass | Solhint passed. Local update-check warning: `getaddrinfo EAI_AGAIN registry.npmjs.org`; command exit 0. |
| `pnpm check:contracts-halmos` | 2026-06-03 | `a2ebfa0` + packet changes | Pass | Halmos result: 7 symbolic proofs passed, 0 failed. |
| `pnpm check:forge-coverage` | 2026-06-03 | `a2ebfa0` + packet changes | Pass | Coverage floor gate passed after adding AttestationRegistry branch tests. `AttestationRegistry.sol`: 84.6% lines / 47.8% branches. |
| `pnpm check:storage-layouts` | 2026-06-03 | `a2ebfa0` + packet changes | Pass | AgentAccount, CustodyPolicy, DelegationManager, SmartAgentPaymaster layouts match snapshots. |
| `pnpm check:eip712-typehash-equality` | 2026-06-03 | `a2ebfa0` + packet changes | Pass | TS-side typehashes equal Solidity-side constants. |
| `pnpm check:supply-chain` | 2026-06-03 | `a2ebfa0` + packet changes | Pass | `pnpm audit` clean after allowlist; local `gitleaks` skipped because not installed, CI runs it on every PR. |

## CI / Long-Running Evidence

| Tool | Source | Status |
|---|---|---|
| Echidna | `.github/workflows/contracts-echidna-nightly.yml` | Artifact-only nightly; link latest retained artifact before public announcement. |
| Medusa | `.github/workflows/contracts-medusa-weekend.yml` | Artifact-only weekend; link latest retained artifact before public announcement. |
| Slither | `.github/workflows/security.yml` | PR-blocking on HIGH findings; triage in [`r9-static-analysis-triage.md`](./r9-static-analysis-triage.md). |
| Aderyn | `.github/workflows/security.yml` | Advisory artifact; triage in [`r9-static-analysis-triage.md`](./r9-static-analysis-triage.md). |
| CodeQL | `.github/workflows/security.yml` | Security workflow artifact / code scanning result. |
| SBOM | `.github/workflows/security.yml` and release workflow | Retained workflow artifact / release asset. |

## Known Validation Caveats

- `Echidna` and `Medusa` are deliberately artifact-only until the project promotes them to release or PR blockers.
- N1 remains open until clean governance/key rotation is executed; validation can only confirm that preflight detects the disclosed demo key.
- The WebAuthn authenticator-data length finding (EXT-3) is **CLOSED** — the runtime check already exists. The on-chain verifier rejects short `authenticatorData`: `WebAuthnLib.sol:91` (`if (authData.length < 37) return false;`), locked by the regression test `test/libraries/WebAuthnLib.t.sol:93 test_rejects_authData_too_short`. Verified **no second verification path bypasses it**: `connect-auth` is a ceremony helper (it BUILDS the assertion the contract verifies and PARSES registration to extract the pubkey), NOT a signature verifier — and even its parse path bounds-checks (`packages/connect-auth/src/methods/passkey.ts` `parseAuthData`: `if (authData.length < 37) throw` + the attested-credential-data guard). `WebAuthnLib` is the sole signature verifier.
- Full recursive **e2e** validation requires Node 22 (the Wrangler dev server refuses Node 20). This blocks the **e2e suite ONLY** — package unit/integration tests and all contract gates (Forge 710 tests, Halmos, coverage, storage-layouts, eip712-typehash, supply-chain) pass under Node 20. Re-run `tests/e2e` under Node 22 for the full pass.
