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
| SEC-006 | 🟠 P1 | `server/_lib/origin.ts` | `iss` derived from attacker-controlled `Host` header; no issuer allowlist at broker or RP. | No | 🟢 CLOSED | H6 | `ALLOWED_ISSUER_HOSTS` env at broker; default `impact-agent.me + *.impact-agent.me`; foreign Host → `IssuerHostNotAllowedError` |
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
| SEC-021 | ℹ️ | `apps/demo-jp/functions/jwks.ts` + `functions/connect/*` | demo-jp Pages Functions broker is dead code (SPA never calls it); attack surface for no benefit. | No | 🟢 CLOSED | H6 | All dead routes deleted; only the `/a2a/[[path]].ts` proxy is preserved |
| SEC-022 | ℹ️ | `apps/demo-jp/src/lib/matches.ts:230-280` | Dual-persona's `fac-self-<addr>` invites cross-record collision; production needs separate SAs. | Yes (demo) | 🟢 CLOSED | H6 | `selfFacilitatorId()` / `selfAdopterId()` helpers with address-format invariant; throw on malformed address |
| SEC-023 | ℹ️ | `apps/demo-sso-next/src/whitelabel/config.ts` + `wea-doc.ts` | Faith vocabulary in apps is correct per ADR-0021 but worth pre-empting in reviewer materials. | No | 📝 DOC | Reviewer materials | ADR-0021 |

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
