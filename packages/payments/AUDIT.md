# @agenticprimitives/payments — Audit Notes

**Status:** Foundational (W1), `private` package — code shipped; NOT production enforcement.
**Last reviewed:** 2026-06-10 (audit-consolidation round 1).

## Charter
Spine Layer 9b (spec 243): the `PaymentMandate` typed primitive + EIP-712 builder/signer/verifier
(SA-signed via ERC-1271, no raw EOA), open/closed-mode invariants, and the three W1 rails
(`wallet` / `x402` / `sponsored-userop`) behind a `PaymentRailExecutor` interface.

## Findings (canonical status: `docs/audits/findings.yaml`)
- **Non-authoritative helper (audit warning, OPEN):** `computeMandateId()` derives the id from
  `payer, nonce, rail, chain` only — it does **not** bind `amount`, `payee`, or constraints. It is a
  correlation id, NOT replay/authorization protection or an economic-uniqueness gate, and MUST NOT be used
  as one. The authority is the **signed mandate** (ERC-1271), not the id. Add a test proving no rail treats
  `computeMandateId` as an enforcement gate before this package graduates from foundational.
- Mandate signing/verification is not yet exercised against a live rail end to end (foundational posture).

## Security invariants
- SA + ERC-1271 only; no raw EOA mandate signatures (PMT-INV-12).
- Open mandate refuses final-charge; closed mandate is one-shot (PMT-10.1 / PMT-INV-13..15); same-chain only (PMT-INV-03).

## Production readiness
W1-foundational and **`private`** — an authority-bearing economic package MUST NOT graduate past foundational while
its tests are thin (currently `--passWithNoTests`-tolerant). Needs a threat model, mandate-forgery/replay negative
tests, and a lifecycle gate. Canonical invariants: `spec.md` + [`CLAUDE.md`](./CLAUDE.md).
