# Spec 252 — demo-gs vault persistence (Global Switchboard off localStorage)

**Status:** draft, 2026-06-04.
**Owner:** demo-gs (the consuming app). Reuses the [spec 247](247-per-agent-mcp-vault.md) vault
substrate (demo-mcp `vault_records` + `get/set/list_vault_record`, demo-a2a `/mcp/vault/*` proxy)
unchanged — this spec is the **architect-of-record only for the demo-gs side**: its vault-client port,
operator custody, ownership model, and `record_type` namespaces.
**Architecture-of-record:** [ADR-0010](../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md)
(SA address is the canonical id), [ADR-0013](../docs/architecture/decisions/0013-no-silent-fallbacks.md)
(one mechanism per read path — no localStorage⇄vault dual-read), [ADR-0021](../docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md)
(vault-client stays in the app, not a package), [spec 250](250-demo-gs-global-switchboard.md) (demo-gs),
[spec 251](251-skills-and-geo-features.md) (the skills/geo substrate demo-gs already reads).

## Reference: smart-agent patterns to port

The vault substrate's smart-agent lineage is already documented in [spec 247 §"Reference"]; this spec
adds nothing new to the substrate. demo-gs **ports the demo-jp consumer pattern verbatim where it can**:
- `apps/demo-jp/src/lib/vault-client.ts` → `apps/demo-gs/src/lib/vault-client.ts` (near-verbatim;
  demo-gs already has byte-identical `src/csrf.ts` + `src/lib/delegation.ts`).
- `apps/demo-jp/src/lib/onchain.ts` `ensureOrgDeployed('jp')` / `jpVaultOwner()` →
  `ensureSwitchboardDeployed()` / `switchboardVaultOwner()`.
- `apps/demo-jp/src/lib/broker-store.ts` array-record pattern (`readBrokerRows`/`writeBrokerRows`) →
  the demo-gs broker collections.

Deliberate divergence: demo-gs is a *skills* marketplace, not adoption — its `record_type`s are
`gs:*`, and its broker (Jane) is the only operator that needs a vault in Wave 1 (vs. demo-jp's
two-operator + member vaults).

## 1. Problem

demo-gs keeps everything in `localStorage` — `src/lib/store.ts` (needs/offerings/agreements),
`src/lib/members.ts` (the member directory), `src/lib/personas.ts` (operator keys). It is per-browser,
unshareable, and unauditable — the same contradiction spec 247 fixed for demo-jp. The substrate to fix
it already exists and is deployed; demo-gs is the **second consumer** (spec 247 §4 anticipated this).

Two structural facts shape the migration:
1. demo-gs is **chain-decoupled today** — `src/lib/chain.ts` only *reads* the skill/geo registries
   (injected viem `readContract`). It has no delegation-signing, no SA deploy.
2. Vault writes are **delegation-gated**: the demo-a2a `/mcp/vault/*` proxy `verifyDelegation`s the
   record owner via ERC-1271 (`isValidSignature`) — **there is no EOA fallback**. So a vault owner
   must be a *deployed* Smart Account, and the writer must hold the owner's private key to sign the
   self-delegation.

## 2. Ownership model (principal = delegator = owner = namespace)

Per spec 247 §2, a record's owner is the delegation's delegator; an agent can only touch its own
namespace. demo-gs mapping:

| Data | Owner vault | `record_type` |
| --- | --- | --- |
| Broker matches | Switchboard (Jane) broker SA | `gs:broker:matches` |
| Agreements (broker receipt) | Switchboard broker SA | `gs:broker:agreements` |
| Bridged needs (Pattern-A; no real SA) | Switchboard broker SA | `gs:bridge:needs` |
| KC offerings | KC person SA | `gs:offerings` |
| GCO needs | GCO org SA | `gs:needs` |
| Received delegations (Wave 2+) | recipient SA | `delegation-received:<grantorSA>` |

Each collection is **one array record** (mirrors demo-jp `broker-store.ts`), because the board reads /
writes the whole list. Bridged needs have **no real owning SA**, so they correctly belong to the
broker (Jane) vault — "broker's own operational data" (spec 247 §3).

## 3. Operator custody (R2 resolution)

`personas.ts:eoa()` derives an address then **discards the private key**. Add a key-bearing custodian
loader returning `{ address, privateKey }` from the same seeds (`jane:'face1'`, …), so
`personaSignHash(custodian)` can sign delegations. Jane is deterministic (like demo-jp's Jill) — the
broker vault therefore works with **no Connect**, giving immediate cross-browser persistence.

**The vault-owning Switchboard SA address MUST be `deriveOrgSaAddress(JANE_EOA, salt)`** (the relayer's
CREATE2 prediction), NOT the local `predictOrg()` keccak (a different address that will never have
on-chain code). `predictOrg` addresses may remain for fixture/display identity but are **not valid
vault owners**.

## 4. Deploy-before-write (R1 resolution)

Port a minimal `ensureSwitchboardDeployed()` (the `ensureOrgDeployed('jp')` analog):
`deriveOrgSaAddress(JANE_EOA, salt)` → `isContractDeployed` → if absent, `deployOrgSa` via the relayer
(`/a2a/session/deploy`). Returns `switchboardVaultOwner = { owner: switchboardSA, custodian: jane }`.
Requires the paymaster enabled on demo-a2a-production (`deployOrgSa` 409s otherwise). A name-claim is
optional (best-effort, skip for Wave 1). This pulls `@agenticprimitives/agent-account` into demo-gs
deps (only for deploy/execute call-data — NOT for the vault write itself).

## 5. Plumbing (R3 resolution)

- Add `apps/demo-gs/functions/a2a/[[path]].ts` (copy demo-jp's verbatim) + the `DEMO_A2A_URL` Pages
  binding, so the browser calls same-origin `/a2a/*` and the Pages Function proxies to the demo-a2a
  Worker.
- Add demo-gs's prod + preview + `localhost:5673` origins to demo-a2a's `ALLOWED_ORIGINS` (CORS) — CSRF
  tokens are HMAC-bound to their mint origin, so an un-allow-listed origin silently 403s every vault
  call. **Smoke-test a `/mcp/vault/list` round-trip from the deployed demo-gs origin before migrating
  any data.**

## 6. No silent dual-read (ADR-0013)

Each migrated accessor reads the **vault only** once cut over. The localStorage path is removed in the
same change that lands the vault path — never a `try vault catch localStorage` or a read that merges
both. A transient in-memory cache of the vault's array (the canonical answer) is fine; a second
*mechanism* is not. The seed fixtures become a one-time vault seed (written if the broker vault is
empty on first load), not a parallel store.

## 7. Phasing

- **Wave 0 — plumbing (no behavior change):** the a2a Pages proxy + `ALLOWED_ORIGINS`; port
  `vault-client.ts`; add `personaSignHash` + `CONTRACTS{delegationManager,timestampEnforcer,valueEnforcer}`
  + key-bearing custodians to demo-gs. Smoke-test a vault round-trip from a throwaway record.
- **Wave 1 — broker vault (Jane):** `ensureSwitchboardDeployed()`; migrate agreements + matches +
  bridged needs to `gs:broker:*` / `gs:bridge:needs`. Deterministic operator → cross-browser with no
  Connect. Deploy + verify on Base Sepolia.
- **Wave 2 — member vaults:** connected KC offerings → KC person SA (`gs:offerings`); connected GCO
  needs → GCO org SA (`gs:needs`). The broker reads member data via a granted delegation
  (`vaultReadWithDelegation`) where the member grants it; otherwise each member writes its own vault.
  "Explore with a sample identity" (no real SA) stays local — it cannot sign a delegation, and that is
  the honest boundary.

## 8. Acceptance

- Wave 0: a self-delegated `set_vault_record`→`get_vault_record` round-trip succeeds from the deployed
  demo-gs origin; a token for agent A is rejected against agent B's namespace (substrate already
  enforces this — confirm from demo-gs).
- Wave 1: clear `localStorage`, broker board (agreements + bridged needs) survives a reload **in a
  different browser**; reads come from `gs:broker:*` (one mechanism).
- Wave 2: a connected KC's offering persists to the KC's own vault and the broker board shows it via
  the member's granted delegation.
- `check:no-domain-in-packages` + `check:forbidden-terms` stay green (vault-client + `gs:*` vocabulary
  live in the app, never packages).
