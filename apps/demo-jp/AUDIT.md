# demo-jp — security findings (audit 2026-06-03)

Branch `feat/w1-substrate-coordination`. Findings from the security + architecture audit of the
GC-approved-agreement flow and the broader demo-jp surface. **This is a testnet demo with
deliberate custody shortcuts** — the items below distinguish *accepted demo trade-offs* from
*real exposures to fix before any non-demo use*. Companion: [`docs/audits/threat-model.md`](../../docs/audits/threat-model.md).

## Critical (must fix before non-demo use; accepted for the testnet demo)

### C-1 — Operator keys are globally identical → any visitor owns both org vaults
`src/lib/personas.ts` derives Pete from the hardcoded seed `'a11ce'` and Jill from `'b0b'`
(`mintPersona`). **Every browser re-derives the same private keys.** Those EOAs custody the GC and
JP org SAs (`org-personas.ts`), so any anonymous visitor can sign owner-issued vault delegations and
read+write JP's entire broker board, GC's issuance, **every member grant (`jp:grant:*`) and through
them every member's vault incl. `impact:profile` PII**, and forge GC agreements / JP recognitions.
This is *beyond* the documented "operator key visible in their own localStorage" trade-off — the key
is the same for everyone. **Real fix:** operator custody moves to per-operator SIWE/KMS signers
(spec 235); the seed must never be a constant. See [spec 248](../../specs/248-demo-jp-custody-and-vault-scope-hardening.md).

### C-2 — Vault delegations are full-vault grants (no per-record scoping)
Vault delegations carry only timestamp+value caveats and the off-chain MCP never enforces
`allowedTargets` (`apps/demo-mcp/src/index.ts`, `db.ts` `list` returns all record types). Any
delegation holder can `list`/`get`/`set` **every** `record_type` in the grantor's vault — not the
intended one. JP's broker grant → can read a member's `impact:profile`; the shared site delegate →
can overwrite a member's home profile. The "scoped grant" framing (spec 247 / ADR-0026) is not
cryptographically true. **Real fix:** a `record_type`/scope caveat enforced inside the vault tools
(spec 248).

## High

### H-1 — Recognition gate had no signature check — FIXED
`IntentBoard.isRecognized` (`src/components/OperatorDashboards.tsx`) used to honor any *row present*
in JP's vault. It now gates on **verified** recognitions only: each row's JP signature is
ERC-1271-verified over the credential hash and the subject/kind/people-groups are taken from the
SIGNED credential body (`verifyRecognitionCredential` in `src/lib/issuance-flow.ts`,
`verifyErc1271` in `src/lib/chain.ts`). A forged/unsigned row no longer passes. (Residual: under C-1
an attacker holds JP's key and can sign a real one — closed only once C-1 is.)

### H-2 — Shared relying-site delegate across demo-jp + demo-org
`src/connect-client.ts` `DEMO_JP_DELEGATE` falls back to `0x89D1…ffD0`, shared with demo-org. A grant
a user believes is scoped to "the JP app" is redeemable by whoever controls that shared delegate.
**Fix:** per-app delegate identity (`VITE_DEMO_JP_DELEGATE`), tracked in spec 248.

## Medium / Low (notes)

- **M-1** `/mcp/vault/*` (demo-a2a) is gated by CSRF+CORS only, no browser session — the delegation
  is the sole authorization; combined with C-1 = unauthenticated vault access. Documented-intentional
  pieces: testnet CSRF dev-mode + long-lived operator sessions ([memory] feedback_demo_operator_longlived_sessions).
- **M-2** `AgreementsBoard` "minimal until attested" is a *render-time* gate — counterparties are in
  client memory pre-attestation (operator's own browser only). Also the **issuer (GC) is public
  on-chain at registration** (`AgreementRegistered` indexes `issuer`), before any joint assertion —
  the "parties public only on assertion" framing does not cover the issuer.
- **M-3** GC reads JP's `drafts` directly from JP's vault (`loadDrafts` → `jpVaultOwner`) because both
  keys live in one browser (C-1). The intended D-8 hand-off should deliver drafts into GC's vault via
  an explicit JP→GC append-grant.
- **L** `jp:recognition` is written into the member org's own vault via the member's full-vault grant
  (depends on C-2); `AssociationRow.credential`/`issuerSignature` in JP's vault are correct residency
  but readable by anyone under C-1.

## Cross-tenant isolation — sound
demo-mcp keys strictly by the recovered `principal` (= delegation delegator); adopter A cannot read
adopter B's records unless A holds a delegation B issued. The weakness is *within* a tenant once any
grant is held (C-2), not across tenants.
