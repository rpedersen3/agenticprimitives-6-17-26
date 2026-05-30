# `@agenticprimitives/contracts` — Security & Architecture Audit

**Status:** alpha (Base Sepolia testnet only)
**Last refreshed:** 2026-05-30
**Owners:** contracts package CODEOWNERS
**System audit cross-reference:** [docs/audits/2026-05-packages-contracts-production-readiness.md](../../docs/audits/2026-05-packages-contracts-production-readiness.md)

## 1. Charter

This package ships the **on-chain enforcement layer** for the agenticprimitives stack:

- `AgentAccount.sol` + `AgentAccountFactory.sol` — ERC-4337 Smart Agent core (UUPS-upgradeable, ERC-7579 module-host, ERC-1271 verifier, WebAuthn-supporting).
- `agency/DelegationManager.sol` + `enforcers/*` — scoped ERC-7710 delegation with on-chain caveat enforcement (AllowedTargets, AllowedMethods, Timestamp, Value, Quorum).
- `custody/CustodyPolicy.sol` — multi-sig custodian / guardian quorum + scheduled-action machinery (spec 213 carve-out).
- `SmartAgentPaymaster.sol` — ERC-4337 paymaster with three validation modes (dev / allowlist / verifying).
- `naming/{AgentNameRegistry, PermissionlessSubregistry, AgentNameUniversalResolver}.sol` — `.agent` TLD + ENSv2-style resolver.
- `identity/AgentProfileResolver.sol` — ERC-1056-style profile / AgentCard facet resolver.
- `ontology/{OntologyTermRegistry, ShapeRegistry, AttributeStorage}.sol` — SHACL shape + JSON-LD predicate registries.
- `relationships/AgentRelationship.sol` — public on-chain edge model (⚠ Privacy Fork — see EXT-019; **mark experimental**).
- `libraries/{WebAuthnLib, P256Verifier, SignatureSlotRecovery, MultiSendCallOnly}.sol` — security-critical primitives.
- `UniversalSignatureValidator.sol` — single sig entrypoint per spec 214 SB-4.
- `ApprovedHashRegistry.sol` — v=1 pre-approved hash signature path.

Deployments JSON per network: `deployments-base-sepolia.json`, `deployments-anvil.json`.

## 2. Security invariants (DO NOT BREAK)

1. **EIP-712 typehashes byte-match the off-chain TS constants.** Test: `test/cross-stack/typehash.t.sol` + TS-side `test/cross-stack/typehash.test.ts` (H7-D.9 — not yet wired).
2. **`AgentAccount` storage uses ERC-7201 namespaced slots + 50-slot gap.** Storage-layout snapshot test gates upgrades (H7-C.6).
3. **WebAuthn assertion verification pins RP-ID + UP flag.** Currently MISSING — CON-WEBAUTHN-001 / H7-C.1.
4. **P256Verifier dispatcher rejects silent Daimo fallback.** Currently MISSING — CON-P256-001 / H7-C.2.
5. **`SignatureSlotRecovery` bounds-checks `v=0` and `v=2` slots.** Currently MISSING — CON-SIG-SLOT-001/-002 / H7-C.3.
6. **`AgentNameRegistry.initializeRoot` cannot be frontrun.** Currently MISSING — CON-NAMING-001 / H7-C.4.
7. **`DelegationManager.redeemDelegation` is `nonReentrant`.** SC5 §6.2 closed.
8. **Factory + Paymaster governance is the timelock + multisig, not a deployer EOA.** Currently MISSING — CON-DEPLOY-001 / H7-C.9 + EXT3-009.
9. **Pause surfaces on critical paths.** Currently NOT WIRED — EXT3-010 / H7-C.10.

## 3. Public API surface (audit scope)

All `*.sol` files under `src/` + the JSON ABIs published under `dist/abi/`. Consumers MUST import ABIs via the npm-published `@agenticprimitives/contracts/abi` subpath, NOT by reading `out/` directly.

## 4. Known findings (cross-reference to system audit)

See [docs/audits/2026-05-packages-contracts-production-readiness.md](../../docs/audits/2026-05-packages-contracts-production-readiness.md) §3 (Per-contract findings) + §4 (Cross-cutting).

**High-severity open:**
- CON-WEBAUTHN-001, CON-P256-001, CON-NAMING-001, CON-SIG-SLOT-001/-002, CON-DEPLOY-001, CON-FACTORY-001, XCON-001 (coverage 59% aggregate, well below external-audit firm bar), XCON-002 (`--via-ir` stack-too-deep blocks faithful coverage), XCON-002-sec (no system-wide pause), EXT3-009 (no standardized governance), EXT3-010 (pause surfaces unwired).

## 5. Test posture

- `forge test`: 358/358 pass at the time of the H7 audit.
- `forge coverage --ir-minimum`: 59% lines / 55% statements / 46% branches aggregate. Below external-audit floor on AgentAccount (55%), DelegationManager (42%), CustodyPolicy (70%/30%), Paymaster (52%), WebAuthnLib (16%), P256Verifier (0% direct).
- Missing: fuzz suites for enforcer composition + WebAuthn malleability + QuorumEnforcer adversarial sigs.
- Missing: storage-layout snapshot tests.
- Missing: cross-stack typehash equality test.

## 6. Pre-publication checklist

- [x] License + AUDIT.md + LICENSE + publishConfig.access=public (H7-A.2).
- [x] Extracted as `@agenticprimitives/contracts` (H7-A.2 / EXT3-001).
- [ ] WebAuthn / P-256 / SignatureSlot / Naming hardening (H7-C.1..C.4).
- [ ] Coverage ≥ 85%/75% on every load-bearing contract (H7-D).
- [ ] Storage-layout snapshots committed (H7-C.6).
- [ ] Cross-stack typehash test green (H7-D.9).
- [ ] Governance pattern: Safe + Timelock(24h); deployer EOA renounces (H7-C.9 / EXT3-009).
- [ ] Pause surfaces wired (H7-C.10 / EXT3-010).
- [ ] One external Solidity audit firm engagement.
