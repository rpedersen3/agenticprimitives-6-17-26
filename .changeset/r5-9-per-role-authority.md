---
'@agenticprimitives/contracts': minor
---

R5.9 — Per-role authority addresses in `Deploy.s.sol` (P0-1 extension).

### Why

External senior-architect audit P0-1 wanted role separation in the
deploy script. R5.4 collapsed every governance / admin / ownership
role onto a single `GOVERNANCE_MULTISIG` address, which closed the
deployer-aggregation failure mode but left every role co-located on
the same multisig. R5.9 adds per-role env vars so an operator can
point each role at a distinct multisig.

### Per-role env-var matrix

Each unset env var falls back to the resolved `authority` (so the
R5.4 single-multisig flow keeps working when no role env vars are
set):

**Multisig-shaped (contract required on production):**
- `TIMELOCK_ADMIN`
- `TIMELOCK_PROPOSER`
- `TIMELOCK_EXECUTOR`
- `GOVERNANCE_GUARDIAN`
- `GOVERNANCE_SIGNER`
- `PAYMASTER_OWNER`
- `NAMING_ROOT_OWNER`
- `ONTOLOGY_ADMIN`
- `SHAPE_ADMIN`
- `RELATIONSHIP_TYPE_ADMIN`

**EOA-shaped hot keys (R5.4 existing):**
- `BUNDLER_SIGNER`
- `SESSION_ISSUER`

### Implementation

- New `Roles` struct bundles every distinct on-chain role.
- New `_resolveContractRole(roleName, defaultAuth, network)` helper
  enforces `.code.length > 0` on production networks for multisig-
  shaped roles. Misconfigured env vars (pointing at an EOA on
  mainnet) revert with a clear `Deploy: <ROLE> must be a contract
  on production networks (Smart Agent / Safe / Timelock)` message.
- New `_resolveEoaRole(roleName, defaultAuth)` helper for hot keys
  (no contract check).
- Existing `_resolveBundlerSigner` and `_resolveSessionIssuer`
  refactored to call the new EOA helper.

### Tests

5 new R5.9 tests in `test/DeployAuthorityResolution.t.sol`:
- env-set-with-contract returns env on production
- env-unset returns default
- env-set-with-EOA rejected on production
- env-set-with-EOA accepted on testnet
- every role string round-trips via the resolver

545/545 contracts suite green (was 540; +5 R5.9 tests).

### Backwards compatibility

Operators who don't need role separation: nothing changes. Leave the
new env vars unset and everything routes to `GOVERNANCE_MULTISIG`
(R5.4 behavior preserved).
