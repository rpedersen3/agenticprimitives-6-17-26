# Spec 110 — Test Strategy

**Status:** v0 draft · 2026-05-19
**Depends on:** [`100-package-boundary-doctrine.md`](./100-package-boundary-doctrine.md), [`102-manifest-and-claude-md-template.md`](./102-manifest-and-claude-md-template.md)
**Purpose:** define how every layer of agenticprimitives is tested, where each test lives, and how a developer (or Claude) picks the right layer for a given change.

This document is the answer to "what does 'tested' mean for this product, and how do I run only the tests I need?"

---

## 1. Why a layered strategy

A primitives library has multiple distinct correctness questions and they need different tools:

- **Does this pure function produce the right output?** → unit test
- **Do these primitives compose without lying to each other?** → integration test
- **Does the Solidity behave as intended under adversarial input?** → forge test
- **Does the TS package match the deployed contract's calling convention?** → system test against Anvil
- **Does the user-visible flow work in a browser?** → Playwright
- **Did the deployed environment break since last release?** → smoke test

Picking one tool (e.g., Playwright for everything) means slow CI, fragile failures, and bad signal-to-noise. Picking the right tool per layer means fast iteration with high confidence.

This strategy is informed by:
- **smart-agent's actual layout** (our source): Node native test runner + per-app `test/` dirs + Foundry tests in `packages/contracts/test/` + Playwright in `tests/e2e/`.
- **Industry patterns**: Vitest is the modern default for TS libraries (Coinbase AgentKit, Lit, MetaMask DTK ecosystem). Forge for contracts. Playwright for E2E. @fast-check for property tests on security-critical code.

We adapt smart-agent's structure but **swap Node native test runner for Vitest** because Vitest gives us watch mode, focused-test ergonomics, snapshot tests, and type-aware assertions — all of which matter for incremental development.

---

## 2. The seven layers

```
                                           Speed     Tool        Where
─────────────────────────────────────────────────────────────────────────────
Layer 1  Per-package unit tests           < 1s      Vitest      packages/X/test/unit/
Layer 2  Per-package integration tests    < 5s      Vitest      packages/X/test/integration/
Layer 3  Cross-package integration        < 30s     Vitest      tests/integration/
Layer 4  Solidity contract tests          < 30s     Forge       apps/contracts/test/
Layer 5  System tests (Anvil)             < 1min    Vitest      tests/system/
Layer 6  E2E tests (UI flows)             < 3min    Playwright  tests/e2e/
Layer 7  Smoke tests (deployed env)       < 30s     Playwright  tests/smoke/    (optional)
```

### Layer 1 — Per-package unit tests

**Tests:** pure functions in one package. No I/O, no network, no chain.

**Examples:**
- `key-custody`: `LocalAesProvider` round-trip; `canonicalContextBytes` produces deterministic bytes; `LocalSecp256k1Signer` produces a 65-byte signature.
- `delegation`: caveat builders produce expected ABI-encoded bytes; `hashDelegation` produces a golden hash for a fixture; `evaluateCaveats` is fail-closed under unknown enforcer.
- `tool-policy`: `evaluatePolicy` golden table; `matchesExactCall` byte-identity.

**Layout:**
```
packages/key-custody/
├── src/
└── test/
    ├── unit/
    │   ├── aad.test.ts
    │   ├── local-aes-provider.test.ts
    │   ├── local-secp256k1-signer.test.ts
    │   └── canonical-context.test.ts
    └── fixtures/
        └── golden-hashes.json
```

**Runner:** Vitest. Each package has its own `vitest.config.ts` extending a root config.

**Invocation:**
```bash
pnpm --filter @agenticprimitives/key-custody test          # all tests in one package
pnpm --filter @agenticprimitives/key-custody test --watch  # watch mode
pnpm test:unit                                             # all packages, unit only
```

### Layer 2 — Per-package integration tests

**Tests:** multi-module flows **within one package**. Use real crypto, in-memory stores.

**Examples:**
- `key-custody`: full data-key wrap → unwrap with AAD tampering trip-wire.
- `delegation`: `DelegationClient.issueDelegation` + `verifyDelegationToken` round-trip with a mocked ERC-1271 signer.
- `mcp-runtime`: `withDelegation` wrapping a stub handler, exercised by `MockDelegationSigner`.

**Layout:** `packages/X/test/integration/`.

**Invocation:**
```bash
pnpm test:integration:packages       # all packages, integration only
```

### Layer 3 — Cross-package integration

**Tests:** flows that touch **multiple packages**. Still no chain, no UI.

**Examples:**
- `delegation.SessionManager` (real) + `key-custody.LocalAesProvider` (real) full round trip.
- `mcp-runtime.withDelegation` + `tool-policy.evaluatePolicy` end-to-end with a mocked store.

**Layout:** `tests/integration/<area>.test.ts`.

**Invocation:**
```bash
pnpm test:integration
```

### Layer 4 — Solidity contract tests

**Tests:** the on-chain code in `apps/contracts/`. Forge invariants, fuzz tests, unit tests.

**Examples:**
- `AgentAccount.t.sol` — ERC-1271 `isValidSignature` round trips for all owner / passkey paths.
- `DelegationManager.t.sol` — `redeemDelegation` rejects revoked, accepts well-formed.
- `TimestampEnforcer.t.sol` — fuzz with random `validAfter` / `validUntil` combinations.

**Layout:** `apps/contracts/test/*.t.sol`. Smart-agent has ~30 forge test files; we can selectively port the ones for our vendored contracts.

**Invocation:**
```bash
pnpm test:contracts            # forge test
pnpm --filter @agenticprimitives-demo/contracts test
forge test --match-test specific_test_name    # focused
```

### Layer 5 — System tests (Anvil-backed)

**Tests:** TS packages exercising real deployed contracts. Confirms the calling convention between TS and Solidity matches.

**Examples:**
- `agent-account.AgentAccountClient.getAddress` matches `AgentAccountFactory.getAddress` on Anvil.
- `delegation.verifyDelegationToken` calls `DelegationManager.isRevoked` correctly.

**Layout:** `tests/system/<area>.test.ts`. The vitest `globalSetup` boots Anvil + runs the deploy script.

**Invocation:**
```bash
pnpm test:system
```

### Layer 6 — E2E (Playwright)

**Tests:** user-visible flows in the demo. One spec file per feature, runnable independently.

**Examples:**
- `tests/e2e/01-demo-user.spec.ts` — mnemonic generation + persistence.
- `tests/e2e/02-siwe-login.spec.ts` — Sign in click → session cookie set → smart account address rendered.
- `tests/e2e/03-authorize-agent.spec.ts` — Issue delegation → session active in UI.
- `tests/e2e/04-read-profile.spec.ts` — Read profile via agent → PII rendered.

**Layout:** `tests/e2e/*.spec.ts`. Playwright's `webServer` config chains anvil + contracts deploy + demo apps. Each spec is isolated; failure in one doesn't cascade.

**Invocation:**
```bash
pnpm test:e2e                              # all e2e specs
pnpm test:e2e -- 02-siwe-login              # one spec
pnpm test:e2e --ui                          # interactive debug UI
pnpm test:e2e --debug                       # step through
```

### Layer 7 — Smoke (deployed) — optional

**Tests:** verify the deployed Vercel/Fly environment is responding. Sparse; just enough to catch "did the deploy break."

**Layout:** `tests/smoke/*.spec.ts`. Defer until we have a deployed env.

---

## 3. Test runner choices

| Concern | Choice | Why |
| --- | --- | --- |
| TS unit + integration + system | **Vitest** | Modern; watch mode; type-aware; works inside pnpm workspaces. Coinbase AgentKit, Lit, many others use it. |
| Solidity | **Forge** | Industry standard. Smart-agent's existing tests are forge-shaped. |
| E2E UI | **Playwright** | Better than Cypress for cross-browser; built-in trace viewer; smart-agent already uses it. |
| Property/fuzz (TS) | **@fast-check** | Standard TS property-test lib. Use it in `delegation` (caveat eval), `tool-policy` (decision engine), `key-custody` (AAD bind). |
| Type contracts | **expect-type** (or **tsd**) | Locks public API shape. If `manifest.publicExports` says `verifyDelegationToken: (token, opts) => Promise<{...}>`, a type-test pins that signature. |

---

## 4. Vitest configuration

A root `vitest.config.ts` defines defaults; each package's `vitest.config.ts` extends it. Per-package configs let us:

- Run one package's tests in watch mode without other packages' overhead.
- Set per-package coverage thresholds.
- Mark some packages as no-test (e.g., `types` is types-only).

```ts
// Root: vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    include: ['test/**/*.test.ts'],
    setupFiles: [],
    coverage: { provider: 'v8', reporter: ['text', 'json-summary'] },
  },
});
```

Each package has a stub `vitest.config.ts` that extends and may add per-package setup (e.g., delegation might pre-build golden hashes).

---

## 5. Per-package test budget

Per the boundary doctrine: each package is an agent-loadable unit. Tests are part of that unit's contract.

- Every public export listed in `manifest.publicExports` SHOULD have at least one unit test.
- Every security invariant in `CLAUDE.md` SHOULD have at least one property or golden test (e.g., `delegation`'s "caveat evaluator MUST be fail-closed" invariant becomes a property test).
- Coverage is NOT a goal in itself, but if a public function has 0 tests, that's a doctrine smell.

`scripts/check-test-coverage.ts` (future): given a package, verifies every `publicExports` symbol appears in at least one `test/**/*.test.ts` import.

---

## 6. CI ordering (fast-fail first)

```
1. pnpm typecheck                              ~10s
2. pnpm check:all                              ~5s
3. pnpm test:unit (all packages, parallel)     <30s
4. pnpm test:integration:packages              <60s
5. pnpm test:contracts (forge test)            <60s
6. pnpm test:integration                       <60s
7. pnpm test:system                            <90s
8. pnpm test:e2e                               <5min
9. pnpm test:smoke (deployed, optional)        <30s
```

Total target: green CI under **8 minutes** for a clean run.

A developer's `pnpm test` runs layers 1-4 by default (~3 minutes). E2E and system are explicit opt-in for slower iterations.

---

## 7. Test infrastructure conventions

### Fixtures
- Live in `packages/X/test/fixtures/` or `tests/integration/fixtures/`.
- Golden files (hashes, encoded bytes) checked in. Regeneration is explicit: `pnpm test:unit --update`.
- Mock users, deterministic addresses, test mnemonics: shared via a future `@agenticprimitives/test-fixtures` package (modeled on smart-agent's pattern). Defer until duplication earns it.

### Mocking
- Prefer **real implementations + in-memory stores** over heavy mocks. A `MemoryJtiStore` is a real implementation that just doesn't persist.
- Mock the OUTERMOST boundary (RPC calls, KMS API calls) — never internal package boundaries.

### Determinism
- Tests MUST be deterministic. No `Date.now()` without injection. No `Math.random()` — use a seeded PRNG.
- Property tests use `fc.assert` with a fixed seed in CI for reproducibility.

### Speed budgets
- Unit test: < 50ms each. If slower, it's probably an integration test.
- Integration test: < 500ms each. If slower, split or move to system layer.
- E2E spec: < 30s. If slower, decompose into smaller specs.

---

## 8. Playwright incrementality (the user's specific ask)

Playwright tests are organized so each feature is **one spec file**, and a developer can run just one without booting any others:

```
tests/e2e/
├── playwright.config.ts
├── 01-demo-user.spec.ts          # mnemonic + EOA persistence
├── 02-siwe-login.spec.ts         # SIWE → JWT cookie + smart account
├── 03-authorize-agent.spec.ts    # delegation issuance + session active
├── 04-read-profile.spec.ts       # MCP tool call via agent
├── 05-revoke-session.spec.ts     # revocation reflected in MCP
├── fixtures/
│   └── test-mnemonic.ts
└── helpers/
    └── boot-stack.ts             # programmatic anvil + deploy + apps
```

Each spec is **completely independent**: it boots the stack it needs (via Playwright `webServer` config or programmatic helper), sets up its own state, asserts, tears down. A failure in `02-siwe-login` doesn't block `04-read-profile`.

To run one spec: `pnpm test:e2e -- 02-siwe-login`
To debug one spec: `pnpm test:e2e --debug -- 02-siwe-login`
To watch one spec: `pnpm test:e2e --ui -- 02-siwe-login`

The shared `helpers/boot-stack.ts` is the only piece they all use — and it can run in "skip-anvil" mode for specs that don't need chain.

---

## 9. Anti-drift integration

The test strategy plugs into existing anti-drift rails:

- `check:capability-manifests` already verifies `publicExports` matches source.
- (Future) `check:test-coverage` verifies every `publicExports` symbol has at least one test import.
- `expect-type` tests pin public API shapes against accidental change.
- Forge tests pin contract behavior against silent refactors.
- Playwright traces give a visual record when a UI invariant breaks.

If a refactor changes a public API:
1. Type test fails first (Layer 1, fastest).
2. Unit test fails next (Layer 1).
3. CI fails. Diff is small; cause is local.

If a refactor silently changes encrypted-payload format:
1. Integration test fails (data-key round-trip with golden fixture).
2. Diff between expected and actual is shown.

If a refactor breaks the demo UX:
1. Playwright fails on the affected step.
2. Trace + screenshot make the regression visible.

---

## 10. Migration order (this is the immediate roadmap)

For each package, as it gets real implementation, it ALSO gets:

1. `vitest.config.ts` (extends root)
2. `test/unit/` with at least one test per public export
3. Property tests for any security invariant in `CLAUDE.md`
4. Integration tests in `test/integration/` for multi-method flows

The implementation order is unchanged (`key-custody` first, then `identity-auth`, etc.), but each implementation commit lands WITH its tests, not before/after.

For E2E:
- One Playwright spec per demo step as the step becomes real.
- `01-demo-user.spec.ts` can land today (it tests only browser state).
- `02-siwe-login.spec.ts` lands with the SIWE wiring commit.
- And so on.

For contracts:
- Port forge tests selectively from smart-agent as the demo exercises them.
- Start with `AgentAccount.t.sol` (ERC-1271), `DelegationManager.t.sol` (revoke + redeem).

---

## 11. What this rules out (for v0)

- **End-to-end-only testing** (Playwright as the primary signal). Too slow, too fragile.
- **Zero-mock tests** for every flow. We mock at protocol boundaries (RPC, KMS API) but not internal boundaries.
- **Coverage targets as a CI gate.** Coverage is a smell signal, not a quality target. (Smoke alarms, not the building code.)
- **Snapshot tests as the primary assertion form.** Snapshots rot. Prefer explicit golden files for deterministic byte-level checks.
- **A single mega-test that exercises the whole stack.** Bigger surface, less localized failure.

---

## 12. Success criteria

This strategy is working when:

- A developer touching `delegation` runs `pnpm --filter @agenticprimitives/delegation test --watch` and gets <1s feedback on changes.
- A failed CI run points at a single layer and a single test, with the file:line and the diff between expected and actual.
- A Playwright failure can be reproduced with one command targeting one spec.
- Adding a new caveat type touches at most: source file, unit test, golden fixture, spec.
- An agent that breaks the boundary (e.g., adds drift to a CLAUDE.md, removes an export) fails CI before the implementation lands.
