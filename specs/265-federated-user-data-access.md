# Spec 265 — Federated user-data access via VaultGrant (YouVersion highlights)

> **Scope correction (2026-06-06, SDK-confirmed).** YouVersion's Platform API exposes exactly **one**
> personal-data resource: **highlights**, read **per Bible chapter** (`GET /v1/highlights?bible_id=&passage_id=<chapter USFM, e.g. JHN.3>`;
> confirmed against the official Swift `Highlights.swift`/`URLBuilder.swift` + Kotlin `HighlightsEndpoints.kt`).
> There is **no notes / bookmarks / saved-verses API or OAuth scope** (the SDK "notes" are *scripture
> footnotes* via `include_notes` on passage content, not personal notes), and **no "list all highlights"**
> endpoint — the caller must name a chapter. v1 is therefore **highlights-only, per-chapter**. The
> substrate (KMS token custody, refresh, server-side read-proxy, VaultGrant data-scope) is unchanged; only
> the data-type vocabulary collapses to `{highlights}`. The OAuth scope requested is `read_highlights`.

**Status:** draft (implementation spec) · **Builds on:** [spec 264](264-fedcm-idp-adapter.md) + the YouVersion OIDC sign-in (commits 80c305d…16f2427), [ADR-0019](../docs/architecture/decisions/0019-relying-site-delegation.md) (relying-site delegation), [spec 247](247-per-agent-mcp-vault.md) (per-agent MCP vault) · **Custody:** [spec 235](235-google-kms-custody.md) (per-(iss,sub) KMS) · **Apps:** demo-sso-next (Connect/IdP), demo-a2a (token custody + bridge), demo-mcp (read tools)

## Problem

"Sign in with YouVersion" currently yields IDENTITY only: the `/token` exchange returns
`{ access_token, refresh_token, expires_in, id_token, scope }`, but `completeLogin` keeps only the
`id_token` (→ verify → `(iss,sub)` → AgentSession). The **`access_token` — the bearer credential needed
to read the user's YouVersion content (highlights, notes, bookmarks, saved verses) via the Platform API —
is discarded.**

YouVersion is the **source of truth** for that content (it lives in the user's YouVersion account, not our
vault). The Platform API exposes it:

```
GET https://api.youversion.com/v1/highlights?bible_id=<int>&passage_id=<chapter USFM, e.g. JHN.3>
X-YVP-App-Key: <YOUVERSION_CLIENT_ID>
Authorization: Bearer <user access_token>
```
(Highlights are returned **one Bible chapter at a time** — there is no enumerate-all endpoint. The API is
mid-migration `version_id`→`bible_id`, so we send both query names. The OAuth scope is `read_highlights`,
requested additively to `openid profile email`. See the scope-correction note at the top: highlights is
YouVersion's only personal-data resource.)

We want a person to **grant a relying app/agent scoped, revocable access to specific YouVersion data
types**, realized as our existing delegation primitive, with the federated token never leaving our
substrate.

## Model (what the substrate owns vs YouVersion)

- **YouVersion owns the data** (highlights, …) — we read it live via the access_token; we do NOT copy it
  as the source of truth (optional cache only, §6).
- **Our substrate owns the AUTHORITY:** *who* (which app/agent) may access *what* (which data scopes) *for
  whom* (the person) *until when*, realized as a **VaultGrant** = an EIP-712 `person → app.delegate`
  delegation carrying a **data-scope caveat** (the YouVersion data types allowed).
- **The federated token is custody, not data:** it is KMS-encrypted and held server-side by demo-a2a; it
  is **never returned to anyone** — not the relying app, not even a grantee. A grantee presents a
  VaultGrant and receives *highlights*, never the token.

## Architecture

```
Sign in with YouVersion (spec 264 + youversion OIDC)
  /token → { id_token, access_token, refresh_token, expires_in, scope }
  ├─ id_token  → verify → AgentSession (unchanged)
  └─ access_token + refresh_token  → over the HMAC bridge → demo-a2a
        demo-a2a: KMS-encrypt, store keyed by person SA
                  (fed-token: { provider:'youversion', enc(access), enc(refresh), exp, scopes })

Grant (Impact "Connected apps / Delegations" UI)
  person picks data scopes per app  → VaultGrant
     = person → app.delegate delegation + data-scope caveat (e.g. {highlights, notes})

Read (relying app / agent)
  App presents VaultGrant  → demo-mcp tool `youversion.<type>.list` (withDelegation)
     1. verify EIP-712 delegation (principal == person) + the data-scope caveat allows <type>
     2. ask demo-a2a (bridge) to mint a FRESH YouVersion access_token for that person
        (decrypt refresh_token → refresh if access expired → return a short-lived access_token
         OR proxy the call) — the token stays server-side
     3. call YouVersion `/v1/<type>` with the user token + app key
     4. return the allowed data (NEVER the token)
```

### Token custody (decision: KMS-encrypted in demo-a2a — the crown-jewel holder)

- **Capture:** the youversion callback (demo-sso-next) already holds the `/token` response. It sends
  `{ iss, sub, access_token, refresh_token, expires_in, scope }` to a NEW bridge-authenticated demo-a2a
  endpoint `POST /custody/youversion/store-token` (HMAC envelope, audience `custody.youversion.store`).
- **Encrypt + store:** demo-a2a encrypts `access_token` + `refresh_token` with the KMS backend (the same
  `A2A_KMS_BACKEND` that holds the master / signs C_sub) and stores the ciphertext keyed by the person SA
  (`getAddressForAgentAccount` from the (iss,sub) custodian, exactly as `/custody/google/resolve`). Store:
  KV/D1 on demo-a2a (provision alongside `BRIDGE_NONCES`).
- **Refresh:** before a read, if `access` is expired, demo-a2a uses the decrypted `refresh_token` against
  YouVersion `/auth/token` (`grant_type=refresh_token`, public PKCE client — no secret) and re-stores.
- **Use:** ONLY demo-a2a decrypts. The read tool either (a) calls a bridge endpoint that returns a
  short-TTL access_token to demo-mcp, or (b) demo-a2a proxies the YouVersion call and returns the data.
  **Prefer (b)** — the plaintext token never crosses a service boundary at all.

### VaultGrant (the delegation)

- Reuse the relying-site delegation (ADR-0019 / `buildSiteDelegation`) but add a **data-scope caveat**:
  the allowed YouVersion data types. Concretely a new caveat enforcer term (off-chain-verified for the
  demo; the MCP tool checks the granted scope set), or the scope encoded in the grant record the read
  tool reads. The grant is `person → app.delegate`, revocable from the person's home (visibility → zero).
- Per ADR-0021 the *generic* delegation/caveat machinery is package-level; the *YouVersion data-type*
  vocabulary (highlights/notes/…) is APP-level config (demo-sso-next whitelabel + the demo-mcp tool).

### Read tools (demo-mcp)

- `youversion.highlights.list`, `.notes.list`, `.bookmarks.list`, `.savedVerses.list` — each wrapped in
  `withDelegation` (the spec-247 pattern), risk-tier `low` (read). The handler: verify the delegation's
  principal == the person, the data-scope caveat allows the type, then call demo-a2a (bridge) to read the
  data live from YouVersion. Returns the data; never the token.

### Consent UI (the ask)

- In Impact's **delegations / connected-apps** area: when an app requests YouVersion data, show a consent
  sheet listing the available data scopes (Highlights / Notes / Bookmarks / Saved verses) as checkboxes;
  the person selects which to allow. Only the selected scopes go into the VaultGrant's data-scope caveat,
  and only those MCP tools succeed for that app. Revoke per-app or per-scope from the same surface.

## Security invariants

- **The federated token NEVER leaves demo-a2a in plaintext** (encrypt at rest; prefer proxy-read so it
  never crosses a service boundary). Relying apps hold a VaultGrant, never the token (no `access_token` in
  any response to demo-gs/demo-jp or any grantee).
- **Least privilege:** request only the YouVersion scopes the user grants; the read tool enforces the
  data-scope caveat (a grant for `highlights` cannot read `notes`).
- **Fail-closed:** missing/expired/invalid VaultGrant or token → the tool returns empty/throws, never a
  fallback to a broader scope (ADR-0013).
- **Revocation is real:** revoking the VaultGrant (or a scope) makes the read tool refuse; revoking the
  YouVersion link deletes the stored token.
- **Bridge-authenticated** token store/read (HMAC envelope, SEC-010), single-use nonce (the
  `BRIDGE_NONCES` KV from audit M-1).

## Waves

- **W1 — preserve the token.** `connect-auth` `completeLogin` returns `{ accessToken, refreshToken,
  expiresIn, scope }` alongside the principal (additive; Google ignores them). youversion `start.ts`
  requests the data scopes. youversion `callback.ts` sends the tokens to demo-a2a's new
  `/custody/youversion/store-token` (bridge). No read path yet. (Small, reversible.)
- **W2 — custody.** demo-a2a: KMS-encrypt + store keyed by person SA (new KV/D1); the refresh path; a
  bridge read/proxy endpoint. Delete-on-unlink.
- **W3 — VaultGrant + read tools.** the data-scope caveat on the site delegation; the demo-mcp
  `youversion.<type>.list` tools (withDelegation + scope check) proxying through demo-a2a.
- **W4 — consent UI.** the Impact delegations-area scope-picker; per-app/per-scope revoke; relying-app
  (demo-jp/demo-gs) "request YouVersion highlights" affordance.
- **W5 — YouVersion Data Exchange consent (the actual highlights authorization).** *Correction:
  `read_highlights` is NOT an OIDC scope — YouVersion silently drops it from `/authorize`, so sign-in is
  identity-only (`openid profile email`).* Highlights are authorized through YouVersion's separate **Data
  Exchange** flow, run once after sign-in:
  1. demo-a2a `POST /custody/youversion/data-exchange-token` (bridge-authed): with the person's
     KMS-custodied access_token (server-side), call `POST https://api.youversion.com/data-exchange/token`
     `{permissions:['highlights']}` → a short-lived (~5 min) `data_exchange` token. That dx-token is
     DESIGNED to ride the browser URL — it is NOT the access_token (which never leaves the Worker).
  2. Connect `GET /connect/youversion/data-exchange` (person-session authed) mints the dx-token via the
     bridge and returns `{ approveUrl }` = `https://api.youversion.com/data-exchange?token=…&x-yvp-app-key=…`.
  3. The browser navigates to `approveUrl`; the user approves "highlights"; YouVersion redirects to the
     app's **Portal-configured data-exchange callback** (`/oidc/youversion/data-exchange/callback`) with
     `data_exchange_status=granted|cancelled`, which lands the user back at `/apps?yv_highlights=…`.
  4. Afterwards the person's access_token is authorized for `GET /v1/highlights` (grant is server-side at
     YouVersion, per user+app) — the existing W2/W3 read path then works unchanged.
  **Portal prerequisite:** the app key must be enabled for Data Exchange and a data-exchange callback URL
  registered. **No token crosses any new boundary; the VaultGrant (W3) still gates which relying app may
  trigger reads.**

## Reference: smart-agent patterns to port

- **KMS custody:** `/home/barb/smart-agent` `packages/sdk/src/key-custody/{aws-kms-provider,gcp-auth}.ts`
  — the encrypt/decrypt-with-KMS provider shape we already mirror in `key-custody` / the demo-a2a KMS
  backend; reuse it to wrap the federated token (encrypt-at-rest), not just to sign.
- **DELIBERATE DIVERGENCE:** smart-agent has no federated-OAuth-token store or "VaultGrant over a
  third-party data source" — that is net-new here. We diverge because the data lives in an external
  provider (YouVersion), so the substrate brokers *access authority* over a token it custodies, rather
  than owning the data. The delegation/caveat machinery (ADR-0019) is the same primitive used for on-chain
  targets, now scoping an off-chain federated read.

## Acceptance criteria

- After YouVersion sign-in, the access_token + refresh_token are KMS-encrypted at rest in demo-a2a, keyed
  by the person SA; no plaintext token in any log or any response to a relying app.
- A person can grant demo-jp/demo-gs scoped access to chosen YouVersion data types from the delegations
  UI; the grant is a revocable `person → app` delegation.
- `youversion.highlights.list` (etc.) returns the user's live highlights ONLY when a valid VaultGrant with
  the matching data scope is presented; a grant for one scope cannot read another; revocation makes it
  refuse.
- The access_token is refreshed server-side on expiry; the relying app never receives it.
