# Google OIDC setup for demo-sso

Real Google sign-in for the Connect broker. The OAuth **client secret must be
server-side** — so the config lives on the **Pages Function broker**
(`functions/oidc/google/*`), NOT in the browser bundle. (This is the same reason
smart-agent keeps it in `apps/web/.env` / `google-oauth.ts`, never the client.)

## 1. Where the values go (demo-sso Pages env)

Set these on the Pages project (the Connect origin). `*_SECRET` MUST be a secret;
the others can be plain env vars but secrets are fine too:

```bash
wrangler pages secret put GOOGLE_CLIENT_ID        # paste the Client ID
wrangler pages secret put GOOGLE_CLIENT_SECRET    # paste the Client secret  (server-only!)
wrangler pages secret put GOOGLE_REDIRECT_URI     # paste the exact callback URL (below)
```

Read by `functions/_lib/server-broker.ts` → `functions/oidc/google/{start,callback}.ts`
via `context.env.GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`
(the demo-sso analogue of smart-agent's `apps/web/src/lib/auth/google-oauth.ts`
reading `process.env.GOOGLE_*`).

Also required (already in `wrangler.toml`): the `AUTH_CODES` KV namespace — it
stores the transient OIDC `state`/PKCE context AND the single-use auth codes.

For local dev (`wrangler pages dev dist`) put the same values in a gitignored
`.dev.vars` file at the app root:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:8788/oidc/google/callback
```

## 2. Google Cloud Console

**APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.**

- **Authorized JavaScript origins:** the Connect origin, e.g.
  `https://connect.<yourdomain>` (and `http://localhost:8788` for `wrangler pages dev`).
- **Authorized redirect URIs (must EXACTLY match `GOOGLE_REDIRECT_URI`):**
  - Production: `https://connect.<yourdomain>/oidc/google/callback`
  - Local: `http://localhost:8788/oidc/google/callback`
  (Note the path is `/oidc/google/callback` — demo-sso's Pages Function route —
  NOT smart-agent's `/api/auth/google-callback`.)
- **OAuth consent screen:** add the `openid`, `email`, `profile` scopes; add test
  users while the app is in "testing".

Copy the generated **Client ID** + **Client secret** into the Pages secrets above.

## 3. The flow (what the functions do)

```
relying site → GET  /oidc/google/start?aud=<rp>&redirect_uri=<rp-callback>
   broker: beginLogin (PKCE S256 + state + nonce) → 302 to Google
Google → GET /oidc/google/callback?code&state
   broker: completeLogin (token exchange w/ client_secret → id_token verify:
           RS256/JWKS alg-pinned, iss/aud/exp/nonce, email_verified)  [connect-auth]
        → verified (iss, sub) = a LOGIN-GRADE credential facet
        → directory.resolveByOidcSubject → issueForResolution
        → §4a: stash token under a single-use code → 302 back to the relying site with ?code
relying site → POST /token { code, aud } → { agentSession }  → verify via GET /jwks
```

## 4. What you do NOT need (divergence from smart-agent)

smart-agent derives a **deterministic smart account from the Google user**
(email → CREATE2 salt), so it needs `OAUTH_SALT_HMAC_KEY` /
`AWS_KMS_MAC_KEY_ID_OAUTH_SALT`. **demo-sso does not.** Our model (ADR-0016/0017,
audit CN-3):

- The OIDC subject is a **login-grade credential facet keyed on `(iss, sub)`**,
  **never on email** (email is reusable → a takeover vector). The canonical agent
  is **RESOLVED** via `identity-directory.resolveByOidcSubject(iss, sub)`, not
  derived from the email.
- So there is **no `OAUTH_SALT_HMAC_KEY` here.** A salt is only relevant on the
  **bootstrap** path (0 agents → create a new SA, spec 220), and even then it is
  derived from the credential/scope (ADR-0010: salt from auth methods + scope,
  never a name/email), not the email. Bootstrap is not yet wired in this demo.
- An OIDC session is **login-grade**: it can read + act in pre-authorized bounds,
  but a custody-class action needs **step-up** to a custody-grade credential
  (ADR-0017 / CN-2).

## 5. Bringing OIDC into the other demos later

The same `@agenticprimitives/connect-auth/google` method + a server endpoint
(Pages Function / Worker) is reusable. Each app sets its own `GOOGLE_*` secrets +
registers its own callback URL in the Google Console. Keep the client secret
server-side everywhere.
