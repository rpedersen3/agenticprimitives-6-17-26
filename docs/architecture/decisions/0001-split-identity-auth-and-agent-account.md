# ADR-0001 — Split `identity-auth` and `agent-account`

**Status:** accepted (2026-05-19)
**Supersedes:** initial 4-package scaffold (which bundled them as `@agenticprimitives/auth`)

## Context

The first scaffold of agenticprimitives bundled user authentication (passkey / SIWE / OAuth) and ERC-4337 smart-account substrate into a single `@agenticprimitives/auth` package. The user pushed back on coarse boundaries; competitive research validated the split.

Signals from the landscape:
- **All four major AA toolkits** (Alchemy Account Kit, ZeroDev, Pimlico, Safe) decouple signer from account. Three of four ship no signer at all — accounts accept any viem-compatible `LocalAccount`.
- **MetaMask DTK** explicitly positions signer (`WalletSignerConfig`, `WebAuthnSignerConfig`) as a pluggable peer of the DeleGator smart account, not embedded.
- **Turnkey** splits stampers (auth/credential) from signers (chain) from core (KMS).

## Decision

`identity-auth` and `agent-account` are two packages.

- `identity-auth` owns: auth methods, JWT sessions, CSRF, **and the `Signer` interface contract** (`Signer`, `PasskeySigner`, `EOASigner`, `KMSSigner`).
- `agent-account` owns: ERC-4337 substrate, CREATE2 addressing, factory deployment, ERC-1271 verification, UserOp building. **Consumes** `Signer` from `identity-auth`; does not produce signers.

The `Signer` interface is the architectural commitment that lets `agent-account` and `delegation` accept any signer backend (passkey from a browser, EOA from a wallet, KMS-backed key from `key-custody`) without knowing which.

## Consequences

- A consumer who already has an AA stack (Alchemy / Pimlico / Safe / ZeroDev) can adopt `identity-auth` standalone without inheriting our smart-account opinions.
- A consumer who wants our smart account can bring their own auth (e.g., Privy) and pass a compatible `Signer`.
- New auth methods (Apple Sign In, magic links, etc.) go in `identity-auth` only; no churn in `agent-account`.
- The cost: two packages instead of one means two `package.json` / `CLAUDE.md` / `spec.md` to maintain. Acceptable.

## To reverse this

The bundling case strengthens only if every realistic consumer wants both packages together AND the `Signer` interface ceases to be useful (e.g., one signer type wins so completely that abstraction is overhead). Neither condition holds today. If you're considering bundling: write a new ADR explaining what's changed.

## References

- [`specs/100-package-boundary-doctrine.md`](../../../specs/100-package-boundary-doctrine.md) §S1 ("Signer is a pluggable peer of the smart account")
- [`specs/101-v0-package-proposal.md`](../../../specs/101-v0-package-proposal.md) §2 (Package 1 + Package 2)
