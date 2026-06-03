# Spec 247 — Per-agent MCP vault (generic delegation-gated agent data store)

**Status:** draft, 2026-06-02.
**Owner:** demo-mcp (the vault substrate) + demo-a2a (the relayer proxy); first consumer demo-jp.
Also defines the **sibling-custody operator model** + **SIWE-connect** that give demo-jp's operators
real, connectable person Smart Agents.
**Architect-of-record for:** the `vault_records` D1 substrate + `get/set/list_vault_record` tools, the
`/mcp/vault/*` relayer proxy, and the demo-jp `vault-client`.
**Companion ADR:** [ADR-0026 — Per-agent vault substrate](../docs/architecture/decisions/0026-per-agent-vault-substrate.md).
**Architecture-of-record:** [ADR-0010](../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md)
(SA address is the canonical id), [ADR-0013](../docs/architecture/decisions/0013-no-silent-fallbacks.md)
(one mechanism per read path), [ADR-0021](../docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md)
(generic packages vs white-label apps), [spec 246](246-related-agents-vault.md) (related-agents vault),
[spec 236](236-jp-adoption-pilot.md) (JP is the data custodian).

## 1. Problem

demo-jp keeps almost all state in browser `localStorage`: the member's profile + WEA/MOU attestations
(`src/lib/vault.ts`), the broker's intents/matches/drafts/issuance/associations
(`src/lib/broker-store.ts`), operator keys (`personas.ts`), and org-deploy state (`onchain.ts`). That
data is per-browser, unshareable across devices/operators, and unauditable — it contradicts the
project's own model where **every person and org IS a Smart Agent whose data lives in its own
delegation-gated store** (ADR-0010). `vault.ts:13` already notes the shapes "mirror the future
backend-MCP API so the upgrade is a data migration, not a refactor."

There is no generic per-agent store to migrate onto: demo-mcp today has READ tools only
(`get_profile` / `get_pii` / `get_org_sensitive`); `update_profile` is a 501 stub; every store is a
typed, single-purpose table.

## 2. Target model

A **generic per-agent JSON vault** on the existing D1-backed demo-mcp. The owner of a record is the
agent at `owner_address`; **the owner is always the delegation's delegator**, which the existing
`withDelegation` wrapper already surfaces as `principal` (`apps/demo-mcp/src/index.ts:266`).

1. **Substrate (demo-mcp).** A single generic table `vault_records(owner_address, record_type,
   data_json, created_at, updated_at, deleted_at; PK (owner_address, record_type))` and three tools,
   each wrapped in `withDelegation` exactly like `get_pii` (`src/index.ts:313`):
   - `get_vault_record` (risk-tier `low`) — `args { recordType }` → the owner's JSON for that type.
   - `set_vault_record` (risk-tier `medium`) — `args { recordType, data }` → upsert.
   - `list_vault_record` (risk-tier `low`) — enumerate the owner's record types (+ soft-delete via
     `set` with a tombstone, or a `delete_vault_record` later).
   Every handler keys strictly by `principal.toLowerCase()`: **an agent can only touch its own
   namespace.** A token whose delegator is agent A can never read or write agent B's records.
2. **Writing your own vault.** To write agent X's vault you present a delegation **X issued**
   (`delegator = X`, `delegate =` a session key the caller holds), ERC-1271-signed by X's custodian.
   `callMcpToolViaDelegation` verifies that signature, mints a token with `sub = X`, and the MCP
   resolves `principal = X = owner`. For an org, the custodian (e.g. Jill for JP Org) produces the
   ERC-1271 signature; for a person SA, the person's own credential does. (This is the standard
   `issueSiteDelegation` template with `delegator = self`; not a literal delegator==delegate loop.)
3. **Relayer proxy (demo-a2a).** Routes `/mcp/vault/get|set|list` modeled on `/mcp/person/pii`
   (`apps/demo-a2a/src/index.ts:2505`), forwarding through `callMcpToolViaDelegation` (`:2366`):
   ERC-1271 verify → session → mint token → service-MAC → call demo-mcp. `recordType`/`data` travel in
   the tool `args`. These carry a delegation, so they are not CSRF-gated.
4. **Client (demo-jp).** `src/lib/vault-client.ts`: `vaultRead/vaultWrite/vaultList(owner, recordType,
   data?)` build the owner-issued delegation (`chain.ts:personaSignHash` + the `src/lib/delegation.ts`
   template) and POST to the `/a2a/mcp/vault/*` proxy. Kept in the app; promoted to a package only if
   demo-org/demo-sso need it.

## 3. Data residency (who owns what)

| Data | Owner vault |
| --- | --- |
| member community profile (name, contact, WEA) | **Impact** person MCP — read over the member's delegation (`get_pii`), unchanged from spec 236 |
| ALL JP-program data — adopter/facilitator records, MOU attestation, adoption declaration, contact-exchange, broker intents/matches/drafts/issuance/associations | **JP Org's vault** (`record_type` `jp:adopter:<memberSA>`, `jp:broker:intents`, …), written by JP's custodian |
| delegations an org received (e.g. adopter-org→JP) | **the recipient org's vault** (`record_type` `delegation-received:<grantorOrg>`) — single source, replaces the Connect-home `delegated-idx` KV (ADR-0013) |
| GC-specific facilitator data | GC Org's vault |

Only the member's community-wide profile is not JP's; every JP datum lives in JP Org's MCP vault.

## 4. Operator identity: sibling custody + SIWE-connect

demo-jp's operators (Pete → Global Church org; Jill → JP org) are today fixed-seed EOAs. They become
**real person Smart Agents**:

- **Sibling custody.** One operator EOA custodies BOTH its person SA and its org SA as siblings —
  different CREATE2 salts, same owner — so there is **no nested ERC-1271** (the org is not custodied by
  the person SA, but by the same EOA). The person SA is deployed + name-claimed (`pete.demo.agent`,
  `jill.demo.agent`) via the existing `/a2a/session/deploy` path.
- **SIWE-connect.** The operator EOA is registered as a SIWE/wallet credential on the person SA
  (demo-sso wallet onboarding — `bootstrapWithWallet`), so the **same demo-jp key** signs into the
  operator's own Connect home at `<handle>.impact-agent.me/you`, where they see themselves, their orgs,
  and their delegations.
- The person-SA salt is aligned with what demo-sso's wallet onboarding derives so demo-jp and Connect
  resolve the same address.

## 5. `/you` delegations view (granted + received)

The Connect home `/you` portal gains a delegations panel (`DelegationsList.tsx`) showing **both**:
- **Granted** — from `/connect/related-orgs` (each org link carries its `org→site` delegation) plus any
  person→app grants.
- **Received by your orgs** — for each org the person controls, the orgs delegated to it; the
  `/connect/delegated-orgs` surface is extended to authorize by **person-session + control-of-org**
  (person↔org is in the related vault, spec 246) so the person home can list its orgs' inbound grants,
  which are read from the recipient org's own vault (§3).

## 6. Reference: smart-agent patterns to port

From `/home/barb/smart-agent` (branch `003-intent-marketplace-proposal`):

- **PORT — per-principal data tables + delegation-gated tools.** `apps/person-mcp/src/db/schema.ts`
  keys every table by `principal` (the smart-account address); `apps/person-mcp/src/auth/verify-delegation.ts`
  extracts `principal = delegation.delegator.toLowerCase()` and queries the owner's rows with it. Our
  vault adopts exactly this owner==delegator==principal model (and we already have it in
  `withDelegation`).
- **PORT — received/cross-delegation as a holder-resident record.** `apps/person-mcp` stores inbound
  grants in a `received_delegations` table (`holderPrincipal, delegatorPrincipal, delegationJson, …`).
  We store delegations an org receives in **that org's own vault** as `delegation-received:<grantor>`
  records — the same "the recipient holds the signed grant" idea.
- **DELIBERATELY DIVERGE — typed-per-domain tables → one generic `record_type` store.** smart-agent
  ships a typed table + typed tool pair per domain (profiles, intents, beliefs, …). We use a single
  generic `vault_records(owner_address, record_type, data_json)` table + three generic tools. Why: the
  demo needs to migrate a dozen heterogeneous localStorage shapes without a schema change per shape; the
  app validates `data_json` at its boundary. Strong typing can return later as typed wrappers over the
  generic store.
- **DELIBERATELY DIVERGE — no "self-delegation" primitive.** smart-agent notes the `delegate` of the
  root delegation is *always* a session key, never the account itself
  (`output/CHAINED-DELEGATION-RESTORATION-PLAN.md`). We honor this: an agent writes its own vault via a
  delegation it **issued** (delegator = self, delegate = a session key), not a delegator==delegate loop.

## 7. Out of scope

Third-party writes to another agent's namespace (an "inbox" write model — received delegations are
written by the recipient's own custodian, or by Connect under an append-grant the recipient issued);
cross-device vault sync/encryption-at-rest beyond D1's defaults; promoting `vault-client` to a shared
package (revisit when a second app consumes it); migrating demo-jp data (that is Wave 2 — this spec is
the substrate + operator-identity wave).
