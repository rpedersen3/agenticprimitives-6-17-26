# Halmos symbolic proofs

Foundry fuzzing samples inputs; Halmos symbolically EXPLORES the input
space. Properties locked here are the ones that must hold for the *entire*
input space, not just the draws the fuzzer happened to take.

## What lives in this directory

- `WebAuthnLibUvR82.halmos.t.sol` — R8.2 UV-required gate proof + the
  H7-C.1 UP-required sibling. The headline R9.3 proof.

Future R9.3.x slices add proofs for:
- `onlySelf` modifier closure on AgentAccount upgrade / module install /
  DM rotation
- Revoked delegations cannot redeem
- EIP-712 typehash equality cross-stack (H7-D.9)

## Naming convention

- Foundry uses `test_*` / `invariant_*` prefixes.
- Halmos uses `check_*` — function names must start with that.

`forge test` skips `check_*` (it finds no tests); `halmos` skips
`test_*` / `invariant_*` (it has no symbolic-execution semantics for
fuzz / invariant suites). The two tools share a Foundry project but
never collide.

## Running locally

```bash
# From the repo root:
pnpm check:contracts-halmos

# Or directly in this package:
cd packages/contracts
halmos
```

Config lives in `packages/contracts/halmos.toml`. The default
bytes-length is 37 (the WebAuthn authenticator-data minimum) — proofs
that need a different size pin it explicitly with `--array-lengths`.

## CI

The `halmos` job in `.github/workflows/security.yml` runs on every PR
and push to master. PR-blocking from the start: the current proofs
terminate in <50ms, so flakiness risk is negligible.

## Adding a new proof

1. Create `<name>.halmos.t.sol` in this directory.
2. Function name must start with `check_`.
3. Use `vm.assume(...)` for input constraints. Symbolic-bytes args
   default to length 37 via `halmos.toml`; override via `--array-lengths`.
4. Use `assert(...)` for the property to prove (not `assertTrue` —
   Halmos walks the lower-level `assert` opcode).
5. Run locally first: `halmos --match-test check_<name>`.
6. The CI job picks it up automatically (no workflow edit needed).
