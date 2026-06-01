# Medusa long-burn coverage-guided property fuzzing

Medusa is Crytic's go-ethereum-based fuzzer. Different sampling
strategy than R9.4's Echidna (HEVM-based) and the R9.1/R9.2 Foundry
invariant runner — different EVM engine, different mutation strategy,
different coverage feedback loop. Each tool's blind spots are
different; running all three makes it harder for a regression to slip
every net.

## What lives in this directory

- `CustodyPolicyMedusa.t.sol` — properties mirroring R9.4 Echidna
  (which mirrors R9.1 Foundry invariants). 4 properties × 4-hour
  weekend budget × 4 parallel workers ≈ 25-30M call sequences.

## Naming convention

- Foundry uses `test_*` / `invariant_*`.
- Halmos uses `check_*`.
- Echidna uses `echidna_*`.
- Medusa uses `property_*` (configurable in `medusa.json`).

Each tool ignores the others' prefixes.

## Running locally

```bash
cd packages/contracts
pnpm medusa
```

Or directly:

```bash
medusa fuzz --config medusa.json
```

Config: `packages/contracts/medusa.json`. Default budget is 4 hours,
4 workers, callSequenceLength 100, coverage on, corpus written to
`medusa-corpus/`.

For a quick smoke check:

```bash
medusa fuzz --config medusa.json --timeout 60 --target-contracts CustodyPolicyMedusa
# ~1.3M calls in 60s, 348 branches, all properties pass
```

## CI

`.github/workflows/contracts-medusa-weekend.yml` runs Saturday 03:17
UTC + on-demand. **Artifact-only** (`continue-on-error: true`) per R9.5
design. Corpus uploaded as artifact (60-day retention) — that's the
audit-evidence asset for AEL spec 237 `/audit/contract-invariants/`.
Graduates to PR-blocking once a green track record is established.

## Compatibility notes (R9.5 dev log)

- Medusa requires `crytic-compile --foundry-compile-all` in
  `compilation.platformConfig.args` so `test/` is included in the
  build (default behavior skips it; the harness then fails to
  surface and Medusa errors "no tests found").
- Medusa 1.5.1's go-ethereum EVM supports Cancun natively (MCOPY +
  transient storage); no `--evm-version` pinning needed (Echidna
  2.2.7 also; Echidna 2.2.4 didn't, hence the R9.4 upgrade note).
- `testAllContracts: false` + explicit `targetContracts:
  ["CustodyPolicyMedusa"]` keeps the fuzzer focused. Without
  `targetContracts`, Medusa instantiates every compiled contract,
  which causes constructor-arg errors on contracts with non-empty
  constructors.
