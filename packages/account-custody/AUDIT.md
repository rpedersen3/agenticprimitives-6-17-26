# `@agenticprimitives/account-custody` — Security & Architecture Audit

**Status:** alpha
**Last refreshed:** 2026-05-30
**Owners:** account-custody package CODEOWNERS
**System audit cross-reference:** [docs/audits/2026-05-packages-contracts-production-readiness.md](../../docs/audits/2026-05-packages-contracts-production-readiness.md)

## 1. Charter

Owns the off-chain SDK surface for the on-chain `CustodyPolicy` module:
- `CustodyAction` enum + typed-data helpers for every custody action.
- Quorum signature packing (Safe-format slot encoding) — `packQuorumSigs`, slot helpers.
- Per-tier threshold + cancel-window encoding.
- Custodian / trustee / guardian role types.

Spec 213 carve-out: this package owns custody vocabulary; `agent-account` consumes via type-only imports. The on-chain machinery lives in `packages/contracts/src/custody/CustodyPolicy.sol` (Phase 6c.5-d.1) — this package ships ABI helpers + arg builders only.

What this package does NOT own:
- The `CustodyPolicy.sol` contract itself.
- Quorum *enforcement* on-chain — that's `QuorumEnforcer` (delegation enforcers).
- Lifecycle / state-machine (no `SessionManager`).
- Key custody primitives → `@agenticprimitives/key-custody`.

## 2. Security invariants (DO NOT BREAK)

1. **EIP-712 typed-data shape MUST byte-match `CustodyPolicy.sol`.** Test gate: cross-stack typehash equality test (H7-D.9 — not yet wired).
2. **Tier thresholds are floor + ceiling, both fail-closed.** Setting `threshold = 0` on any tier MUST be rejected by the package (see CON-CUSTODY-001 — currently the contract treats unset as implicit-1; package must refuse).
3. **Quorum slot packing matches Safe format byte-exactly.** Test: `test/unit/quorum-slots.test.ts` (sample existing).
4. **No raw private keys in this package's surface.** Signing happens through `Signer` interfaces from `connect-auth`; this package only builds the messages.
5. **`recoverAccount` arg builders MUST cap `addOwners` / `removeOwners` lengths** to bound CON-CUSTODY-003 (per-call bound on adversarial recovery).

## 3. Public API surface (audit scope)

See `src/index.ts`; per `capability.manifest.json:publicExports`.

## 4. Known findings (cross-reference to system audit)

- **PKG-account-custody-001..003** — Missing `AUDIT.md` (this doc closes), leaf-status documentation, quorum-packing duplication with `agent-account` (XPKG-008).
- **XPKG-008** — `agent-account/src/quorum.ts` `packSafeSignatures` duplicates `account-custody/src/quorum-slots.ts` `packQuorumSigs`. Consolidate here (spec 213 carve-out moved custody vocab to this package). H7-B follow-up.
- **CON-CUSTODY-001** (on-chain side) — `_approvalsValue` returns 1 when per-tier threshold unset; this package must refuse to build args that produce implicit-1.

## 5. Test posture

- Unit tests for quorum slot packing + typed-data hashing.
- Cross-stack typehash equality test deferred to H7-D.9.
- Missing: matrix tests for every `CustodyAction` × every tier (H7-D.3 fold-in).

## 6. Pre-publication checklist

- [ ] `license: MIT` + `LICENSE` in files array (H7-A.2 ✓).
- [ ] Cross-stack typehash test green (H7-D.9).
- [ ] Quorum packing consolidated; `agent-account` re-imports from here (H7 follow-up).
- [ ] AUDIT.md refreshed per release.
