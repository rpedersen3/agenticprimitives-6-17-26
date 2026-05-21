# @agenticprimitives/agent-account — Claude guide

## Owns
- `AgentAccountClient`: address derivation, factory call, ERC-1271 sign/verify, `buildUserOp`.
- EntryPoint v0.8 + factory client wiring (addresses by config; no Solidity here).

## Does NOT own
- Auth methods / signers → `identity-auth`
- Delegation primitive → `delegation`
- KMS → `key-custody`
- Solidity source → `apps/contracts/src/` (and admin surface → `ThresholdValidator.sol` module per spec 209)
- Threshold / recovery / proposal machinery → `ThresholdValidator` module (NOT this package — see [spec 209](../../specs/209-erc7579-module-taxonomy.md))

## Read first
1. `src/index.ts` — public API
2. `../../specs/201-agent-account.md` — the contract
3. `../../specs/209-erc7579-module-taxonomy.md` — where threshold/recovery/session moved
4. `src/client.ts` — implementation

## Allowed imports
`@agenticprimitives/types`, `@agenticprimitives/identity-auth` (type-only `Signer`), `viem`. Nothing else from `@agenticprimitives/*` (downstream packages create cycles).

## Drift triggers — STOP
- Caveats / delegation / session manager → `delegation`
- KMS / envelope encryption → `key-custody`
- Auth UX / OAuth / passkey assertion → `identity-auth`
- Risk tiers / tool classification → `tool-policy`
- Admin proposals / threshold logic → `apps/contracts/src/modules/ThresholdValidator.sol` (NOT this package after phase 6c.5-d.1)

## Security invariants
- Salt derives from stable IDs via keccak; no raw user-supplied salt.
- Sensitive ops gated on `msg.sender == owner` or ERC-1271, verified on-chain.
- EntryPoint version baked into the address; refuse cross-version silently.
- Bootstrap signer ≠ user-authority signer.

## Validate
```bash
pnpm --filter @agenticprimitives/agent-account typecheck && test
pnpm check:forbidden-terms
```

## Capabilities (cross-cutting)
- **Multi-sig + threshold policy** — see [spec 207](../../specs/207-smart-account-threshold-policy.md) (product) + [spec 209](../../specs/209-erc7579-module-taxonomy.md) (impl). Phase 6c.5-d.1 moved the admin machinery OUT of this package — it lives in `apps/contracts/src/modules/ThresholdValidator.sol`. This package now exposes SDK helpers that target the validator's address, not the account's.
- Index: [`docs/architecture/cross-cutting-capabilities.md`](../../docs/architecture/cross-cutting-capabilities.md)
