# Spec 103 — Spec Reorganization Map

**Status:** v0 draft · 2026-05-19
**Depends on:** [`101-v0-package-proposal.md`](./101-v0-package-proposal.md)
**Purpose:** map content from the original four specs (001–004) into the six new package specs (200–205). No research is lost; content is re-bucketed to match the new package boundaries.

---

## 1. The current → new mapping at a glance

```
specs/001-auth.md
    ├──► specs/200-identity-auth.md       (auth methods, sessions, CSRF)
    └──► specs/201-agent-account.md       (smart-account substrate, factory, EIP-4337)

specs/002-delegation.md
    └──► specs/202-delegation.md          (mostly intact; absorbs session lifecycle from 003)

specs/003-kms.md
    ├──► specs/203-key-custody.md         (providers, envelope encryption, signers, MAC)
    └──► specs/202-delegation.md          (session lifecycle moves here)

specs/004-mcp-resources.md
    ├──► specs/204-tool-policy.md         (classification, risk tiers, exact-call policy)
    └──► specs/205-mcp-runtime.md         (auth middleware, JTI, withDelegation wrapper)

specs/000-product-overview.md             (updated to reflect new 6-package set)
```

Numbering: existing 000-004 stay (with 000 updated). New per-package specs use the 200-block to leave gaps for boundary doctrine and process docs (100s) and future per-area architecture docs (300s+) without renumbering later.

---

## 2. `specs/001-auth.md` → split into 200 + 201

| Original section in 001 | Destination | Notes |
| --- | --- | --- |
| §1 Goal | Split: auth half → 200, account half → 201 | Two clean halves. |
| §2 Auth methods (passkey/SIWE/Google) | **200-identity-auth.md** | Verbatim. |
| §3 Session model (JWT, cookie, claims) | **200-identity-auth.md** | Verbatim. |
| §4 Smart account model (factory, salt derivation, lazy deploy) | **201-agent-account.md** | Verbatim. |
| §5 Public API | Split | Auth/session/CSRF/signer-interfaces → 200; `AgentAccountClient`, salt helpers → 201. |
| §6 Security boundaries | Split | JWT/CSRF/replay items → 200; salt-collision / contract-trust items → 201. |
| §7 Test plan | Split | Auth-method tests → 200; deterministic-address + deploy tests → 201. |
| §8 Open questions | Split | "Email/password fallback?" "Apple Sign In?" → 200; "ERC-4337 v0.9 migration?" → 201. |
| §9 Smart-agent file index | Split | Lines under `auth/*` → 200; `account.ts` + contracts → 201. |

**New material in 201 not in 001:** ERC-1271 verification utilities, UserOp building helpers, A2A bootstrap relayer pattern (currently lives in 002 §5 but is account-substrate, not delegation).

---

## 3. `specs/002-delegation.md` → mostly 202, but absorbs session lifecycle

| Original section in 002 | Destination | Notes |
| --- | --- | --- |
| §1 Goal | 202 | Refresh: emphasize session lifecycle is now in-scope. |
| §2 Standard (EIP-712, ERC-1271, ERC-7710-aligned) | 202 | Verbatim. |
| §3 Caveat vocabulary | 202 | Verbatim. |
| §4 Token envelope | 202 | Verbatim. |
| §5 Session-delegation lifecycle | 202 | **Expanded** with content from 003 §4 (session encryption details, Variant A/B). |
| §6 Cross-delegation | 202 | Verbatim. |
| §7 Public API | 202 | **Add** `SessionManager` class, `SessionStore` interface (from 003). |
| §8 Configuration | 202 | Verbatim. |
| §9 Fail-closed evaluation rule | 202 | Verbatim. |
| §10 Test plan | 202 | Verbatim + session-lifecycle tests merged in. |
| §11 In-flight items | 202 | Verbatim. |
| §12 Smart-agent file index | 202 | **Expanded** with session.ts / session-init.ts lines from 003. |

**Net effect:** 202 is roughly the same shape as 002 but is now the home for "what authority does a session carry and when does it expire," not just "what does a delegation look like."

---

## 4. `specs/003-kms.md` → narrowed to 203 + sessions evicted

| Original section in 003 | Destination | Notes |
| --- | --- | --- |
| §1 Goal | 203 | **Rewrite:** narrow to "envelope encryption + signers + HMAC." Session lifecycle removed. |
| §2 Backends shipped | 203 | Verbatim. |
| §3 Core interfaces | 203 | Verbatim. |
| §4 Session package model | **Move to 202** | Belongs in delegation now per the KMS-landscape research signal. |
| §5 Public API | 203 (narrowed) | Remove `encryptSessionPackage` / `decryptSessionPackage` from this package's surface — they become methods on `SessionManager` in 202. **OR** leave them as low-level escape hatches in 203 and have 202's `SessionManager` call them. (Recommendation: latter — 203 exposes the primitive, 202 owns the lifecycle.) |
| §6 Security boundaries | 203 | Verbatim. Production guard + relay-only master + AAD trip-wire stay here. |
| §7 Layering on delegation | **Move to 202** | This section was describing the integration boundary — that conversation belongs in the consumer (delegation), not the provider (KMS). |
| §8 Test plan | 203 (narrowed) | Remove session round-trip tests (move to 202); keep AAD bind/unbind, KMS provider mocks, production guard. |
| §9 In-flight items | 203 | GCP rollout + Phase-B relay-only stay; Phase-B variants A/B note moves to 202. |
| §10 Smart-agent file index | 203 (narrowed) | Keep key-custody/* and encryption.ts; session.ts moves to 202's index. |

**Net effect:** 203 is roughly half the surface of 003 — exactly the "narrower than my original scope" the proposal calls out.

---

## 5. `specs/004-mcp-resources.md` → split into 204 + 205

| Original section in 004 | Destination | Notes |
| --- | --- | --- |
| §1 Goal | Split | "Eliminate duplication across smart-agent MCPs" → 205; "protocol-agnostic policy taxonomy" → 204 (new framing). |
| §2 The pattern (verification pipeline) | 205 | Mostly verbatim. **Add** explicit "step 7 (caveat eval) delegates to 202; step 8 (JTI) stays here." |
| §3 Resource model | 205 | Verbatim. |
| §4 Tool wrapper API (`withDelegation`) | 205 | Verbatim. |
| §5 Cross-delegation bridging | 205 | Verbatim. |
| §6 JTI replay protection | 205 | Verbatim. |
| §7 Classification metadata | **204** | This is the protocol-agnostic taxonomy — it moves to tool-policy. |
| §8 Test harness | 205 | Verbatim. |
| §9 Public API summary | Split | Resource wrappers + JTI → 205; classification types + lint → 204. |
| §10 Non-goals | 205 | Verbatim (still applies). **Add** in 204: "Not a transport layer; not a runtime — just the decision primitives." |
| §11 Migration story | 205 | Verbatim. |
| §12 Test plan | Split | MCP integration tests → 205; classification lint tests → 204. |
| §13 Smart-agent file index | Split | `*-mcp/src/auth/*` → 205; classification scripts → 204. |

**New material in 204 not in 004:**
- Risk-tier taxonomy (was implicit; now first-class).
- `evaluatePolicy(ctx)` function spec (the decision engine the agent protocol research called out).
- Exact-call policy DSL (`exactCall`, `matchesExactCall`).
- Explicit positioning as protocol-agnostic ("consumable by MCP, A2A, LangGraph").

---

## 6. `specs/000-product-overview.md` updates

Replace the package map table with the new 7-package set. Update the runtime composition diagram to show:

- Browser: `identity-auth` + `agent-account` + `delegation`.
- A2A agent: `delegation` (session lifecycle) + `key-custody` (raw signing) + `tool-policy` (decision engine).
- MCP server: `mcp-runtime` (middleware) + `delegation` (verification) + `tool-policy` (classification).

Update the dependency-direction diagram to match `101-v0-package-proposal.md` §3.

Keep the provenance pointer to smart-agent `003-intent-marketplace-proposal` — that doesn't change.

---

## 7. What to do with current `packages/*/` source skeletons

The four package directories I created (`packages/{auth,delegation,kms,mcp-resources}/`) and their `src/index.ts` files contain TypeScript declarations of the original 4-package API surface. Restructuring options:

| Option | Action | Cost |
| --- | --- | --- |
| **Wipe** | `rm -rf packages/*/`, scaffold fresh from 101 | Loses ~400 lines of type declarations |
| **Rename + restructure** | Move `packages/auth/src/index.ts` content half to `packages/connect-auth/`, half to `packages/agent-account/`; same for others | Preserves declarations but bookkeeping-heavy |
| **Salvage select pieces, wipe the rest** | Keep `packages/delegation/src/index.ts` (mostly maps cleanly); wipe and re-author the other three | Pragmatic middle |

**Recommendation: wipe.** The type declarations were thin skeletons (no real implementation). Re-authoring against the new 6-package boundary is faster than re-bucketing line by line. Cost: ~30 minutes of writing. The specs are the durable artifact; the package skeletons are derivative.

---

## 8. Order of operations for the rescaffold (next turn)

When you approve, the rescaffold does:

1. Move existing `specs/00X.md` → `specs/_archive/00X-<name>.md` (preserve, don't delete).
2. Write new `specs/200-205-*.md` per the mapping above.
3. Update `specs/000-product-overview.md` per §6.
4. Delete `packages/{auth,delegation,kms,mcp-resources}/`.
5. Scaffold `packages/{identity-auth,agent-account,delegation,key-custody,tool-policy,mcp-runtime,types}/`, each with:
   - `package.json` per the public-exports lists in 101.
   - `capability.manifest.json` per the schema in 102.
   - `CLAUDE.md` per the template in 102.
   - `README.md` (≤ 1800 words, quickstart).
   - `tsconfig.json` extending base.
   - `src/index.ts` with the public-API declarations.
6. Update root `README.md` and root `CLAUDE.md` to reflect the new 7-package shape.
7. Add `scripts/` placeholders for the CI guardrails (102 §5) — not implemented, just file stubs with `TODO: implement per spec 102`.
8. New commit on top of `fcde637`.

No `pnpm install` yet (we haven't authored real implementation; the install can happen when the first package gets real code).

Net commit: ~25 new files, ~10 deleted files, ~3 modified files.
