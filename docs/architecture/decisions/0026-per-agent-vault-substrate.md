# ADR-0026 — An agent's data lives in its own delegation-gated vault, keyed by the delegator-principal

**Status:** Accepted (2026-06-02).
**Drivers:** ADR-0010 (the SA address is the canonical identifier — so the SA is also where its data
lives); ADR-0013 (one mechanism per read path — no duplicate indexes, no fallbacks); ADR-0021 (generic
substrate in apps, vocabulary in apps); spec 236 (JP is the data custodian).
**Concrete spec:** [spec 247 — Per-agent MCP vault](../../../specs/247-per-agent-mcp-vault.md).

---

## Context

demo-jp keeps a person's profile, a program's records, and a broker's working state in browser
`localStorage`. That makes the data per-browser, unshareable, and unauditable, and it splits "the agent"
from "the agent's data": the SA exists on-chain while everything about it lives in one operator's
browser. The project's model says the opposite — every person and org IS a Smart Agent, and trust-bearing
data should sit behind the same delegation that governs every other agent action.

demo-mcp already proves the access pattern for reads (`get_pii` keyed by the delegation's delegator) but
has no generic, writable store to migrate the localStorage shapes onto.

## Decision

**Each Smart Agent's data lives in its own delegation-gated vault, on a generic per-agent store, keyed by
`owner_address` where the owner is always the delegation's delegator (`principal`). An agent — and only
an agent — reads or writes its own namespace, by presenting a delegation it issued.**

1. **Generic substrate, not typed-per-domain.** One table `vault_records(owner_address, record_type,
   data_json, …)` and three generic tools (`get/set/list_vault_record`) wrapped in the existing
   `withDelegation` gate. The substrate is vertical-agnostic; record-type strings and JSON shapes are the
   app's vocabulary (ADR-0021), validated at the app boundary.
2. **Owner == delegator == principal.** The MCP keys every read/write by the recovered `principal`. A
   token whose delegator is agent A cannot touch agent B's records. To write your own vault you present a
   delegation you issued (`delegator = self`, `delegate =` a session key); for an org SA, its custodian
   produces the ERC-1271 signature.
3. **The vault is the single source.** Data that moves into an agent's vault is read back only from that
   vault — not duplicated into a relying-app store, a browser cache, or a central index. Delegations an
   org receives live in the recipient org's vault (replacing the Connect-home `delegated-idx` KV); the
   `/you` panel and the broker dashboard both read that one place (ADR-0013).
4. **Residency follows ownership.** The member's community profile stays at Impact (the person's MCP);
   all JP-program data lives in JP Org's vault (JP is the data custodian, spec 236); GC-specific data in
   GC's vault.
5. **Operators are real agents.** demo-jp's operator EOAs custody both a person SA and an org SA as
   siblings (same owner, distinct salts — no nested ERC-1271) and connect to their own Connect home via
   SIWE, so the data has a real, addressable, connectable owner rather than an anonymous browser key.

## Consequences

- demo-mcp gains a generic table + three tools; demo-a2a gains `/mcp/vault/*` proxy routes; demo-jp gains
  a `vault-client`. No `packages/*` change — the substrate is app-level, reusing the package primitives
  (`delegation`, `mcp-runtime` `withDelegation`, `audit`).
- demo-jp's `vault.ts` / `broker-store.ts` accessors keep their signatures but swap localStorage bodies
  for vault calls (Wave 2) — a data migration, not a refactor.
- The Connect-home `delegated-idx` KV is removed in favor of the recipient org's vault; the org grants
  Connect a scoped append-delegation at deploy time so Connect can write inbound grants into it.
- A genuine cost: writing another agent's namespace is intentionally impossible, so "deliver a delegation
  to JP" requires either JP's custodian to write it or an explicit append-grant — there is no anonymous
  inbox write.

## Alternatives rejected

- **Keep localStorage (status quo).** Per-browser, unshareable, unauditable; splits the agent from its
  data.
- **Typed table + typed tool per domain (smart-agent's shape).** Cleaner typing, but a schema + tool
  change per localStorage shape migrated; the generic store migrates a dozen heterogeneous shapes with no
  substrate change. Typed wrappers can return over the generic store later.
- **A central Connect-home index for all agent data + received delegations.** Re-creates the duplicate-
  store / fallback problem ADR-0013 forbids and keeps data away from the agent that owns it.
- **Anonymous inbox writes (any agent appends to another's namespace).** Breaks the owner==principal
  invariant and opens a spam/spoof surface; received grants are written by the recipient's custodian or
  under an explicit append-grant instead.
