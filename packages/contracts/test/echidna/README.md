# Echidna stateful property fuzzing

Different sampling strategy than Foundry's invariant runner (which also
produces stateful sequences but with different seed semantics) and
Halmos (symbolic; covers all paths but bounded). Echidna's long-running
ABI-aware random-sequence fuzzer catches multi-step sequence bugs that
Foundry / Halmos might miss.

## What lives in this directory

- `CustodyPolicyEchidna.t.sol` — properties mirroring the R9.1 Foundry
  invariant suite. 4 properties × 50,000 sequences nightly.

Future R9.4.x slices add harnesses for:

- DelegationManager (mirrors R9.2 invariants)
- SmartAgentPaymaster (mirrors R9.2 invariants)
- AgentAccount admin-flow path coverage (different surface than the
  R9.3.x onlySelf Halmos proofs — Echidna would explore sequence
  ordering that Halmos's path-bounded exploration doesn't)

## Naming convention

- Foundry uses `test_*` / `invariant_*`.
- Halmos uses `check_*`.
- Echidna uses `echidna_*` returning `bool`.

`forge test` skips `echidna_*` (returns bool — not a Foundry test
shape), Halmos skips them (no symbolic-execution semantics for property
returning `bool`), and Echidna skips `test_*` / `invariant_*` /
`check_*` (different semantics). The three tools share a Foundry
project but never collide.

## Running locally

```bash
# From the package:
cd packages/contracts
pnpm echidna

# Or directly:
echidna test/echidna/CustodyPolicyEchidna.t.sol \
  --contract CustodyPolicyEchidna \
  --config echidna.yaml
```

Config lives in `packages/contracts/echidna.yaml`. The default test
limit is 50,000 sequences, 4 parallel workers, ~30s wall-time.

## CI

`.github/workflows/contracts-echidna-nightly.yml` runs nightly at
02:17 UTC + on-demand via workflow_dispatch. **Artifact-only**
(`continue-on-error: true`) per the R9.4 design — a failed nightly
doesn't break the green bar, but the corpus artifact + workflow
summary make any violation visible the next morning. Graduates to
PR-blocking once a green track record is established.

## Adding a new harness

1. Create `<Name>Echidna.t.sol` in this directory.
2. Each property is a `function echidna_<name>() external view
   returns (bool)`. Echidna falsifies these.
3. External / public functions on the harness contract are the
   mutation surface — Echidna calls them with random inputs.
4. The harness's `constructor()` is Foundry's `setUp()` equivalent.
5. Run locally first:
   ```bash
   echidna test/echidna/<Name>Echidna.t.sol --contract <Name>Echidna --config echidna.yaml --test-limit 1000
   ```
6. Add a new job to the nightly workflow (or a new harness file if
   the existing CustodyPolicy harness should be split).

## Why Echidna in addition to Foundry invariants + Halmos

Each tool has a different failure mode:

| Tool | Strategy | Best at | Misses |
|---|---|---|---|
| **Foundry invariants** | Stateful random + seeded shrinking | Per-PR property checks | Multi-step sequence bugs Foundry's seed strategy doesn't explore |
| **Halmos** | Symbolic execution | All-paths proofs of small properties | Property explosion on large state |
| **Echidna** | Stateful ABI-aware random + coverage-guided | Multi-step sequence bugs + long-burn coverage | Per-PR latency |

The R9 wave covers all three for the same surface so a regression
that slips one tool's net can't slip them all.
