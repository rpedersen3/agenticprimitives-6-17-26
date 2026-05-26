# Spec 227 — Real end-user Connect experience (onboarding → person agent → A2A → PII MCP)

**Status:** v0 / planned (2026-05-25).
**Owner:** `apps/demo-sso` (extended into the full Connect product) + a person
**MCP** (`apps/demo-mcp` or a new `apps/person-mcp`). Wires existing packages;
adds no new package.
**Architecture commitment:** This is the **integration capstone** — it makes the
SSO wave real on Base Sepolia. No new doctrine; it executes
[ADR-0010](../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md)
(canonical SA), [ADR-0011](../docs/architecture/decisions/0011-credential-recovery-and-re-association.md)
(credentials rotate), [ADR-0016](../docs/architecture/decisions/0016-canonical-agent-id-sso-subject.md)
(no-owner session), [ADR-0017](../docs/architecture/decisions/0017-oidc-login-facet-step-up.md)
(OIDC = login facet / step-up), [ADR-0013](../docs/architecture/decisions/0013-no-silent-fallbacks.md)
(no fallbacks).
**Related specs:** [220 (bootstrap)](./220-agent-identity-bootstrap.md),
[223 (directory)](./223-identity-directory.md), [224 (connect)](./224-agentic-connect.md),
[200 (connect-auth)](./200-connect-auth.md), [215 (naming)](./215-agent-naming.md),
[216 (relationships)](./216-agent-relationships.md), [217 (profile)](./217-agent-profile.md),
[221 (recovery)](./221-credential-recovery.md).

---

## 1. Purpose

A real person onboards through Connect with **social (Google OIDC), a passkey, or
a wallet (SIWE/EOA)**; a **person Smart Agent is deployed on Base Sepolia** with a
forced-unique `.demo.agent` name; that agent provisions an **A2A service agent**
and a **person MCP** whose tools return the person's **PII, gated by the
AgentSession grade**. The person can **disconnect and reconnect via any facet —
agent name, social, passkey, or wallet — and land on the same canonical agent**
with the same access.

This proves the thesis end-to-end: **one canonical Smart Agent address; many
interchangeable credential facets; agent-spawned A2A + MCP; PII access governed
by the session.**

## 2. Reference: smart-agent patterns to port (REQUIRED)

From `/home/barb/smart-agent` (`003-intent-marketplace-proposal`):

| Pattern | smart-agent location | Port as |
| --- | --- | --- |
| Google/passkey/SIWE login → canonical SA | `apps/web/src/app/api/auth/{google-callback,passkey-signup,siwe-verify}` | our `apps/demo-sso/functions/oidc/*` + new `/connect/{passkey,siwe}` |
| Bootstrap deploy + `addPasskey` UserOp under a bootstrap owner | `apps/web/src/lib/auth/*`, `packages/sdk/bundler.ts`, `paymaster.ts` | `@agenticprimitives/agent-account` `AgentAccountClient` + `BundlerClient`, ported wiring from `apps/demo-a2a/POST /session/deploy` |
| Forced-unique `.agent` name mint + resolve/reverse | `AgentNameRegistry`/`UniversalResolver` | deployed `AgentNameRegistry` + **`PermissionlessSubregistry`** (`<label>.demo.agent`) + `AgentNamingClient` |
| Person MCP PII tools | `apps/person-mcp/src/tools/profile.ts` | our person MCP, **but session-grade gated (see §2.1)** |
| A2A/service agent + relationship edge | `AgentRelationship` `ROLE_OPERATED_AGENT` | deployed `AgentRelationship` + `agent-relationships` write path |
| Reconnect by name / any credential → same address | `passkey-verify` (name→addr), `logout` | our directory resolution (§5) |

### 2.1 Deliberate divergences (do NOT port blindly)

1. **Identity is RESOLVED, never email-derived.** smart-agent derives the SA from
   an email→KMS-HMAC salt. We do not: the OIDC `(iss,sub)` is a **login-grade
   facet resolved to the canonical agent via `identity-directory`** (ADR-0010/0016).
   The CREATE2 salt comes from **auth-methods + scope** (`AgentAccountClient`
   already does this), never email/name. No `OAUTH_SALT_HMAC_KEY`.
2. **PII is gated by the `AgentSession` role, not by a delegation token.**
   smart-agent's person-mcp verifies a delegation chain. Per the product decision
   + ADR-0017, our person MCP verifies the **Connect `AgentSession`** (the
   `connect`-owned, asymmetric, JWKS-verified, `aud`-bound token — NOT a
   `delegation.SessionRow`) and gates on `principal.role`: **login-grade reads
   basic profile; sensitive PII requires a custody-grade `AgentSession`.** This is
   a **relying-site authorization decision** (a role check on the verified
   session), NOT an on-chain custody-class action — it does NOT route through
   `connect`'s `CUSTODY_CLASS_ACTIONS`/`requiresStepUp` (those gate on-chain
   *writes*; a PII read is not a write — see §7 + Finding F5). Delegation-scoped
   PII is explicitly out of scope here (a later spec may add it).
3. **OIDC is never an on-chain custodian.** A social facet authorizes login only;
   it is recorded in the **indexer** (off-chain), confirmed `onchain-confirmed`
   only for custody-grade credentials (passkey/EOA) via `AgentAccount` reads.

## 3. The journey

```
CONNECT (apps/demo-sso, the Connect origin)
  └─ choose: Google · passkey · wallet(SIWE)
     ├─ credential verified (connect-auth)               [200]
     ├─ resolve credential → agent (identity-directory)  [223]
     │    ├─ 1 agent  → issue AgentSession  ──────────────┐
     │    ├─ many     → disambiguate                       │
     │    └─ 0        → BOOTSTRAP (§4)  ───────────────────┘
     └─ AgentSession (sub = CAIP-10 canonical agent, no owner)  [224/ADR-0016]

PROVISION (one-time, after bootstrap)
  ├─ person agent deploys an A2A service agent (2nd SA, owned by person) [§6]
  │    └─ AgentRelationship edge: a2a --OPERATES_ON_BEHALF_OF--> person  [216]
  │       (a2a is the subject/proposer; person is the object/confirmer)
  └─ person MCP holds the person's profile/PII, keyed by canonical id    [§7]

USE
  └─ person MCP: get_basic_profile (login-grade) | get_sensitive_pii (custody-grade → step-up) [§7]

RECONNECT (after disconnect)
  └─ agent name | Google | passkey | wallet  → SAME canonical agent → same session → same PII access [§5]
```

## 4. Bootstrap (0 agents → a real person SA) — executes spec 220

When resolution returns `bootstrap`, deploy a **real** `AgentAccount` on Base
Sepolia (`CHAIN_ID=84532`; NOTE broker-core currently hardcodes `CHAIN=8453`
mainnet — Phase A must parameterize it, **F2/P1-D**) via `AgentAccountClient` +
`BundlerClient` + the deployed `SmartAgentPaymaster`, porting the wiring proven in
`apps/demo-a2a POST /session/deploy`. **Salt from auth-methods + scope only**
(`deriveSaltFromLabel`); **NEVER `deriveSaltFromEmail`** (§2.1.1 / **P1-G** — that
export is a footgun; prefer deleting it per architecture-purity).

- **The server must NEVER rest as a standing custodian (P0-A).** A custody-grade
  credential anchors the SA, and the deploy MUST leave the custodian set = exactly
  the user's credential(s), with NO server key:
  - **SIWE/EOA:** the EOA is the sole custodian/owner from `createAgentAccount`.
  - **Passkey:** prefer **passkey-direct deploy** (`createAccountWithPasskey` /
    `params.initialPasskey`, the Phase 6f.4 pivot) so a server bootstrap owner is
    never a custodian. If a bootstrap owner is unavoidable, the handoff MUST be a
    SINGLE **atomic** `RotateAllCustodians(add=[userPasskey], remove=[bootstrapOwner])`
    — never additive `addPasskeyCredential` (which leaves `{bootstrapOwner, passkey}`),
    and never a two-tx window. Invariant test: `isCustodian(bootstrapOwner) == false`
    the instant bootstrap completes.
  - **Google/social FIRST (no custody credential):** create the agent only after
    the user adds a passkey (custody-grade) per the rule above; Google is a
    **login-grade facet recorded in the indexer**, NEVER an on-chain custodian (§5).
- **Paymaster preflight (P1-H):** before ANY bootstrap deploy, assert the live
  `SmartAgentPaymaster.devMode() == false` and `verifyingSigner != 0` (dev mode is
  accept-all → unauthenticated deposit drain), and enforce a per-subject
  sponsorship budget (CN-11) so a valid-envelope script can't drain the deposit.
- **Name:** mint `<label>.demo.agent` via the deployed **`PermissionlessSubregistry`**
  by composing `agent-naming` `buildRegisterSubnameCall` into an `AgentAccount.execute`
  UserOp — the write path is already LIVE; the work is **app-layer composition**
  (**F3**, not "implement the write path"). Forced-unique discovery per spec 220 §5.
- **Set primary name** + **publish a minimal profile** (spec 220 steps 3/5) so
  reverse resolution (`reverseResolveString`, spec 222) and the MCP work.
- **Record facets — authorized writes only (P0-C):** the broker records the
  `(iss,sub)`→agent indexer mapping (login-grade) + custody facets. Binding a login
  facet to an EXISTING agent MUST be authorized by a **custody-grade `AgentSession`
  of that same agent** and written **server-side by the broker** — never accepted
  from a relying site or unauthenticated client (else identity takeover). The
  indexer is a persistent store (KV/D1), not in-memory.

## 5. Resolution & reconnect (one mechanism each — ADR-0013)

Replace the in-memory fakes in `demo-sso/src/lib/broker-core.ts` — the `0x1111`/
`0x2222` addresses, the membership `Set`, the name map, AND the **Google→Alice
catch-all** (`broker-core.ts:78-105`: `confirmsCredential` returns true for any
Google subject and `agentsByOidcSubject` returns Alice — an **impersonation
vector** on a real deploy, **P0-B**) — with **real ports**:

- **NamingPort** → live `AgentNamingClient` (`resolveName`, `reverseResolve`)
  against the deployed registry. **Reconnect by name** = `resolveName(<label>.demo.agent)`.
- **OnChainReadPort** → real `confirmsCredential` via viem `readContract`:
  `AgentAccount.isCustodian(eoa)` for EOAs and the **named passkey-membership view**
  for passkeys (**U2**: name the exact custody-module getter + reconcile with
  `createAccountWithPasskey` before claiming passkey reconnect is real). `exists`
  via `viemExists`. **`confirmsCredential` MUST NEVER "confirm" an OIDC principal**
  (P0-B) — OIDC is not an on-chain custodian.
- **IndexerPort** → persistent store (KV/D1) mapping `(iss,sub)`→agent (login
  facets). **Reconnect by Google** = `agentsByOidcSubject`. The OIDC link is the
  authoritative-but-**`asserted`** answer (it can NEVER be `onchain-confirmed`);
  issuance off it is **capped at login-grade**. For custody facets the indexer only
  **proposes** and the on-chain port **confirms** (audit P1-3): a revoked custody
  credential is dropped.

**Reconnect is READ-ONLY w.r.t. custody (P2-I).** It issues an `AgentSession`
against the EXISTING on-chain custodian set and writes nothing. A new-device
passkey that is not yet a custodian resolves to **0 agents** → the explicit
spec-221 recovery ceremony (step-up + quorum), NEVER an inline auto-add. Each path
is the single canonical mechanism: empty is terminal, no escalation.

## 6. A2A service agent

The person agent provisions a **second `AgentAccount`** (the A2A/service agent),
owned by the person SA, via the same deploy path (§4). Link the two with an
`AgentRelationship` edge **`a2a --OPERATES_ON_BEHALF_OF--> person`** (spec 216):
the **a2a agent is the subject** (`OPERATES_ON_BEHALF_OF` means *subject acts on
behalf of object*, `agent-relationships/src/constants.ts`), so the **a2a agent
proposes** the edge (`proposeEdge` requires `msg.sender == subject`) and the
**person confirms** it (`confirmEdge` requires `msg.sender == object`). The write
path is already LIVE in `agent-relationships`; the app-layer work is composing
`buildProposeEdgeCall`/`buildConfirmEdgeCall` into an `AgentAccount.execute` UserOp
for each SA (the proposer/confirmer is a CustodyPolicy-gated SA, not a bare EOA).
Cross-check the edge direction against `apps/demo-web-pro`'s Treasury use before
finalizing. The A2A agent can then obtain its own `AgentSession`/scoped authority
to act for the person (e.g. fetch the person's basic profile agent-to-agent).

## 7. Person MCP with PII (`AgentSession`-role gated — ADR-0017)

A person MCP (extend `apps/demo-mcp` or add `apps/person-mcp`) exposing tools that
return the person's profile, stored in D1/KV keyed by the **canonical agent id**
(the `AgentSession.sub`). Access is gated by the **Connect `AgentSession`** (the
`connect` token, NOT a `delegation.SessionRow`), verified against the Connect
origin's **JWKS** (the MCP is a relying site; `aud` = the MCP).

**Verification lives in the APP layer, not in `mcp-runtime`.** `mcp-runtime`'s
existing tool wrapper is `withDelegation` (delegation-gated), and the vocabulary
firewall forbids `mcp-runtime` from importing `connect`/`connect-auth`. Since this
demo deliberately rejects delegation-gating (§2.1.2), the person MCP imports
`connect`'s `importJwks`/`verifyAgentSession` **in the app** to verify the token,
leaving `mcp-runtime` untouched. (A reusable `withAgentSession` runtime wrapper is
explicitly out of scope here; if it is ever wanted it is a separate spec.)

- `get_basic_profile` → display name, `.demo.agent` name, public facets. **Allowed
  for a login-grade `AgentSession`.**
- `get_sensitive_pii` → email, contact, identifiers. **Requires a custody-grade
  `AgentSession`**, gated on the cryptographic floor **`assurance >=
  'onchain-confirmed'`** (**P1-E**: `role` is an advisory broker label that can
  diverge from `assurance`; gate on `assurance`, treat `role` as a hint). This is a
  **relying-site authorization decision**, NOT `requiresStepUp(action)` /
  `CUSTODY_CLASS_ACTIONS` (**F5**: those gate on-chain *writes*; reusing them here
  fails OPEN since no PII action is in the list). **Default-deny:** any tool not
  explicitly classified is refused.

**Step-up (resolved UX↔security fork).** A login-grade session is refused with a
"confirm with your device" prompt. Step-up is a **passkey ceremony at Connect that
mints a NEW custody-grade `AgentSession`** (`aud` = the MCP), experienced as a
single device tap when the passkey is already enrolled — NOT a full re-auth, and
NOT a bare client-side WebAuthn assertion (the MCP trusts only a verifiable,
JWKS-signed custody-grade token, never a client claim). Other relying sites' sessions
are unaffected.

**Token binding (P1-F).** The MCP verifies `aud == <its own client_id>` (exact)
and `iss == Connect origin`, fail-closed on mismatch — a token minted for another
relying site is invalid here. The A2A agent (§6) fetching PII obtains its OWN
`AgentSession` with `aud = the MCP`; the person's session is never forwarded. For
`get_sensitive_pii`, enforce a short TTL and/or a `jti` replay guard.

The MCP does **not** mint or grant; it verifies the `AgentSession` and reads PII.
PII is never keyed on email (CN-3); it is keyed on the canonical agent id.

## 8. Implementation requirements

### Packages (wire existing capability; minimal new code)
- `agent-naming` / `agent-relationships`: write paths are **already LIVE**
  (`registerSubname`, `proposeEdge`/`confirmEdge` submit today; the `Phase 4`
  strings survive only in stale doc-comments — **F3**). NO package change: the work
  is **app-layer composition** of the existing `build*Call` builders into an
  `AgentAccount.execute` UserOp (proposer/confirmer is a CustodyPolicy-gated SA, not
  a bare EOA). Clean up the stale `Phase 4` comments + package `CLAUDE.md`s.
- `identity-directory-adapters`: provide a **real `OnChainReaders`**
  (`isCustodian` / the named passkey-membership `readContract`) for
  `makeOnChainReadPort`. MUST NOT confirm an OIDC principal (**P0-B**).
- `agent-account` / `account-custody`: reuse `AgentAccountClient` deploy +
  the **atomic** custodian-handoff path (**P0-A** — `RotateAllCustodians` or
  passkey-direct deploy, never additive `addPasskeyCredential` leaving the
  bootstrap owner in the set).

### Apps — REUSE the deployed workers, do not duplicate (architecture decision)

The sibling demos already implement + deploy every on-chain flow on Base Sepolia.
`demo-sso` **reuses** them rather than re-porting the relayer/bundler/deploy code
(which would otherwise need a fresh security re-audit):

- **`demo-sso` owns ONLY:** (1) the unified **Connect UI** (§12 / UX W-1..W-5);
  (2) the **Connect broker** — `AgentSession` issuance + `/jwks` (already live);
  (3) **real directory resolution** (§5) — live `NamingPort` + real
  `OnChainReadPort` + persistent (KV) `IndexerPort`.
- **Reuses the deployed `demo-a2a` Worker** (proxy `/a2a/*`, exactly as `demo-web`
  does) for: SA **deploy** (`/session/deploy` + `/session/deploy/submit`, passkey
  or EOA), **SIWE verify** (`/auth/siwe-verify`, ERC-1271/6492), **custody
  ceremonies** + `/account/{build,submit}-call-userop` (execute-call), and
  **reverse-resolve**. The relayer ("we are the bundler" → `EntryPoint.handleOps`),
  KMS signer, and paymaster wiring all already live there.
- **Reuses `claim-psa-name` + `name-cache`** (from `demo-web-pro`) for forced-unique
  `<label>.demo.agent` minting (sequential-suffix) + the address→name cache.
- **Reuses `connect-auth`** (`/passkey`, `/siwe`, `/google`) for the credential
  ceremonies; the WebAuthn create/get + COSE→(x,y) + `credentialIdDigest` helpers.
- **Person MCP** = extend `demo-mcp` (or a thin person-mcp): the two §7 tools, but
  add **`AgentSession` JWKS verification in the app layer** (`connect`'s `importJwks`
  / `verifyAgentSession`) — today `demo-mcp` verifies only delegation; the
  session-grade gate (§7) is new.

Net new code is the UI + the real directory + the MCP session-gate; the on-chain
machinery is called, not rebuilt.

### Infra / secrets (names only)
`RPC_URL` (Base Sepolia, as a secret), `CHAIN_ID=84532`, `BUNDLER_URL`,
`SmartAgentPaymaster` (exit dev mode → `PAYMASTER_VERIFYING_SIGNER` + a KMS signer
for envelopes), the bootstrap-owner signer (KMS), the broker `BROKER_PRIVATE_JWK`
(ES256, already live). No `OAUTH_SALT_HMAC_KEY` (divergence §2.1).

## 9. Phase plan (each phase is independently demoable)

> **Status (2026-05-25): all phases A–E BUILT + DEPLOYED** at
> https://agenticprimitives-demo-sso.pages.dev. Server-side + resolution verified
> live; the interactive on-chain *writes* (bootstrap deploy, name-claim, A2A edge)
> are code-complete and need an in-browser wallet/WebAuthn pass + a
> `pnpm deploy:cloudflare` to add the demo-sso origin to demo-a2a `ALLOWED_ORIGINS`.

- **A — Real resolution.** Parameterize `CHAIN` from `CHAIN_ID=84532` (drop the
  hardcoded `8453`, **F2/P1-D**). Swap demo-sso's fakes (incl. the Google catch-all)
  for live NamingPort + real OnChainReadPort + persistent IndexerPort. Seed 1–2
  **real deployed SAs** as fixtures **produced by a one-off script that runs the
  spec-220 sequence** (deploy → register → setPrimaryName) so reverse-by-name
  round-trips (**U3**). Reconnect by **name** and by **passkey/EOA** becomes real.
  *(No bootstrap in the app yet — uses pre-deployed agents.)*
- **B — Real bootstrap.** First connect with 0 agents deploys a real person SA
  (§4) for passkey/SIWE, mints `<label>.demo.agent`, records facets. Google-first
  → guided "secure your workspace" passkey step (framed as backup sign-in, §12).
  **Name availability is checked BEFORE deploy** (debounced inline; never fail the
  deploy on a name conflict). The on-chain deploy gets a **named progress + failure
  /retry waiting state** ("Creating your workspace", §12 W-3) — never a bare spinner.
- **C — Person MCP + PII.** The two `AgentSession`-gated tools (§7); demo-sso UI
  reads basic PII (login-grade), and the **blur + "confirm with your device"**
  reveal demonstrates custody-grade step-up (§12 W-4).
- **D — A2A service agent.** Provision the 2nd SA + the `a2a --OPERATES_ON_BEHALF_OF
  --> person` edge (§6); the A2A agent fetches the person's basic profile with its
  OWN session (`aud`=MCP). Provisioning is **background / fire-and-forget** with a
  "setting up…" status — it MUST NOT block or fail the person's onboarding (§12).
- **E — Reconnect across all facets + polish.** Disconnect/reconnect via name /
  Google / passkey / wallet → same agent → same access, with the "welcome back /
  same workspace" moment (§12 W-5); UI + docs; update `apps/demo-sso/CLAUDE.md` +
  memory; mark the wave complete.

**Every phase** also seeds the matching CN-1..CN-12 rows in
`docs/audits/evidence-checklist.md` and migrates/extends the threat-model boundary
(SSO-wave "Boundary I" → the broker-originated deploy path) per spec 214 (**P2-J/K**),
and adds regression tests for the corrected edge direction (F1) + the
`AgentSession`-assurance PII gate (P1-E).

## 10. Out of scope (this spec)
- Delegation-scoped PII (session-grade only here; a later spec may add caveats).
- Credential recovery / rotation UX (spec 221 owns it; reconnect ≠ recovery).
- Mainnet, gas-abstraction productionization beyond exiting paymaster dev mode.
- Replacing the persistent indexer with GraphDB/SPARQL (spec 225 §7 — later).

## 11. Open questions
1. **Bundler + paymaster (gates Phase B):** which Base Sepolia bundler, and the
   paymaster verifying-signer + KMS slot — must exit dev mode + pass the §4 preflight
   before any real deploy (P1-H).
2. **Custodian-handoff mechanism (narrowed):** P0-A fixes the *invariant* (server
   never rests as a custodian); the remaining choice is passkey-direct deploy
   (`createAccountWithPasskey`, Phase 6f.4) vs. atomic `RotateAllCustodians` — pick
   per the factory's actual capability before Phase B.
3. **Person MCP home:** extend `apps/demo-mcp` vs. a focused `apps/person-mcp`.

*Resolved during review:* edge direction (F1); chain-id 84532 (F2/P1-D); PII gate
is a relying-site `assurance` check, not `CUSTODY_CLASS_ACTIONS` (F5/P1-E); step-up
= a passkey ceremony minting a custody-grade `AgentSession`, not a bare client
assertion (§7); `(iss,sub)` enrollment requires a custody-grade session of that
agent (P0-C).

## 12. UX requirements (from the UX review — binding)

The demo today is an *architecture proof*, not an experience. The real product MUST
(audience includes non-crypto users):

- **Frame before auth** — a one-sentence value prop ("your portable workspace,
  created once, works everywhere") before any credential choice (W-1).
- **Lead with Google**; passkey as "Use this device"; wallet behind "More options".
  A returning-user **name field** (`alice.demo.agent`) on the entry screen.
- **Plain language always** (copy map below). Never surface `AgentSession`,
  `CanonicalAgentId`, CAIP-10, `kid`, "custody-grade", or raw JSON/addresses as
  primary UI; the SA address sits in a collapsed "Details" accordion as a trust signal.
- **"Secure your workspace", not bait-and-switch** (W-2): the Google-first passkey
  step is "add your device as a backup sign-in", with a 4-step progress bar showing
  they're nearly done and the *why* (losing Google access) stated first; a smaller
  "I'll do this later" escape + a persistent dismissible nudge.
- **Named deploy waiting state** (W-3): plain milestones driven by real bundler
  events, optimistic commit on bundle receipt, explicit failure + "Try again"
  ("nothing was saved"), and a >30s "taking longer than expected" hint.
- **PII panel always renders; sensitive fields blur** with inline "Confirm with your
  device" (W-4) — the *shape* of the data is the protection signal. Blur is CSS-only
  over placeholder content; real PII is fetched only after step-up.
- **Reconnect payoff** (W-5): a "Welcome back / same workspace" moment that makes
  cross-credential continuity legible.
- **A2A + MCP provisioning is background** ("setting up…"), never blocking, never
  fails the main flow.
- **"Sign out", never "disconnect"**; a **disambiguate screen** lists human names +
  dates, never raw addresses.
- **Accessibility:** focus moves to the new step heading on transition; progress uses
  `aria-current`; blurred PII is hidden from AT until reveal; CTAs ≥44px; status never
  color-only; `role="status"` on deploy progress.

Copy map: device (not "passkey") · "your workspace"/`name.demo.agent` (not "Smart
Agent"/SA/CAIP-10) · "standard access"/"full access (confirmed with device)" (not
login/custody-grade) · "Creating your workspace"/"securing on the network" (not
"deploying a smart contract") · "Welcome back / same workspace" (not "resolved to
canonical agent"). Wireframes W-1..W-5 are in the UX review (this session's transcript).

## 13. Review findings folded (architect + security + UX, 2026-05-25)

Audited by `technical-architect-auditor`, `security-auditor`, `ux-designer`. Binding
corrections folded above — Architect: **F1** edge direction (§3/§6); **F2/P1-D** chain
84532 (§4/§9); **F3** write paths live → app-layer composition (§4/§8); **F4** vocab
`AgentSession`; **F5/P1-E** PII = `assurance` check + default-deny (§7); **U1** MCP
verifies in the app layer (§7); **U2** name the passkey getter (§5); **U3** Phase-A
fixtures via a spec-220 script (§9). Security: **P0-A** atomic custodian handoff (§4);
**P0-B** remove Google catch-all, OIDC never on-chain-confirmed (§5); **P0-C**
`(iss,sub)` enrollment needs a custody-grade session (§4); **P1-F** exact `aud` +
A2A own-session + replay guard (§7); **P1-G** no `deriveSaltFromEmail` (§4); **P1-H**
paymaster preflight + per-subject budget (§4); **P2-I** reconnect read-only (§5);
**P2-J/K** seed threat-model + evidence-checklist per phase (§9). UX: §12 (binding).
Security findings to be landed in the relevant `AUDIT.md`/dossier docs during the
hardening wave.
