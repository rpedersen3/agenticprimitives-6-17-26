# Spec 248 — demo-jp custody + vault-scope hardening

**Status:** draft / scoping, 2026-06-03.
**Owner:** apps/demo-jp + apps/demo-a2a + apps/demo-mcp + packages/{delegation, mcp-runtime}.
**Drivers:** the 2026-06-03 security + architecture audit ([`apps/demo-jp/AUDIT.md`](../apps/demo-jp/AUDIT.md),
threat-model rows DEMO-1/DEMO-2). Companion: [ADR-0026](../docs/architecture/decisions/0026-per-agent-vault-substrate.md)
(divergence note), [spec 235](235-google-kms-custody.md) (KMS custody), [spec 247](247-per-agent-mcp-vault.md)
(vault substrate), [ADR-0013](../docs/architecture/decisions/0013-no-silent-fallbacks.md).

This spec SCOPES the two CRITICAL findings the audit surfaced. They are accepted as testnet demo
trade-offs today; this is the plan to retire them before any non-demo use. It is intentionally a
*wave-sized* effort, not a quick patch. (The recognition-gate signature check — H-1 in AUDIT.md — was
fixed in the same turn and is out of scope here.)

## Problem (restated)

- **C-1 — globally-shared operator keys.** Pete/Jill EOAs are derived from hardcoded seeds
  (`apps/demo-jp/src/lib/personas.ts mintPersona`: `'a11ce'` / `'b0b'`). Every browser re-derives the
  same keys; those EOAs custody the GC and JP org SAs, so any anonymous visitor can sign owner-issued
  vault delegations and read+write both org vaults — the broker board, GC issuance, every `jp:grant:*`,
  and (through those grants) every member's vault incl. `impact:profile` PII — and forge GC agreements /
  JP recognitions. This is *beyond* the documented "key visible in your own localStorage" hole.
- **C-2 — full-vault delegations.** Vault delegations carry only timestamp+value caveats; the off-chain
  MCP (`apps/demo-mcp`) never enforces `allowedTargets`/scope, so a holder can `list`/`get`/`set` EVERY
  `record_type` in the grantor's vault, not the intended one. A "scoped grant" is de-facto root on the
  owner's namespace.

## Target

### A — Operator custody is per-operator, not a shared constant (retire C-1)
- GC/JP org custody moves to a **per-operator SIWE or KMS-backed signer** (spec 235 pattern): the
  operator signs in (one-click SIWE for the demo personas is fine — [memory] feedback_demo_operator_longlived_sessions),
  and the org SA is custodied by *that* credential, not a globally-derivable EOA. No private key
  constant in client code.
- demo-jp keeps the operator personas as *labels*; the signing key is obtained per session, never minted
  from a fixed seed. `scripts/check-no-app-private-keys.ts` allowlist entries for `personas.ts` /
  `chain.ts` are removed once the constants are gone.
- Acceptance: in a fresh browser with no operator session, `/mcp/vault/*` calls as GC/JP fail (no
  signable key); only an authenticated operator can act as the org.

### B — Vault delegations carry a record-type scope, enforced in the MCP (retire C-2)
- Add a **vault-scope caveat** (a `record_type` prefix/allowlist) to the delegation, alongside the
  existing timestamp/value caveats — owned by `packages/delegation` (a new sentinel/enforcer shape, peer
  of the on-chain enforcers but evaluated off-chain).
- Enforce it inside the vault tools / `withDelegation` in `packages/mcp-runtime` + `apps/demo-mcp`: a
  `get`/`set`/`list` for a `record_type` outside the grant's scope is rejected (fail-closed). `list`
  returns only in-scope record types.
- The member onboarding grant to JP is scoped to the JP-program record types
  (`jp:adopter`, `jp:facilitator`, `jp:exchange`, `jp:recognition`, …) — NOT `impact:profile` or the
  member's whole vault. Each new record-type write path (e.g. `jp:recognition`) must be added to the
  grant's allowed set explicitly (see AUDIT.md L).
- Acceptance: a delegation minted for one `record_type` is rejected for another; a regression test
  asserts JP's broker grant cannot read the member's `impact:profile`.

### C — Drafts handed JP→GC via an explicit append-grant, not a shared-key cross-read (retire M-3)
- The D-8 draft hand-off delivers the draft into **GC's** vault via a JP→GC append-grant (scoped to the
  draft record type), instead of GC reading `jp:broker:drafts` out of JP's namespace.

## Out of scope
The recognition-gate signature verification (done), the shared relying-site delegate per-app split
(H-2 in AUDIT.md — config-only, track separately), and the M-2 "issuer public at registration"
documentation note (accept or move issuer to commitment-only — product decision).

## Reference: smart-agent patterns to port
From `/home/barb/smart-agent` (branch `003-intent-marketplace-proposal`): the KMS/session custody for
operator/service agents (spec 235 already ports the per-subject KMS custodian); the caveat evaluator's
fail-closed scope enforcement (port the "unknown enforcer → reject" discipline to the new vault-scope
caveat). DELIBERATELY DIVERGE: smart-agent has no globally-shared demo key — our constant seeds are a
demo-only shortcut to retire, not a pattern to keep.
