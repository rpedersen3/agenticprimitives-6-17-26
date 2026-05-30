# Pre-Production Readiness Audit — `demo-jp` + `demo-sso-next`

| Field | Value |
|---|---|
| **Date opened** | 2026-05-29 |
| **Scope** | `apps/demo-jp` (JP Adopt pilot, spec 236), `apps/demo-sso-next` (Impact Community SSO / portal — the IdP), and the workspace packages they consume. |
| **Trigger** | User-requested deep pre-launch audit to prepare for a third-party critical review before production. |
| **Method** | Two specialist sub-audits run in parallel — `security-auditor` (STRIDE per boundary, source review of every routed handler, consumed-package security cores) + `technical-architect-auditor` (doctrine sweep against CLAUDE.md / ADRs 0010/0011/0013/0017/0019/0021 / specs 100/206/214/229/230/234/235/236) — plus a self-catalog of every deliberate demo shortcut shipped over the recent build sprint. |
| **Status** | Open — this document is the living tracker. Update the Status column per finding as waves close; re-audit after each hardening wave. |
| **Companion docs** | `docs/audits/threat-model.md`, `docs/audits/evidence-checklist.md`, `docs/audits/architecture-diagram.md` (all flagged stale by ARCH-005 — refresh as part of this work). |

---

## Status legend

| Symbol | Meaning |
|---|---|
| 🔴 OPEN | Finding active; not yet addressed. |
| 🟡 IN PROGRESS | Wave assigned + work started. |
| 🟢 CLOSED | Patched + verified; remediation logged in the row. |
| ⚪ ACCEPTED | Risk accepted with written justification (link required). |
| 📝 DOC | Documentation-only fix (spec, ADR, runbook). |

---

## Executive summary — what a third-party reviewer will fixate on

The package boundary is in good shape. Every doctrine guard that targets packages passes (`check:no-domain-in-packages`, `check:forbidden-terms`, `check:package-boundaries`, `check:dependency-graph`, `check:capability-manifests`, `check:cross-cutting-capabilities`). The JP / faith vertical sits firmly at the app layer where ADR-0021 wants it. The first reviewer dollar is spent below the package line — in the apps + the OIDC + the substrate underneath.

The **TOP 7 risks** a reviewer will lead with (severity in parens, security-auditor IDs prefixed `SEC-`, technical-architect IDs prefixed `ARCH-`):

1. **SEC-001 (P0) — `/oidc/grant` accepts arbitrary signed delegations as proof-of-possession for any registered client.** The spec-230 §4.2 + ADR-0019 closure condition ("server-minted enrollment grant bound to `{aud, agent, delegate, caveatHash, redirect_uri, state}`") is **not implemented**. The shipped grant endpoint only verifies the delegation ERC-1271 + the client_id is registered + the redirect_uri exact-matches — it does not require the delegation be tied to an in-flight authorization at this `iss` for this `client_id`. Any leaked delegation can be replayed at `/oidc/grant` with attacker-chosen `nonce` + `agent_name` to mint a valid id_token for any registered client. **Full account takeover from any leaked delegation.** The unused `apps/demo-sso-next/server/authorize.ts` is the documented-but-uncalled scaffold for the spec-230 §4.2 path.

2. **SEC-002 (P0) — `/token grant_type=delegation` mints id_tokens with attacker-chosen `aud`.** Silent re-auth accepts `{ delegation, client_id, redirect_uri }` and mints an id_token with `aud = client_id`, but the verifier does NOT check that the delegation's caveats authorize that client. Combined with the shared delegate (SEC-003), a delegation issued for `demo-org` is fully replayable at `client_id=demo-jp`. Lateral movement across every relying app in the registry is one POST away.

3. **SEC-003 / ARCH-004 (P0) — Shared default delegate SA reused as paymaster verifying signer.** `apps/demo-jp/src/connect-client.ts:362-364` and `apps/demo-org/src/connect-client.ts:361` both default to `0x89D13c596c45E4eE80Af5ae06C727FE9A820ffD0` when `VITE_DEMO_*_DELEGATE` is unset; `apps/demo-a2a/wrangler.toml:127` uses the SAME address as `PAYMASTER_VERIFYING_SIGNER`. Three roles on one address: revoking either site's delegation revokes both, AND a paymaster-key compromise leaks every relying site's delegate identity. The code comment partially flags it ("In production demo-jp must have its OWN delegate SA"); the paymaster collision is unflagged.

4. **SEC-006 (P1) — `iss` claim derived from arbitrary `Host` header on Vercel.** `apps/demo-sso-next/server/_lib/origin.ts:11-18` builds the issuer URL from `request.headers.get('host')` with no allowlist. Combined with the client-side `resolveAuthOrigin(nameLabel(name))` at the relying app (which trusts the user-typed name to derive the expected `iss`), an attacker who can reach the Vercel app with a foreign Host or route a chosen subdomain to it gets the broker to sign `iss=https://<attacker-host>` and have it accepted by JP.

5. **ARCH-001 / SEC-008 (Critical / P1) — No persistence substrate. The whole SSI surface is browser localStorage.** Every JP record (`JpAdopterRecord`, `JpFacilitatorRecord`, contact-exchange consent, published updates), every Impact-side store (`ImpactProfile`, WEA attestation), every session token — all in browser localStorage. There is **no spec, no ADR, no operator runbook, no threat-model row, and no evidence-checklist entry** for the production substrate (the "vault MCP only the member can open via their home credentials" the user keeps describing). The UI claims `"Disconnect at home → JP's projection goes empty"` are **false today** — JP's localStorage survives whatever Impact does. A reviewer who reads the SSI promise then opens DevTools sees the disconnect.

6. **ARCH-002 / SEC-004 (Critical / P1) — `/profile` and `/wea-sign` cross-origin handoff is unspecced and ships PII in URL query params.** Brand-new protocol added without an architect-of-record document. Spec 230 + spec 234 §6 say cross-site authority/information flow is OIDC id_token + scoped delegation; this side-channel runs alongside it carrying `firstName, lastName, email, phone, country, city, organizationName, organizationCountry` as plaintext `?profile_<key>=…` URL params (logged in CDN access logs, browser history, Referer headers, screen-shares, browser extensions). Code comments acknowledge it as a demo limitation; the production replacement (delegated server-to-server read) is not specced.

7. **SEC-007 / ARCH-003 (P1 / High) — MOU + WEA "attestations" are not signatures.** `apps/demo-jp/src/lib/mou.ts:62-74` (`attestDocConsentBound`) and `apps/demo-sso-next/src/wea-doc.ts:44-50` (`buildWeaAttestation`) both return `{ docHash: SHA-256(docText), docId, signedAt, consentBoundTo: SHA-256(stringOfSomething) }`. **No keypair signs the attestation.** The "receipt" + UI claim "✓ Signed at your home" + the legal-flavored MOU commitment language are all manufacturable by anyone in possession of the session token. The "consent-binding" promise (revoke delegation → attestation voided) is implementable in principle but not actually wired — nothing re-verifies `consentBoundTo` against the current delegation state.

Beyond the seven, **ARCH-005** (the existing audit dossier — threat model, evidence checklist, architecture diagram — doesn't know `demo-jp`, `demo-sso-next`, or specs 232/234/235/236 exist) is what closes Gates 2+3 of spec 214. A reviewer who opens the dossier first lands on a stale map of the system.

---

## Status tracker

Update the **Status** + **Wave / target** columns over time. Add a remediation reference (commit SHA, spec link, ADR link) inline once closed.

### Security findings (from `security-auditor`)

| ID | Severity | Component | One-line | Demo-cut? | Status | Wave / target | Cross-refs |
|---|---|---|---|---|---|---|---|
| SEC-001 | 🔴 P0 | `server/oidc/grant.ts` | No server-side enrollment-grant binding; any signed delegation → id_token for any client. | No | 🟢 CLOSED | H6 (commit `06ba0d5` + this wave) | spec 230 §4.2 — server-minted enrollment grant table + Origin check at /oidc/grant + per-client delegate from registry; `apps/demo-sso-next/server/oidc/authorize-grant.ts` (new) |
| SEC-002 | 🔴 P0 | `server/token.ts` | Silent-re-auth id_token `aud` not bound to delegation's caveats; cross-client replay. | No | 🟢 CLOSED | H6 | `oidc-deleg:<digest>` binding written at /oidc/grant + enforced at /token grant_type=delegation; delegation not minted through /oidc/grant is rejected |
| SEC-003 | 🔴 P0 | `apps/demo-{jp,org}/src/connect-client.ts` + `apps/demo-a2a/wrangler.toml` | Shared default delegate SA + paymaster signer collision. | Yes (partial) | ⚪ ACCEPTED | Deferred per user direction ("not worried about single wallets/funder at this point") | ARCH-004 — config-only change to split; broker now enforces "delegate must match registered" so a future per-app split is one config edit |
| SEC-004 | 🟠 P1 | `app/(portal)/{profile,wea-sign}/page.tsx` ↔ `apps/demo-jp/src/App.tsx` | PII rides `?profile_<key>=…` URL params on return. | Yes | 🔴 OPEN | H8 Handoff hardening | ARCH-002, ADR-0019 |
| SEC-005 | 🟠 P1 | `src/components/onboarding/useEnrollReq.ts` + `src/whitelabel/config.ts` | `ALLOWED_RELYING_ORIGINS` hardcoded + out of sync with `relyingApps[].redirect_uris`. | No | 🟢 CLOSED | H6 | Derived from `whitelabel.relyingApps[].redirect_uris` via `isAllowedRelyingOrigin` in `oidc-clients.ts`; hardcoded array deleted from `useEnrollReq.ts` |
| SEC-006 | 🟠 P1 | `server/_lib/origin.ts` | `iss` derived from attacker-controlled `Host` header; no issuer allowlist at broker or RP. | No | 🟢 CLOSED (extended) | H6 + follow-up | `ALLOWED_ISSUER_HOSTS` env at broker; default `impact-agent.me + *.impact-agent.me`; foreign Host → `IssuerHostNotAllowedError`. **Follow-up re-audit (SEC-024) extended this to `/connect/{passkey,with-name,stepup}` + `/oidc/google/{callback,rotate}` — every endpoint that mints signed material now gates `iss` through `resolveOrigin`.** |
| SEC-007 | 🟠 P1 | `apps/demo-jp/src/lib/mou.ts` + `apps/demo-sso-next/src/wea-doc.ts` | "Attestation" is `{docHash, consentBoundTo}` — no signature. | Yes | 🔴 OPEN | R/N follow-up | ARCH-003, spec 236 P2 |
| SEC-008 | 🟠 P1 | demo-jp `vault.ts` + `matches.ts` + `App.tsx` ContactExchangeWidget | Every record in browser localStorage; revocation + match + handshake are theatrical. | Yes | 🔴 OPEN | R/N follow-up (substrate) | ARCH-001 |
| SEC-009 | 🟡 P2 | `server/connect/enroll.ts` + `src/lib/kv-indexer.ts` | No rate limit; `kv.put` overwrites prior facet (silent agent bridging on credKey collision). | No | 🟢 CLOSED (append-only) / ⚪ DEFERRED (rate-limit) | H6 (architectural) + operational lane (rate-limit) | `appendLink()` + dedupe by (agent, assurance, ref); rate-limit needs infrastructure choice |
| SEC-010 | 🟠 P1 | `server/oidc/google/callback.ts` + `server/_lib/server-broker.ts` | Single `A2A_CUSTODY_BRIDGE_SECRET` controls every Google × KMS resolve. | No | 🟢 CLOSED | H6 (folded in) | HMAC envelope `{X-Bridge-Timestamp, -Nonce, -Audience, -Signature}` + audience pin + freshness window + single-use nonces. `bridge-hmac.ts` on both sides |
| SEC-011 | 🟡 P2 | `server/_lib/verify-delegation.ts` + `server/connect/{passkey,siwe}.ts` | `isDeployed` polls up to 12–15s in the request path; trivial DoS. | No | 🟢 CLOSED | H6 | Single check; fail-closed with "retry shortly" if not yet visible. RP retries instead of worker tying up |
| SEC-012 | 🟡 P2 | `apps/demo-{jp,sso-next}/src/csrf.ts` | Module-cached CSRF token; non-HttpOnly cookie; no rotation handling. | No | 🟢 CLOSED | H6 | Cache invalidates when cookie diverges; `invalidateCsrfCache()` helper for fetch wrappers; cookie value is the source of truth |
| SEC-013 | 🟡 P2 | `app/(portal)/profile/page.tsx` | Profile handoff page lacks CSRF binding to active home session. | No | ⚪ DEFERRED | H8 — needs JP-side signing infra | Bounded by registered redirect_uris exact-match today; full closure requires HMAC token issued by JP, verified by Impact |
| SEC-014 | 🟡 P2 | `src/lib/pii.ts` | Custody gate sound but data is hard-coded stub; doctrine to re-assert namespace on every handler. | Yes (data) | 🟢 CLOSED | H6 | `isCustodiedSubject(sub)` regex-checks the CAIP-10 namespace; gated at `canReadSensitivePii` AND re-asserted at `sensitivePii` before address parsing |
| SEC-015 | 🟡 P2 | `src/lib/passkey.ts` + `connect-client.ts:228` | Discoverable assertion's rawId not checked client-side against expected credentialIdDigest. | No | 🟢 CLOSED | H6 | `signWithDiscoverablePasskey(digest, expectedDigest?)` optional gate; `signAssertion` defensively compares `credential.rawId` against the expected bytes |
| SEC-016 | 🟡 P2 | `src/lib/sso-cookie.ts` | Parent-domain `ap_sso` cookie is JS-readable; sign-out doesn't always clear. | Yes (TODO) | ⚪ DEFERRED | H7 / vault-MCP wave — needs server-set cookie endpoint | Substantive refactor; bundle with the production-substrate work that reshapes session restore |
| SEC-017 | 🟡 P2 | `server/connect/link-{lookup,request}.ts` | `/connect/link/lookup` returns full pubkey + label for any code; no rate limit. | No | ⚪ DEFERRED | Operational lane | Pair with SEC-009 rate-limit half; needs Durable Object token bucket or Cloudflare WAF |
| SEC-018 | 🟢 P3 | `apps/demo-jp/src/connect-client.ts:443-447` | Silent re-auth pins `iss` to user-typed name; no issuer allowlist at RP. | No | 🟢 CLOSED | H6 | `isAllowedIssuerOrigin(origin)` in `lib/domain.ts`; `verifyIdToken` gates both `authOrigin` AND `claims.iss` |
| SEC-019 | 🟢 P3 | `apps/demo-jp/src/App.tsx:83-114` `restoreSession` | Session restore reads localStorage + decodes JWT without re-verifying signature. | No | 🟢 CLOSED | H6 | New mount-effect re-fetches JWKS + re-verifies signature via `verifyIdToken`; signature failure → drop session + force fresh sign-in |
| SEC-020 | 🟢 P3 / ℹ️ | `apps/demo-jp/src/lib/domain.ts:21-46` | `personalAuthOrigin` doesn't hard-validate label character set; bounded today, regression-prone. | No | 🟢 CLOSED | H6 | `LABEL_RE = /^[a-z0-9][a-z0-9-]{0,62}$/` positive gate; `personalAuthOrigin` throws on mismatch |
| SEC-021 | ℹ️ | `apps/demo-jp/functions/jwks.ts` + `functions/connect/*` | demo-jp Pages Functions broker is dead code (SPA never calls it); attack surface for no benefit. | No | 🟢 CLOSED (extended) | H6 + follow-up | Server-side routes deleted; only `/a2a/[[path]].ts` preserved. **Follow-up (SEC-032 / ARCH-034) extended to delete the parallel ~250 LoC of dead `/connect/*` callers from `apps/demo-jp/src/connect-client.ts` + the unused `lib/passkey.ts`, `lib/wallet.ts`, `lib/central-auth.ts`, `lib/chain.ts`.** |
| SEC-022 | ℹ️ | `apps/demo-jp/src/lib/matches.ts:230-280` | Dual-persona's `fac-self-<addr>` invites cross-record collision; production needs separate SAs. | Yes (demo) | 🟢 CLOSED | H6 | `selfFacilitatorId()` / `selfAdopterId()` helpers with address-format invariant; throw on malformed address |
| SEC-023 | ℹ️ | `apps/demo-sso-next/src/whitelabel/config.ts` + `wea-doc.ts` | Faith vocabulary in apps is correct per ADR-0021 but worth pre-empting in reviewer materials. | No | 📝 DOC | Reviewer materials | ADR-0021 |

### Follow-up re-audit (2026-05-29) — new SEC findings

Run after Wave H6 closures landed. The security-auditor verified 13/15 closed findings as clean, 2 closed-incomplete (extended above), and surfaced 12 new items.

| ID | Severity | Component | One-line | Demo-cut? | Status | Wave / target | Cross-refs |
|---|---|---|---|---|---|---|---|
| SEC-024 | 🔴 P0 | `server/connect/{passkey,with-name,stepup}.ts` + `server/oidc/google/{callback,rotate}.ts` | SEC-006 Host allowlist applied only on the OIDC code path; Connect-auth endpoints still derived `iss` from raw `request.url`. **Closes the SEC-006 gap fully — every signing endpoint now routes through `resolveOrigin`.** | No | 🟢 CLOSED | Follow-up | SEC-006 |
| SEC-025 | 🟠 P1 | `apps/demo-a2a/src/index.ts:74-98` (`getInMemoryNonceStore`) | Bridge HMAC nonce store is in-memory per Worker instance; cross-instance replay possible within 60s window. KV-backed adapter `nonceStoreFromKv` already exists in `bridge-hmac.ts` but is unused. | Partial (in-code TODO) | ⚪ DEFERRED | Wave H7 — needs KV namespace or DO method in demo-a2a | SEC-010, ARCH-029 |
| SEC-026 | 🟡 P2 | `server/oidc/authorize-grant.ts` | No rate-limit; leaks registered relying-app delegate address to any caller with a spoofed Origin header. | No | ⚪ DEFERRED | Operational lane | Bundle with SEC-009 rate-limit half |
| SEC-027 | 🟢 P3 | `src/lib/kv-indexer.ts` `appendLink` | Dedup by `(agent, assurance, ref)` ignores `observedAt`/`blockNumber`; future provenance fields silently dropped. | No | 🔴 OPEN | Operational lane (preventive) | SEC-009 |
| SEC-028 | 🟢 P3 | `apps/demo-{sso-next,sso,jp,org}/src/csrf.ts` | Cookie parser ignores duplicate/domain-scoped cookie variants; `decodeURIComponent` may throw on stray `%`. | No | 🔴 OPEN | Operational lane | SEC-012, SEC-016 |
| SEC-029 | 🟠 P2 | `apps/demo-jp/src/App.tsx` + `apps/demo-org/src/App.tsx` (SEC-019 effect) | Session re-verify can't distinguish "JWKS unreachable (transient)" from "signature failed"; drops valid sessions on network blip. | No | 🔴 OPEN | Operational lane | SEC-019 |
| SEC-030 | 🟢 P3 | `apps/demo-{jp,org}/src/lib/domain.ts` callers | `personalAuthOrigin` throws on invalid label; render-path callers without error boundary would crash UI. | No | 🔴 OPEN | Operational lane | SEC-020 |
| SEC-031 | 🟠 P2 | `apps/demo-sso-next/server/_lib/verify-delegation.ts` | `verifyDelegation` only checks the timestamp caveat — does NOT call `DelegationManager.disabled(digest)`. A revoked delegation continues to mint id_tokens (silent reauth) until `validUntil`. **Undermines ADR-0019 revocation guarantee.** | No | 🔴 OPEN | Wave H7 (highest priority of the new ones) | ADR-0019 |
| SEC-032 | 🟢 P3 | `apps/demo-jp/src/connect-client.ts` | Dead `/connect/*` callers in client code; would 404 if any future caller wires them. | No | 🟢 CLOSED | Follow-up | SEC-021, ARCH-034 |
| SEC-033 | 🟢 P3 | `_lib/origin.ts` + RP `verifyIdToken` | `iss` port-handling fragility in dev/preview deployments (`:443` mismatch). | No | 🔴 OPEN | Operational lane | SEC-006, SEC-018 |
| SEC-034 | 🟠 P2 | `server/oidc/authorize-grant.ts` + `grant.ts` | `agent_name` is client-asserted into the id_token without server-side verification that it forward-resolves to the eventual `delegation.delegator`. RP display-label impersonation. | No | 🔴 OPEN | Wave H7 | spec 222 reverseResolve |
| SEC-035 | ℹ️ | `server/_lib/server-broker.ts` `corsHeaders` | Non-registered origins get opaque CORS errors instead of clean 4xx — debugging/operational only. | No | 📝 DOC | Runbook | — |

### Architectural findings (from `technical-architect-auditor`)

| ID | Severity | Component | One-line | Demo-cut? | Status | Wave / target | Cross-refs |
|---|---|---|---|---|---|---|---|
| ARCH-001 | 🔴 Critical | `apps/demo-jp/src/lib/vault.ts` + `apps/demo-sso-next/src/profile-store.ts` + app session stashes | No persistence substrate; "vault" is browser localStorage. No spec, no ADR, no runbook for the production MCP. | Yes (documented) | 🔴 OPEN | Pre-review (spec 237) | SEC-008, ARCH-008, ARCH-011 |
| ARCH-002 | 🔴 Critical (prod) / 🟠 High (demo) | `app/(portal)/{profile,wea-sign}/page.tsx` + demo-jp `App.tsx` handoff effects | New cross-origin handoff protocol unspecced; PII in URL params; duplicate allowlist. | No (new protocol) | 🔴 OPEN | Pre-review (spec 238) | SEC-004, SEC-005, SEC-013 |
| ARCH-003 | 🟠 High | `mou.ts` `attestDocConsentBound` + `wea-doc.ts` `buildWeaAttestation` | "Attestations" produce hashes, not signatures. Naming implies cryptographic content that isn't there. | Yes | 🔴 OPEN | R/N follow-up | SEC-007, spec 236 P2 |
| ARCH-004 | 🟠 High | `apps/demo-{jp,org}/src/connect-client.ts` | Shared default relying-site delegate SA. | Yes (partial) | 🔴 OPEN | H6 OIDC closure | SEC-003 |
| ARCH-005 | 🟠 High | `docs/audits/{architecture-diagram,threat-model,evidence-checklist}.md` + `docs/architecture/{package-consumer-map,cross-cutting-capabilities}.md` | None of these docs know demo-jp, demo-sso-next, or specs 232/234/235/236 exist. Closes Gate 2+3 of spec 214. | No | 🔴 OPEN | Pre-review (dossier refresh) | spec 214 §2 |
| ARCH-006 | 🟠 High | `packages/key-custody/capability.manifest.json` vs `src/index.ts` | `pnpm check:public-exports` fails — manifest doesn't match exported spec-235 symbols. | No | 🔴 OPEN | Operational lane | spec 100 §4/§8 |
| ARCH-007 | 🟠 High | demo-jp `wea.ts` ↔ demo-sso-next `wea-doc.ts`; chain.ts duplication across all 3 apps | Two canonical-bytes contracts duplicated across origins with documented drift hazard. | No | 🔴 OPEN | R/N follow-up (ADR-0022 + `contracts-deployments`) | spec 100 §3 |
| ARCH-008 | 🟡 Medium | `apps/demo-sso-next/src/profile-store.ts` ↔ `apps/demo-jp/src/lib/vault.ts` | Two parallel `ImpactProfile` type families with no consistency story. | Partial | 🔴 OPEN | Pre-review (spec 237 / projection rename) | ARCH-001 |
| ARCH-009 | 🟡 Medium | `apps/demo-jp/src/lib/matches.ts` `DISCLOSURE_*` + projection types | "Released/withheld/upgrade" disclosure pattern is generic SSI machinery, hand-coded in JP vertical. | No | 🔴 OPEN | R/N follow-up (spec 239) | — |
| ARCH-010 | 🟡 Medium | `apps/demo-sso-next/src/lib/{domain,pii}.ts` + `server/_lib/origin.ts` + multiple `chain.ts` | Comment + literal drift from `demo.agent → impact` rename + SSO/A2A `.me`/`.io` split. | No | 🔴 OPEN | Operational lane (sweep) | — |
| ARCH-011 | 🟡 Medium | both apps top-level | No audit-sink wired anywhere. Spec 206 + spec 214 §4.8 OP-2 unmet. | Partial | 🔴 OPEN | Pre-review (operational substrate) | spec 206 |
| ARCH-012 | 🟡 Medium | `apps/demo-a2a/src/index.ts` (master-key prod guard) | Spec 235 §G-1 dead code in LIVE Worker; demo-sso-next broker callback doesn't assert backend mode. | Yes (testnet) | 🔴 OPEN | H7 Custody hygiene | spec 235, SEC-010 |
| ARCH-013 | 🟡 Medium | broker keys + KMS master + Google × KMS derived + bridge secret | No key-rotation runbook for any of these. | No | 📝 DOC | Pre-review (runbooks) | spec 214 Gate 5, KH-5 |
| ARCH-014 | 🟢 Low | `apps/demo-{jp,org}/src/connect-client.ts` | Copy-pasted from demo-org; header comments + drift cost grow as more relying apps land. | No | 🔴 OPEN | R/N follow-up | spec 100 §7 |
| ARCH-015 | 🟢 Low | `apps/demo-sso-next/src/lib/pii.ts` `sensitivePii` | Returns synthesized stub; PII is hash-of-stub end to end. | Yes | 🔴 OPEN | R/N follow-up | SEC-014, ARCH-001 |
| ARCH-016 | 🟢 Low | `apps/demo-sso-next/server/_lib/origin.ts:2-3` | Comment references `.impact-agent.io` for SSO origin (SSO is `.me`). | No | 🔴 OPEN | Operational lane | ARCH-010 |
| ARCH-017 | 🟢 Low / ℹ️ | `packages/connect/test/unit/connect.test.ts:194` | Test fixture uses a deployment-specific hostname instead of `example.test`. | No | 🔴 OPEN | Operational lane | ADR-0021 |
| ARCH-018 | 🟢 Low | `packages/agent-profile/dist/constants.{js,d.ts}` | Stale dist artifact carrying pre-rename text. | No | 🔴 OPEN | Operational lane (rebuild + dist-drift CI) | — |
| ARCH-019 | ℹ️ | `server/oidc/google/callback.ts` | Spec 235 §5 implementation aligns with the architect-of-record. | No | 🟢 CLOSED | — | spec 235 |
| ARCH-020 | ℹ️ | white-label config + portal nav + stewardship | Spec 234 W2/W3 wired; W4 deferred per spec; `ALLOWED_RELYING_ORIGINS` doesn't read config (see ARCH-002). | Partial | 🔴 OPEN | (subsumed by ARCH-002) | spec 234 |
| ARCH-021 | ℹ️ | demo-jp `lib/*.ts` | Spec 236 §1–§5 modeling is clean; gaps are downstream (P2 signatures = ARCH-003; substrate = ARCH-001). | Partial | 🔴 OPEN | (subsumed) | spec 236 |
| ARCH-022 | ℹ️ | both apps `delegation.ts` | ADR-0019 honored: relying-site key is always a delegate, never a custodian. | No | 🟢 CLOSED | — | ADR-0019 |

### Follow-up re-audit (2026-05-29) — new ARCH findings

The technical-architect-auditor evaluated the new structural shapes from Wave H6 (server-minted grant table, HMAC envelope, append-only facets, RP-side primitives) and looked for new issues. Result: most shapes are sound but four belong as packages, two ship without specs, and the duplication smell got LARGER on demo-jp's connect-client.

| ID | Severity | Component | One-line | Demo-cut? | Status | Wave / target | Cross-refs |
|---|---|---|---|---|---|---|---|
| ARCH-023 | 🟠 High | `specs/230-…` | Spec 230 §4.2/§4.3 out of sync with running OP — the new `authorize-grant` + `grant` + `oidc-deleg` KV binding aren't in the architect-of-record doc. | No | 🔴 OPEN | Pre-review docs lane | spec 100 |
| ARCH-024 | 🟠 High | `whitelabel/config.ts` + 2× `connect-client.ts` + `wrangler.toml` | Relying-site delegate SA duplicated 4 places; SEC-003 future split = 4 edits. | Partial | 🔴 OPEN | Bundle with SEC-003 | SEC-003 |
| ARCH-025 | 🟢 Low | `whitelabel/schema.ts` + `oidc-clients.ts` | No boot-time presence/format check on `RelyingApp.delegate`. | No | 🔴 OPEN | Operational lane | — |
| ARCH-026 | 🟡 Medium | `server/{grant,token}.ts` | `oidc-deleg:` side-store is mechanism that should be an `AllowedClientCaveat` on the delegation itself (or becomes redundant once SEC-003 splits per-app delegates). | No | 🔴 OPEN | Re-eval after SEC-003 | SEC-002, SEC-031 |
| ARCH-027 | 🟠 High | `apps/demo-{sso-next,a2a}/bridge-hmac.ts` | HMAC envelope code duplicated across two apps; drift hazard on the wire format. | No | 🔴 OPEN | Wave H7 (lift to package) | ARCH-028 |
| ARCH-028 | 🟠 High | `bridge-hmac` vs `packages/mcp-runtime/src/service-mac.ts` | Two parallel HMAC envelope primitives — bridge-hmac is a strictly weaker re-implementation of what mcp-runtime already owns. | No | 🔴 OPEN | Wave H7 — unify (lift `serviceMac` to `packages/service-mac` or extend `audience` field) | SEC-010 |
| ARCH-029 | 🟡 Medium | `apps/demo-a2a/src/index.ts:74-98` | In-memory nonce store on Workers despite KV adapter shipped in verifier. | Yes (TODO) | 🔴 OPEN | Wave H7 (one-line fix once KV/DO binding added) | SEC-025 |
| ARCH-030 | 🟠 High | (proposed spec / ADR) | Bridge HMAC wire format unspecced — same shape as ARCH-002 (`/profile` handoff). | No | 🔴 OPEN | Pre-review docs lane | ARCH-002 |
| ARCH-031 | 🟡 Medium | `apps/demo-{sso,sso-next}/src/lib/kv-indexer.ts` | KvIndexer duplicated; belongs in `packages/identity-directory-adapters`. | No | 🔴 OPEN | Operational lane | spec 100 |
| ARCH-032 | 🟡 Medium | `src/lib/kv-indexer.ts` `readOidcFacet` | First-entry reader on append-only writer collides with spec 235 rotation story; needs rotation-namespaced keys OR rotation-aware reader. | No | 🔴 OPEN | R/N follow-up | spec 235 §5b |
| ARCH-033 | 🔴 Critical | `apps/demo-{jp,org}/src/{connect-client.ts,lib/domain.ts,App.tsx}` | OIDC relying-app primitive (~200 LoC) duplicated character-for-character across two apps; **grows with every new relying app**. Needs `@agenticprimitives/connect/relying-app` subpath. | No | 🔴 OPEN | R/N follow-up (highest-priority new ARCH item) | spec 100, ADR-0014, ARCH-014 |
| ARCH-034 | 🟠 High | `apps/demo-jp/src/connect-client.ts` | ~250 LoC of dead `/connect/*` callers after SEC-021 deleted the routes — misleading code. | No | 🟢 CLOSED | Follow-up | Slimmed connect-client.ts + deleted `lib/{passkey,wallet,central-auth,chain}.ts`; commit `<TBD>` |
| ARCH-035 | 🟡 Medium | `apps/demo-sso` vs `apps/demo-sso-next` | Parallel maintenance with no deprecation marker; H6 patches landed twice. | No | 🔴 OPEN | Pre-review (decide deprecate) | — |
| ARCH-036 | 🟢 Low | `RelyingApp.delegate` vs `IncomingDelegation.delegate` vs `DEMO_*_DELEGATE` | Three meanings of `delegate` in close contact; rename `RelyingApp.delegate → delegateSa` or brand. | No | 🔴 OPEN | Operational lane | vocabulary-map |
| ARCH-037 | 🟢 Low | `bridge-hmac.ts` + custody routes | "bridge" + "envelope" new vocabulary not in `vocabulary-map.md`. | No | 🔴 OPEN | Operational lane | ARCH-030 |
| ARCH-038 | 🟠 High | `packages/key-custody` (manifest vs index) | `check:public-exports` STILL fails (was ARCH-006); H6 didn't touch it; `check:all` not green. | No | 🔴 OPEN | Operational lane | ARCH-006 (re-flagged) |
| ARCH-039 | 🟡 Medium | `server/authorize.ts` + `app/authorize/route.ts` | Legacy `POST /authorize` self-login route still reachable and would mint sessions NOT bound to a client_id. | No | 🟢 CLOSED | Follow-up | Deleted route + handler; commit `<TBD>` |
| ARCH-040 | 🟡 Medium | `server/_lib/origin.ts` defaults | `ALLOWED_ISSUER_HOSTS` default disconnected from `whitelabel.domains.connect` — three places assert the same fact. | No | 🔴 OPEN | Operational lane | ADR-0021 |
| ARCH-041 | 🟡 Medium | `apps/demo-jp/src/App.tsx` `openSession` | SEC-014 namespace re-assertion not applied on RP-side `addrFromSub` derivation. | No | 🔴 OPEN | Bundle with ARCH-033 | SEC-014 |
| ARCH-042 | 🟢 Low | per-app `package.json` | No `pnpm test` story in any app; SEC-022 closure landed without a regression test. | No | 🔴 OPEN | Operational lane | spec 100 |

---

## Demo shortcuts catalog (self-reported)

These are the deliberate corner-cuts I shipped during the recent JP build sprint. Every entry is a known not-production-yet behavior — included here so a third-party reviewer doesn't have to reverse-engineer them from code. Cross-referenced to the formal findings above where they overlap.

| # | Shortcut | Location | Visible to a reviewer as | Production replacement | Cross-ref |
|---|---|---|---|---|---|
| D-1 | Demo disclaimer banner | `apps/demo-jp/index.html` (sticky amber strip, painted before React hydrates) | "DEMO — Prototype only — not affiliated with or endorsed by any real organization. 'JP' is a placeholder" | Remove only after the program / partnership is real. | ARCH-021 |
| D-2 | "JP" placeholder | `apps/demo-jp/src/lib/brand.ts`, `apps/demo-sso-next/src/whitelabel/config.ts` (relyingApp `name: "JP Adopt"`), `index.html` `<title>` | All program-org references are "JP" / "JP Adopt"; the literal partner-org name is scrubbed from the live surface. | Re-introduce once a real partnership exists; reviewer materials note this is a placeholder. | ARCH-021 |
| D-3 | Contact-exchange counterparties pre-opted-in | `apps/demo-jp/src/App.tsx` `ContactExchangeWidget` (`setTimeout(700)` then "✓ Scope upgrade" reveal) | "Awaiting their consent…" → instant accept. Email + phone appear from `MatchedFacilitator.exchangeEmail/Phone` (seeded in `matches.ts`). | Real two-sided handshake: both sides EIP-712-sign a `ContactExchangeGrant` over a JP-mediated channel; JP issues an upgraded scoped delegation only after both signatures verify. | SEC-008, ARCH-009 |
| D-4 | Self-persona injection into the match pool | `apps/demo-jp/src/lib/matches.ts` `ownFacilitatorAsMatched` + `ownAdopterAsMatched` (synthesize a `MatchedFacilitator` / `MatchedAdopter` from the viewer's OWN JpFacilitatorRecord / JpAdopterRecord at the same SA address) | "Rich Canvas" appears in `rp-v1`-adopter's facilitator-match list with a "(you)" badge. Without this you'd never see yourself. | Production = real cross-user broker. The self-persona shortcut should be deleted before pilot. | SEC-022, ARCH-021 |
| D-5 | Self-published updates folded into the adopter's seeded-updates view | `apps/demo-jp/src/lib/matches.ts` `updatesForAdopter(facilitatorId, peopleGroupId, viewerAddress?)` (when `facilitatorId === fac-self-<viewerAddress>`, includes the viewer's own JpFacilitatorRecord.publishedUpdates) | Publishing as Rich Canvas → switching to adopter view → the just-published note appears at the top of Rich Canvas's Updates block. Across browsers / addresses: no propagation. | Production = server-mediated fan-out via JP's broker, scoped over the introduction's delegation. | SEC-008 |
| D-6 | Quarterly updates seeded | `apps/demo-jp/src/lib/matches.ts` `SEED_FACILITATOR_UPDATES` (10 hand-written prayer/program notes per seed facilitator × FPG combinations) | Adopter dashboard shows a feed of "Najdi prayer focus — month 4" / "Tibetan plateau — winter brief" / etc. — indistinguishable from real prayer letters. | Replace seeds with real publishedUpdates from real facilitators via the production substrate. Label seeds VISIBLY as `(demo content)` until then. | SEC-008 |
| D-7 | Seeded facilitator pool | `apps/demo-jp/src/lib/matches.ts` `SEED_FACILITATORS` (5 hand-written orgs: Frontier Path Network, East Asia Bridges, Horn Mission Hub, Indian Ocean Catalyst, Global Prayer Network) | Adopter sees these as "Your facilitator" matches with full org details, ministry areas, "how we engage" descriptions, exchangeable email + phone. | Replace with live declared facilitators from the substrate. | SEC-008 |
| D-8 | Seeded adopter pool | `apps/demo-jp/src/lib/matches.ts` `SEED_ADOPTERS` (10 hand-written adopters: Sarah K., First Baptist Springfield, John C., Living Hope Network, Maria L., Aviva R., Mark A., Grace C., Wei L., Coastal M.) | Facilitator dashboard shows these grouped by FPG with declared-N-days-ago dates. | Replace with live adopters from the substrate. | SEC-008 |
| D-9 | FPG seed list | `apps/demo-jp/src/lib/people-groups.ts` `FPG_SEED` (10 hardcoded entries: Bedouin Najdi, Kabyle Berber, Uyghur, Somali, Sindhi, Pashtun, Tibetan, Wolof, Hui, Maldivian) | Adopters and facilitators pick from this fixed list. | Replace with the live JP FPG dataset (PeopleID3 / PGAC — open product question per spec 236 §13). | spec 236 §13 |
| D-10 | MOU canonical bytes hand-authored | `apps/demo-jp/src/lib/mou.ts` `MOU_TEXT` | A 6-paragraph "Memorandum of Understanding" the member checkboxes + "signs". Faithful summary of the program description but not legally reviewed. | Real MOU drafted with legal review; bytes versioned + delivered through the canonical-bytes substrate (ADR-0022 proposal). | ARCH-003, ARCH-007 |
| D-11 | WEA canonical bytes duplicated across two origins | `apps/demo-jp/src/lib/wea.ts` ↔ `apps/demo-sso-next/src/wea-doc.ts` | Both files MUST be byte-identical for the hash verification to succeed; drift breaks the protocol silently. | Single source served from one origin both sides fetch (or, less ideal, a deployment-config package both depend on). | ARCH-007 |
| D-12 | Public stats on home page hardcoded | `apps/demo-jp/src/lib/brand.ts` `JP.stats` (413 / 3,215 adopted, 2,802 still waiting, ~2B people, <0.1% Christ-followers) | Stat band on the marketing page. | Real counter sourced from the program data; live updates as adoptions happen. | — |
| D-13 | No on-chain anchoring | demo-jp end-to-end | Adoption declarations, MOU/WEA "attestations", coverage declarations, contact-exchange consents, published updates: all localStorage only. Nothing in the substrate, nothing on-chain. | At least an on-chain commitment to the canonical record hash per declaration + EIP-712 sigs; declaration history queryable from the substrate. | SEC-007, SEC-008, ARCH-001, ARCH-003 |
| D-14 | Profile + WEA edit UIs at Impact ARE functional | `apps/demo-sso-next/app/(portal)/{profile,wea-sign}/page.tsx` | Members really can fill in profile fields + check the WEA-affirmation box; both save to localStorage at the home origin. | Same UIs, real backend store. | ARCH-001, ARCH-008 |
| D-15 | The `(you)` badge on dual-persona matches | `apps/demo-jp/src/App.tsx` `SelfBadge` (shown on `MatchedFacilitatorCard` / `MatchedAdopterCard` when `isSelf === true`) | A small amber "(you)" pill next to the match's name, signaling "this match is your own persona, surfaced for demo legibility". | Delete the badge + the underlying self-persona injection (D-4) before pilot. | D-4 |
| D-16 | Demo email addresses on exchange reveal | `apps/demo-jp/src/lib/matches.ts` `exchangeEmail` fields (all use `.example` TLD: `daniel.m@frontier-path-network.example`, `mei.c@east-asia-bridges.example`, etc.) | After "Request contact exchange" → email + phone appear; emails are obviously demo (`.example`). | Real emails per declared facilitator/adopter; phone numbers via consent-grade scope. | D-3 |
| D-17 | `DEMO_JP_DELEGATE` defaults to demo-org's delegate SA | `apps/demo-jp/src/connect-client.ts:362-364` | Two relying apps share one delegate; revoking either revokes both. | Per-app delegate SA, configured at deploy time, refuse to start without env. | SEC-003, ARCH-004 |
| D-18 | Pages secrets for demo-jp local broker NOT set | `apps/demo-jp/functions/{_lib/server-broker.ts, jwks.ts, connect/*}` — `BROKER_PRIVATE_JWK`, `BROKER_KID`, `DEMO_A2A_URL` not provisioned | The OIDC SSO path doesn't depend on the JP-local broker (it goes through demo-sso-next); the JP-local broker is dead code today. | If the local broker is intentional: provision secrets + wire. If not (it isn't): delete the functions to shrink attack surface. | SEC-021 |

---

## Suggested wave plan (consolidated)

| Wave | Scope | Closes (primary) | Closes (also) |
|---|---|---|---|
| **Pre-review docs lane** | Spec 237 (vault MCP substrate), spec 238 (relying-app delegated-read protocol), spec 239 (disclosure-projection primitive), ADR-0022 (canonical-bytes-as-deployment-config), dossier refresh (architecture-diagram + threat-model + evidence-checklist with `demo-jp`/`demo-sso-next` + specs 232/234/235/236), key-rotation runbooks. | ARCH-001, ARCH-002, ARCH-005, ARCH-008, ARCH-009, ARCH-011, ARCH-013 | SEC-008, ARCH-007 (half) |
| **Wave H6 — OIDC closure** | Server-minted enrollment-grant table at `/authorize` + `/oidc/grant` (close ADR-0019 F4); bind id_token `aud` to delegation caveats; collapse `ALLOWED_RELYING_ORIGINS` into the white-label registry; `Host` header allowlist at the broker + issuer allowlist at the RP; per-app delegate SA in `whitelabel.relyingApps`; re-verify session JWT on restore. | SEC-001, SEC-002, SEC-003, SEC-005, SEC-006, SEC-018, SEC-019, ARCH-004 | ARCH-020 |
| **Wave H7 — Custody / KMS hygiene** | Replace `Bearer secret` between demo-sso-next ↔ demo-a2a with per-call HMAC envelope; KMS-root rotation runbook (closes KH-5); backend-mode assertion at the broker side of the spec-235 bridge; `ap_sso` cookie → HttpOnly server-set. | SEC-010, SEC-016, ARCH-012 | KH-5 |
| **Wave H8 — Handoff hardening** | Replace `/profile` + `/wea-sign` URL-param return with a delegated server-to-server read; CSRF-bind the handoff to the active session. (Subsumes ARCH-002 IF the new protocol is specced in spec 238 first.) | SEC-004, SEC-013, ARCH-002 | ARCH-008 (consistency leg) |
| **Operational lane** | Rate limits on `/connect/enroll` + `/connect/link/lookup`; `kv.put` → append-only facet log; `isDeployed` polling cap + circuit-breaker; CSRF token rotation + HttpOnly; comment drift sweep (ARCH-010 / ARCH-016); `check:public-exports` for key-custody; rebuild `agent-profile/dist`; delete dead JP Pages broker; test-fixture hostname swap; sentinel "dist drift" CI check. | SEC-009, SEC-011, SEC-012, SEC-015, SEC-017, SEC-020, SEC-021, ARCH-006, ARCH-010, ARCH-014 (partial), ARCH-016, ARCH-017, ARCH-018 | — |
| **R/N follow-up — production-shape substitutions** | Real EIP-712 attestations (spec 236 P2); real backend store for JP records + Impact profile + attestations (spec 237 implementation); real two-sided contact-exchange handshake; replace seeded matches/updates/adopters with substrate-backed data (or label `(demo content)` until then); separate dual-persona SAs; relying-app-template package or `@agenticprimitives/connect/client` subpath; audit-sink wired in both apps. | SEC-007, SEC-008, SEC-014, ARCH-001 (impl), ARCH-003, ARCH-007 (impl), ARCH-008 (impl), ARCH-009 (impl), ARCH-011 (impl), ARCH-014 (impl), ARCH-015 | D-3, D-4, D-5, D-6, D-7, D-8, D-13 |
| **Reviewer materials** | Pre-empt ARCH-021 in dossier: "apps are intentionally the white-label layer per ADR-0021"; freeze the in-flight spec 235 G-1 finding so a reviewer doesn't re-derive it. | SEC-023, ARCH-019, ARCH-022 | — |

**Hard gate before external review window opens:** Pre-review docs lane + Wave H6 + Wave H8. Without those landed, the first reviewer question ("can a held delegation mint an id_token for the wrong client_id?") closes the engagement with a P0 in the first hour.

---

## External senior review — 2026-05-29

A third-party senior architectural & security reviewer evaluated the repo end-to-end
on the `master` branch (post Wave H6 + follow-up). The full review is preserved
verbatim below; the structured EXT-* tracker that follows it captures the new findings
and cross-references existing rows.

### Reviewer TL;DR

> This is a disciplined, specs-driven monorepo with genuinely thoughtful Web3/agentic
> primitives and impressive CI guardrails for its size (1-star repo, heavy Claude/AI-assisted
> dev). The package boundary doctrine and check scripts are senior-level hygiene most
> startups lack.
>
> However — it is not production-viable in its current state, and I would reject it in a
> vendor/arch review for any customer-facing or high-value agentic deployment. Multiple
> P0/P1 self-admitted risks (leaked governance keys, historical fail-open policy eval,
> incomplete audit trails), amateur security hygiene in the demos, over-fragmented
> packaging, and missing production-grade hardening make it a high-risk prototype at best.
> Use it only for internal PoCs on isolated testnets, with heavy forking/hardening. Expect
> 4–8 weeks of remediation before even internal beta.

### Reviewer — Overall Repo & Monorepo Architecture (Strong Foundation, Brittle Execution)

> - pnpm workspaces (`packages/*, apps/*, tests/*`) + `packageManager: pnpm@9.15.0` + Node >=20:
>   Correct modern choice. No hoisting nightmares visible.
> - Root package.json scripts are excellent on paper: `check:all` (supply-chain audit,
>   forbidden terms, no app private keys, dependency graph, public exports, Claude context
>   budget, etc.), parallel `test:*`, targeted typechecks per package, clean, contract
>   forge tests, etc. This level of sentinel enforcement is rare and senior-engineer approved.
> - Reality check: 370 commits, pre-alpha, UNLICENSED everywhere, extracted from a prior
>   smart-agent repo. The `specs/` + `docs/architecture/` + per-package spec.md +
>   `capability.manifest.json` + `AUDIT.md` pattern shows heavy process, but the code hasn't
>   caught up.
>
> **Critical Architectural Flaws:**
> - Package proliferation gone wild: README claims "eight + types"; tree shows 16 under
>   `packages/` (connect-auth, key-custody, tool-policy, delegation, agent-account,
>   account-custody, audit, types, plus agent-naming/profile/relationships, connect,
>   identity-directory + adapters, ontology, mcp-runtime, etc.). Many are thin wrappers
>   (e.g., tool-policy is basically @noble/hashes + types). This creates version
>   synchronization hell, import bloat, and "where does this live?" cognitive load.
> - Transpilation lists in Next apps for 10+ workspace packages: indicates ESM/CommonJS
>   mismatches and will explode bundle sizes or cause hydration issues in prod.
> - Demos mixed into `apps/*` alongside real primitives — pollutes the workspace and makes
>   "production extraction" painful.

### Reviewer — Packages Review (Core Strength, But Uneven & Immature)

> Overall pattern: delightfully lean (noble-curves/hashes + viem peers + internal workspace
> only in most). No bloated next-auth/privy/wagmi monoliths — this is a green flag for
> security surface area.
>
> **Highlights (Positive):**
> - `connect-auth`: Subpath exports (/passkey, /siwe, /google), JWT + pluggable signers,
>   WebAuthn one-shot, CSRF origin exact-match claims in README, dedicated security.md.
>   Minimal deps. Good.
> - `key-custody`: Envelope encryption, pluggable local/AWS/GCP + viem-KMS adapter + MAC.
>   Pure crypto — exactly what agentic apps need. Peer-wires audit & auth. Solid design.
> - `tool-policy`, `audit`, etc.: Protocol-agnostic DSL/risk tiers + PII guardrails + sinks.
>   Self-documenting via manifests.
> - Shared types + EIP-712/ERC-4337/ERC-1271 throughout: Consistent threat model.
>
> **Harsh Criticisms:**
> - No real external deps is double-edged — you're reinventing wheels that have battle-tested
>   audits (e.g., full Privy/Lit/Safe SDKs have undergone multiple third-party reviews).
>   Your noble + viem is fine, but missing formal audit = liability.
> - PeerDep version pinning loose (viem ^2.21 in pkgs vs 2.50 in demos) → silent breakage
>   risk on upgrade.
> - Every package has its own AUDIT.md/spec but the central product-readiness-audit.md lists
>   ongoing P0s. This screams "we document risks better than we fix them."
> - Many packages still have `--passWithNoTests` integration stubs — not confidence-inspiring.

### Reviewer — Demo Apps Audit (where it falls apart)

> **demo-sso-next (Next 14.2 + React 18 + Upstash Redis + heavy primitives):**
> - Good: Uses most primitives correctly for SSO → smart account → delegation flow.
> - Disastrous: `next.config.mjs` has reactStrictMode + rewrites to external Cloudflare
>   worker (`DEMO_A2A_URL` fallback hardcoded-ish), ZERO security headers, no CSP, no
>   `headers()` function, no image domains, no `output: 'standalone'` optimization. This
>   is 2023-era Next.js negligence in 2026. Open to clickjacking, XSS, MIME sniffing.
> - `.env.example` ships `BROKER_PRIVATE_JWK` (full ES256 private key JSON with "d" value
>   placeholder) + KV token + RPC. Teaching terrible secret hygiene. Production would be
>   instant compromise vector.
> - Upstash for sessions with no visible rate-limiting or token rotation.
>
> **demo-jp (Vite + React + wrangler.toml + functions/):**
> - Description reveals it's a "relying-app prototype for FPG adoption brokerage" connecting
>   to demo-sso — cute domain-specific pilot, not a generic demo.
> - Architecture: Vite frontend + Cloudflare functions + primitives. Lighter than Next demo.
> - Still: No visible CSP, input validation layers, or prod build hardening (standard Vite
>   issues + wrangler secrets exposure risk). "JP" placeholder with real-sounding MOU/WEA
>   delegation — smells like demo shortcuts that leak into real code.
>
> Both demos hard-depend on `workspace:*` — fine for monorepo, terrible for external
> consumers (the stated value prop).

### Reviewer — Security Deep Dive

> Self-audit (`product-readiness-audit.md`) is brutally honest and the best part of the
> repo. Active/Recent P0/P1 Risks (as of late May 2026):
> - Leaked deployer EOA with full governance, bundler, paymaster, sessionIssuer control on
>   live demo contracts (N1). "Accepted for internal demo" — unacceptable excuse.
> - `tool-policy` historically failed open (empty objects, unknown tags allowed) — "closed"
>   days ago but pattern of fail-open in auth/policy is toxic for agents.
> - Incomplete audit trail (missing key-custody & identity events).
> - Weak preflight deploy checks that let dev keys/KMS skips through.
> - Past CORS reflection, untrusted BigInt parsing DoS vectors, session storage on failed
>   ERC-1271 — all "fixed" recently. Indicates systemic input validation and boundary
>   enforcement gaps that were only caught late.
>
> Additional Senior Observations:
> - Private JWK in env + no mention of secret scanning in CI beyond "check" script.
> - No rate limiting, bot protection, or WAF patterns visible in demos.
> - Web3 classics unaddressed: RPC poisoning (single `RPC_URL`), no bundler reputation,
>   deterministic salts good but envelope key derivation un-audited here.
> - Upstash/Redis sessions in SSO demo without rotation/expiry hardening.
> - License UNLICENSED + pre-alpha + live demo with governance keys = massive
>   supply-chain/legal risk if anyone copies.

### Reviewer — Recommendations

> 1. **Immediate:** Rotate all demo keys, add full Next security headers + CSP
>    (strict-dynamic + nonce), remove private keys from any `.env.example`, enforce
>    `ALLOWED_ORIGINS` everywhere.
> 2. **Short-term (2 weeks):** Third-party audit (at minimum Halborn/Certik light review on
>    key-custody + policy + contracts). Fix all remaining P0s with proof.
> 3. **Arch Refactor:** Collapse thin packages; extract demos to separate consumer examples
>    repo; add proper Nx/Turbo task caching + changesets for versioning.
> 4. **Prod Path:** Implement zero-trust preflight (GCP KMS mandatory, audit sink required,
>    policy strict-fail), full e2e with Playwright + secret scanning (Trivy/Gitleaks),
>    SBOM generation.
>
> **My Vote: Prototype-grade 7/10 on vision & discipline; 3/10 on executable security/arch
> for real use. Fork it, strip the demos, and treat the core primitives as inspiration —
> do not `npm install` blindly.**

---

### EXT-* findings — tracker rows

Items from the external review, mapped to existing rows where they overlap and given a
fresh ID where they don't. Closed items are marked inline.

| ID | Severity | Component | One-line | Demo-cut? | Status | Wave / target | Cross-refs |
|---|---|---|---|---|---|---|---|
| EXT-001 | 🟠 P1 | `apps/demo-sso-next/next.config.mjs` + `apps/demo-{jp,org,sso}/public/_headers` | Next.js + all three Pages apps had no `X-Content-Type-Options`, `Permissions-Policy`, `HSTS`, `X-DNS-Prefetch-Control`, `Cross-Origin-Opener-Policy`. Strict CSP with nonces still pending. | No | 🟢 CLOSED (baseline) | Pre-review (this commit) | Strict CSP follow-up still open |
| EXT-002 | 🟠 P1 | `apps/demo-sso-next/.env.example` + `apps/demo-sso/.dev.vars.example` | `BROKER_PRIVATE_JWK` template shipped the JWK shape with `"d":"REPLACE"` placeholders — a known footgun (paste-over leaks). | No | 🟢 CLOSED | Pre-review (this commit) | JWK shape removed; both files now point at the generator script with explicit "never commit" copy |
| EXT-003 | 🟡 Medium | `packages/*` (16 packages, several thin) | Package proliferation; some are essentially `@noble/hashes + types` wrappers — version-sync hell + import bloat. | No | 🔴 OPEN | Arch Refactor wave | spec 100 §3 |
| EXT-004 | 🟡 Medium | `apps/demo-sso-next/next.config.mjs:transpilePackages[]` | 10+ workspace packages in the transpile list — signals ESM/CommonJS mismatches + bundle bloat. | No | 🔴 OPEN | Arch Refactor wave (shrinks naturally with EXT-003) | EXT-003 |
| EXT-005 | 🟢 Low | `packages/*/package.json` vs `apps/*/package.json` | peer-dep version pinning loose (`viem ^2.21` in packages vs `2.50` in demos) — silent upgrade-breakage risk. | No | 🔴 OPEN | Operational lane | — |
| EXT-006 | 🟢 Low | per-package `package.json` test scripts | Many packages run `--passWithNoTests` integration stubs — not confidence-inspiring. | No | 🔴 OPEN | Operational lane | ARCH-042 |
| EXT-007 | 🟡 Medium | `.github/workflows/*` (or absence thereof) | No CI secret scanning (Trivy/Gitleaks); no SBOM generation. The repo's own `check:no-app-private-keys` catches one class but not credentials in dependencies / history. | No | 🔴 OPEN | Operational lane | — |
| EXT-008 | 🟡 Medium | all demo Connect-auth endpoints + handoffs | No rate limiting / bot protection / WAF in demos beyond the in-app gates. Broader than SEC-009/-017/-026 which are per-endpoint. | No | 🔴 OPEN | Operational lane | SEC-009, SEC-017, SEC-026 |
| EXT-009 | 🟢 Low | `apps/demo-sso-next/next.config.mjs:2` | Hardcoded `DEMO_A2A_URL` fallback at module init hits a worker owned by an individual contributor. | No | 🟢 CLOSED (documented) | Pre-review (this commit) | Comment added documenting "production deployments MUST set the env explicitly; fallback is solo-dev only" |
| EXT-010 | 🟡 Medium | Upstash / Vercel KV session adapter | Sessions on Upstash with no visible token rotation / TTL hardening / per-IP rate-limit. | No | 🔴 OPEN | Wave H7 | SEC-016 |
| EXT-011 | 🟠 P1 | repo root | No LICENSE file; package.json doesn't declare a license → effectively UNLICENSED. Supply-chain / legal exposure if anyone copies. | No | 🟢 CLOSED | Pre-review (this commit) | MIT LICENSE added at repo root |
| EXT-012 | 🟡 Medium | `apps/*` mix | Demos mixed with primitives in `apps/*`; pollutes workspace + makes "production extraction" painful. | No | 🔴 OPEN | Arch Refactor wave (extract demos to consumer-examples repo OR a `demos/` directory) | — |
| EXT-013 | 🟡 Medium | `packages/{key-custody,delegation,connect-auth,connect,agent-account}` | No formal third-party audit on the security-critical packages. Halborn/Certik/Spearbit light review before customer-grade use. | No | 🔴 OPEN | Pre-launch gate | spec 214 |
| EXT-014 | 🟡 Medium | `RPC_URL` single-endpoint pattern | RPC poisoning risk (single RPC); no bundler reputation strategy; envelope key derivation has no third-party audit. | No | 🔴 OPEN | Operational lane | — |
| EXT-015 | 🟢 Low | `apps/demo-sso-next/next.config.mjs` | No `images.remotePatterns` config; default is restrictive but explicit is better. | No | 🔴 OPEN | Operational lane | — |
| EXT-016 | 🟢 Low | `apps/demo-sso-next/next.config.mjs` | No `output: 'standalone'` — bundle is bigger than needed for serverless. | No | 🔴 OPEN | Operational lane | — |
| EXT-017 | 🟢 Low | `apps/demo-sso-next/.env.example` `REDIRECT_URI_ALLOWLIST` | The example pointed at the concrete `demo-org.pages.dev` URL; after SEC-005 the env is no longer the source of truth (whitelabel registry is). | No | 🟢 CLOSED | Pre-review (this commit) | Example replaced with a "preferred source: whitelabel.relyingApps" pointer + new ALLOWED_ISSUER_HOSTS + A2A_CUSTODY_BRIDGE_SECRET entries |
| EXT-018 | 🟡 Medium | (reviewer overall framing) | Reviewer flagged Web3 classics (single RPC, no bundler reputation, un-audited envelope KDF) as a cluster — track as a "Web3 substrate hardening" wave so the items don't get lost individually. | No | 🔴 OPEN | Wave W2 (proposed) | EXT-014 + spec 235 §G-1 + ARCH-013 |

### Wave plan — external review's "Immediate" lane delta

The reviewer's "Immediate" recommendations slot into the existing waves with the following
adjustments (closed items marked):

- ✅ **EXT-001** — Next + Pages security headers baseline (this commit).
- ✅ **EXT-002** — strip JWK shape from `.env.example` / `.dev.vars.example` (this commit).
- ✅ **EXT-011** — add MIT LICENSE at repo root (this commit).
- ✅ **EXT-017** — sanitize stale `REDIRECT_URI_ALLOWLIST` example (this commit).
- ✅ **EXT-009** — document the `DEMO_A2A_URL` fallback as solo-dev-only (this commit).
- ⏳ **Strict CSP with `strict-dynamic` + nonce** — requires careful audit of inline event
  handlers in the OIDC SPA before tightening. Track as **EXT-001 follow-up** in Wave H7.
- ⏳ **Rotate all demo keys** — operational task. Once the bridge HMAC + per-app delegate
  splits land, rotate everything as part of the same operational change.
- ⏳ **Enforce `ALLOWED_ORIGINS` everywhere** — partially closed by SEC-005 + SEC-006 +
  SEC-024 (host + relying-app allowlists). Remaining: the `_lib/origin.ts` default no
  longer drift-prone source (see ARCH-040).

The reviewer's **Short-term (2 weeks)** lane (third-party audit + remaining P0s) maps
to spec 214 closure + the in-flight SEC-001..-003 cluster.

The reviewer's **Arch Refactor** lane is captured by EXT-003 + EXT-004 + EXT-012 +
ARCH-014 + ARCH-027 + ARCH-028 + ARCH-031 + ARCH-033 — collectively a "consolidate
duplicated primitives into packages and extract demos" wave. The natural sequencing is to
land ARCH-033 (the relying-app primitive) FIRST since it has the highest leverage; the
other consolidations follow with less risk.

The reviewer's **Prod Path** lane is the production-substrate work (ARCH-001 spec 237 +
ARCH-011 audit sinks + ARCH-013 key rotation + Playwright + Trivy/Gitleaks + SBOM). Track
as Wave R1 in the dossier roadmap.

---

## Re-audit policy

- Each wave produces a hardening commit log; reference the SHA(s) in this file's row Status column when moving to 🟢 CLOSED.
- After each wave: re-run `security-auditor` + `technical-architect-auditor` with `select:<closed-finding-ids>` to re-verify no regression. Spec 214 already has `evidence-checklist.md` as the durable verification ledger — when a finding closes, add or update its row in that file too.
- Treat ⚪ ACCEPTED-RISK entries as second-class: each must link to a written decision (ADR or commit message with `Accepted-Risk: SEC-XXX` trailer) + a re-evaluation date.
- A third-party reviewer's findings get IDs `EXT-001..` and merge into the same status tracker.

---

## Files referenced (load-bearing)

**Relying app (`demo-jp`):**
- `apps/demo-jp/src/App.tsx` (2,689 lines — load-bearing)
- `apps/demo-jp/src/connect-client.ts`
- `apps/demo-jp/src/csrf.ts`
- `apps/demo-jp/src/lib/{mou,wea,vault,matches,domain,chain,delegation,passkey,wallet,brand,people-groups,capacity}.ts`
- `apps/demo-jp/functions/_lib/server-broker.ts`
- `apps/demo-jp/functions/{jwks,a2a/[[path]]}.ts`
- `apps/demo-jp/functions/connect/{nonce,passkey-challenge,passkey,siwe,with-name,name,name-info}.ts`
- `apps/demo-jp/wrangler.toml`

**IdP (`demo-sso-next`):**
- `apps/demo-sso-next/app/(portal)/{profile,wea-sign,you}/page.tsx`
- `apps/demo-sso-next/server/oidc/{grant,token,authorize}.ts`
- `apps/demo-sso-next/server/jwks.ts`
- `apps/demo-sso-next/server/_lib/{server-broker,origin,verify-delegation}.ts`
- `apps/demo-sso-next/server/connect/{nonce,passkey-challenge,passkey,siwe,with-name,enroll,stepup,link-lookup,link-request,link-status,name,name-info}.ts`
- `apps/demo-sso-next/server/oidc/google/{start,callback,rotate}.ts`
- `apps/demo-sso-next/server/me/handler.ts`
- `apps/demo-sso-next/server/.well-known/openid-configuration.ts`
- `apps/demo-sso-next/src/{wea-doc,profile-store,connect-client,server-client,broker,csrf}.ts`
- `apps/demo-sso-next/src/lib/{broker-core,delegation,kv-indexer,oidc-clients,passkey,pii,sso-cookie,domain,chain,connected-apps}.ts`
- `apps/demo-sso-next/src/whitelabel/{config,schema}.ts`
- `apps/demo-sso-next/src/components/onboarding/useEnrollReq.ts`
- `apps/demo-sso-next/{vercel.json,next.config.mjs,DEPLOY.md}`

**Consumed packages (security cores):**
- `packages/connect/src/{token,broker,redirect}.ts`
- `packages/connect-auth/src/methods/google.ts`
- `packages/delegation/src/hash.ts`
- `packages/key-custody/{capability.manifest.json, src/index.ts}` (ARCH-006)
- `packages/agent-profile/dist/{constants.js, constants.d.ts}` (ARCH-018)
- `packages/connect/test/unit/connect.test.ts:194` (ARCH-017)

**Baseline / doctrine docs:**
- `CLAUDE.md` (project hard rules)
- `docs/architecture/decisions/{0010,0011,0013,0017,0019,0021}*.md`
- `specs/{100,206,214,229,230,234,235,236}-*.md`
- `docs/audits/{threat-model,evidence-checklist,architecture-diagram}.md` (flagged stale — ARCH-005)
