# Spec 230 — Agentic Connect as a person-scoped OpenID Provider (OIDC)

Status: IMPLEMENTED + deployed live 2026-05-27 (P1–P4, §9) · supersedes the custom
relying-site enrollment transport in spec 229 §5 (the protocol/authority model is
unchanged; only the transport becomes standard OIDC).

## 1. Purpose

Make the **login / assertion layer** of a person's central auth a compliant OIDC
**OpenID Provider (OP)**, so relying apps integrate with boring, well-understood
plumbing (discovery, authorization-code + PKCE, JWKS, `id_token`) instead of a
bespoke popup protocol. The person's central auth (`<handle>.impact-agent.io`, spec
229 §4) **is the OP / issuer**; the ROOT passkey is its credential.

**Hard split — identity vs authority:**

| Question | Mechanism |
| --- | --- |
| *Who is this?* (sign-in) | **OIDC** — `id_token` (this spec) |
| *What may this app do?* | **Delegation** — caveated ERC-7710 grant ([ADR-0019](../docs/architecture/decisions/0019-relying-site-authority-is-a-scoped-delegation.md)) |

OIDC scopes describe **request intent / UX**, never on-chain authority. On-chain
action authority comes ONLY from the signed delegation + caveats. A relying site
that holds an `id_token` knows *who* signed in; it can do *nothing on-chain* without
a delegation. The two are issued together (§5) but are independent grants.

> **Be boring-standard for sign-in. Be agent-native for authority.**

## 2. Reference: smart-agent patterns to port (REQUIRED)

- **OIDC *client* patterns** — `/home/barb/smart-agent/apps/web/src/lib/auth/google-oauth.ts`
  + `google-callback/route.ts`: PKCE, `state`, `nonce`, JWKS verification, alg pinning,
  exact-match callback. We already port these on the *consumer* side (demo-sso's
  `functions/oidc/google/*`). The provider side reuses the same disciplines, inverted.
- **OID4VCI** — `apps/org-mcp/src/api/oid4vci.ts` (OpenID for Verifiable Credential
  Issuance): the closest analog to "agent-native claims over an OpenID surface." We
  borrow its framing (issuer-as-origin, credential-as-claims) for the `agent_name` /
  `canonical_agent_id` extension claims, but DO NOT adopt VC issuance here.

### 2.1 Deliberate divergence / NEW pattern

smart-agent has **no person-scoped OpenID *Provider*** (it is an OIDC *client* to
Google + an OID4VCI issuer). A per-person OP whose `sub` is a **CAIP-10 canonical
agent id** (not an email) and whose token ships a sidecar **ERC-7710 delegation** is
new here. Justification: spec 229's SSI-wallet model + ADR-0019's authority split.

## 3. Relationship to existing specs

- **Builds on** [spec 224](224-agentic-connect.md) / [ADR-0014](../docs/architecture/decisions/0014-connect-is-an-sso-broker.md):
  the `@agenticprimitives/connect` broker (`mintAgentSession`, `issueForResolution`,
  `newAuthCode`, `validateRedirectUri`) is the OP engine. This spec makes its HTTP
  surface OIDC-compliant and adds discovery + PKCE + the client registry.
- **Issuer discovery** is spec 229 §4: `name → authOrigin facet → the OP origin`.
  The `iss` claim MUST equal that exact origin.
- **Authority** is [ADR-0019](../docs/architecture/decisions/0019-relying-site-authority-is-a-scoped-delegation.md):
  unchanged. The delegation returned at `/token` is the same caveated grant the ROOT
  passkey signs today; only its delivery moves into the token response.
- **Subject** is [ADR-0010](../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md)
  / [ADR-0016](../docs/architecture/decisions/0016-no-owner-agentsession.md): `sub` is
  the CAIP-10 canonical agent id, no owner, never an email.

## 4. Endpoints

### 4.1 Discovery — `GET /.well-known/openid-configuration`

Served per-origin; `issuer` MUST equal the serving origin (the person's OP).

```json
{
  "issuer": "https://r-pedersen.impact-agent.io",
  "authorization_endpoint": "https://r-pedersen.impact-agent.io/authorize",
  "token_endpoint": "https://r-pedersen.impact-agent.io/token",
  "jwks_uri": "https://r-pedersen.impact-agent.io/jwks",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["ES256"],
  "code_challenge_methods_supported": ["S256"],
  "scopes_supported": ["openid", "profile", "agent"],
  "claims_supported": ["sub", "aud", "iss", "exp", "iat", "nonce", "agent_name", "canonical_agent_id"]
}
```

No implicit flow; no `token`/`id_token` response types; `S256` PKCE only.

### 4.2 Authorization — `GET /authorize`

Standard authorization-code request (browser redirect, in a popup or full page):

```
client_id, redirect_uri, response_type=code, scope=openid agent,
state, nonce, code_challenge, code_challenge_method=S256
```

Agent-native **extension params** (drive the parallel delegation issuance, §5):

```
agent_name=rpedersen.agent       # the person to sign in as (resolves → CAIP-10 sub)
delegate=0x…                     # the relying site's delegate SA (delegation recipient)
delegation_template=org-create   # which caveat template the client requests (registry-gated)
```

The OP runs the credential ceremony (ROOT passkey), resolves `agent_name → agent`,
mints (a) the `id_token` and (b) the caveated delegation `agent → delegate`, stashes
both under a **single-use, short-TTL code**, and redirects back to `redirect_uri`
with `?code=…&state=…`. The code, not the tokens, travels in the URL.

### 4.3 Token — `POST /token`

`grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`,
`code_verifier`. Returns:

```json
{
  "id_token": "<ES256 JWS>",
  "token_type": "Bearer",
  "expires_in": 600,
  "delegation": { "delegator": "0x…", "delegate": "0x…", "authority": "0x…", "caveats": [ … ], "salt": "…", "signature": "0x…" }
}
```

`delegation` is the **agent-native extension** (DelegationWire). Standard OIDC
clients ignore it; agent-native clients store + redeem it (ADR-0019). It is NEVER a
URL param/fragment.

### 4.4 JWKS — `GET /jwks`

Unchanged (ES256 public keys; `kid` stable). Relying apps verify the `id_token`
against `iss`'s `jwks_uri`.

## 5. The `id_token`

```json
{
  "iss": "https://r-pedersen.impact-agent.io",
  "sub": "eip155:84532:0xPersonAgent",
  "aud": "demo-org",
  "exp": 1700000600,
  "iat": 1700000000,
  "nonce": "<echoed from /authorize>",
  "agent_name": "rpedersen.agent",
  "canonical_agent_id": "eip155:84532:0xPersonAgent"
}
```

- `sub` = `canonical_agent_id` = CAIP-10 canonical agent id (ADR-0010/0016). NEVER email.
- `aud` = the relying site's `client_id`.
- `nonce` echoed verbatim (replay binding).
- `agent_name` / `canonical_agent_id` are additive extension claims (decision
  2026-05-27: standard + agent-extension claims, no separate `/userinfo` round-trip).

## 6. Client registry

Static config first (KV/D1 later). Per `client_id`:

```json
{
  "client_id": "demo-org",
  "redirect_uris": ["https://agenticprimitives-demo-org.pages.dev/"],
  "allowed_scopes": ["openid", "agent"],
  "allowed_delegation_templates": ["org-create"]
}
```

`redirect_uri` MUST exact-match an entry. `delegation_template` MUST be in
`allowed_delegation_templates`; the template fixes the caveat set (targets/methods/
value/time) — the client cannot widen it.

## 7. Convergence (decision 2026-05-27: ONE flow)

The custom popup enrollment of spec 229 §5 (`?delegate=…` → `AC_SUCCESS{delegation}`
postMessage / base64 redirect param) is **replaced** by the OIDC code+PKCE flow:

- demo-org enrollment AND org-creation both go through `GET /authorize` → `?code` →
  `POST /token`. The transport (popup with redirect fallback) is retained; the
  **message shape** becomes standard OIDC. The org-creation extension params carry
  `delegation_template=org-create` + `org_base`; the OP runs `createChildAgentForSite`
  and returns the org payload in the token response (extension), the org→site
  delegation included.
- Delete: the bespoke `AC_SUCCESS`/`AC_*` postMessage contract and the base64
  `delegation`/`org` redirect params. (Deletes > deprecations.)

## 8. Security controls (compliance checklist → explicit gates/tests)

1. Exact-match `redirect_uri` allowlist per `client_id` (CN-1).
2. `state` required + echoed; relying site verifies.
3. `nonce` required + echoed into `id_token`.
4. **PKCE S256 mandatory** (public clients). Reject missing/`plain` challenge.
5. Authorization codes: single-use, short TTL, bound to `client_id` + `code_challenge`.
6. `iss` exact-match = serving origin; relying site pins it.
7. `aud`/`client_id` validated both directions.
8. No implicit flow; no tokens in URL fragments.
9. ES256 only; alg pinned on verify; `kid` present; JWKS rotation documented.
10. CORS: not broad; `/token` is server-to-server (no CORS needed); discovery + JWKS are public GET.
11. (ADR-0013) issuer discovery is one mechanism (spec 229 §4) — no fallback chain.

## 9. Phase plan (each independently demoable)

**Status: P1–P4 DONE + deployed live 2026-05-27** (demo-sso `master`, demo-org `main`).
The authorization endpoint is the SPA at the origin root (the consent + ROOT-passkey
ceremony renders there), so `authorization_endpoint` = `${iss}/` (§4.1). Verified live:
discovery routes (the `functions/.well-known/` dotfile path works on Pages), `/token` +
`/jwks` CORS preflight reflect the registered client origin, `id_token` verifies against JWKS.

- **P1 — OIDC core surface. DONE** (`7c4daf4` connect `mintIdToken`/`verifyIdToken`/
  `verifyPkceS256`; `ecc20f6` discovery doc; `ea7ea65` `/oidc/grant` + `/token` shape incl.
  the `delegation` sidecar). `id_token` claims per §5; engine in `@agenticprimitives/connect`.
- **P2 — Client registry. DONE** (`ecc20f6` `src/lib/oidc-clients.ts`): `client_id` →
  exact redirect_uris / scopes / delegation_templates; gated server-side at grant + the CORS allowlist.
- **P3 — Converge demo-org. DONE** (`ea7ea65`): one code+PKCE flow for sign-in + org-create;
  `id_token` IS the session; delegation/org ride `/token`. DELETED the `AC_*` contract,
  `connectWithDelegation`, and `functions/connect/with-delegation.ts`.
- **P4 — Security gates. DONE** (`7c4daf4` connect tests): PKCE match/mismatch + `id_token`
  alg-pin / iss / aud / nonce / exp rejections (6 tests). The endpoint gates (exact redirect
  allowlist, single-use code, client/template, PKCE binding) are enforced in `/oidc/grant` + `/token`.

## 10. Open questions

1. **`/userinfo`?** Not for P1 (claims are in the `id_token`). Add later only if a
   standard client needs it.
2. **Refresh tokens?** No — sessions are short-lived; re-auth via the OP. (The
   delegation, separately, is long-lived + revocable per ADR-0019.)
3. **Dynamic client registration?** Out of scope; static registry only.
4. **Per-person vs shared signing key** across wildcard origins — for the demo a shared
   ES256 key with exact `iss` + stable `kid` is acceptable; production should consider
   per-origin keys (tracked with spec 229 P5 / the domain flip).

## 11. Out of scope

- OID4VCI / verifiable-credential issuance (borrow framing only, §2).
- Per-person origins are LIVE on `*.impact-agent.io` (spec 229 P5 / spec 231); each
  `<handle>.impact-agent.io` is its own OP issuer by Host (the `iss` derives from the
  serving origin — already host-relative, no code change).
- Any change to the authority model (ADR-0019) — delegation semantics are unchanged.
- Google/SIWE relying-site paths on demo-org (passkey-name first; spec 229 §13).
