---
'@agenticprimitives/connect-auth': minor
'@agenticprimitives-demo/a2a': patch
---

R5.11 — CSRF `actualOrigin` binding + optional method/path/session
bindings (P1-2 closure).

### Breaking

- **`csrfTokenFor` signature changed:** `csrfTokenFor(origin: string)` →
  `csrfTokenFor(opts: CsrfMintOpts)`. Migrate via
  `csrfTokenFor({ origin })`.
- **`verifyCsrf` signature changed:** `verifyCsrf(token, allowedOrigins[])` →
  `verifyCsrf(token, opts: CsrfVerifyOpts)`. The verifier now
  REQUIRES `actualOrigin` and rejects unless
  `stamp.origin === actualOrigin AND actualOrigin ∈ allowedOrigins`.

### Why

External senior-architect audit P1-2: pre-R5.11 `verifyCsrf` checked
only the token's SIGNED origin against the allowlist; it never
compared against the request's ACTUAL origin. A token legitimately
minted for `https://app.com` (signed, in allowlist) would pass even
when the request came from `https://evil.com`. The double-submit
cookie pattern helps but doesn't bind the verifier to the request
origin.

P1-2's secondary concern was that "a token usable on POST /transfer
is also usable on POST /grant-admin" — no method/path/session
binding.

### Fix

`actualOrigin` is the load-bearing check; allowlist is defense in
depth. Optional `method`, `path`, `sessionSid` bindings stamp into
the HMAC; both mint AND verify must agree or the verifier rejects.

Production gate: `NODE_ENV=production` + `developmentMode !== true`
+ empty `actualOrigin` → throws with remediation message (mirrors
the R5.10 verifySession gate).

### Migration

```ts
// before
csrfTokenFor('https://app.com');
verifyCsrf(token, ['https://app.com']);

// after
csrfTokenFor({ origin: 'https://app.com' });
verifyCsrf(token, {
  actualOrigin: request.headers.get('origin') ?? '',
  allowedOrigins: ['https://app.com'],
});

// with bindings (defense in depth for high-risk endpoints):
csrfTokenFor({
  origin: 'https://app.com',
  method: 'POST',
  path: '/transfer',
  sessionSid: jwt.sid,
});
verifyCsrf(token, {
  actualOrigin: request.headers.get('origin') ?? '',
  allowedOrigins: ['https://app.com'],
  method: 'POST',
  path: '/transfer',
  sessionSid: jwt.sid,
});
```

### Tests

- 16 new R5.11 tests + 7 existing csrf tests rewritten = 23 csrf
  tests total
- 97/97 connect-auth tests pass

### demo-a2a

`apps/demo-a2a/src/index.ts`:
- CSRF middleware passes `actualOrigin: reqOrigin ?? ''` with
  `developmentMode: true` for the testnet demo (spec 227
  Real-Connect will tighten the gate).
- `/auth/csrf` issuer passes `{ origin: parsedOrigin }`.

### New exports

- `CsrfBindings` — `{ method?, path?, sessionSid? }`
- `CsrfMintOpts extends CsrfBindings` — `{ origin, ...CsrfBindings }`
- `CsrfVerifyOpts extends CsrfBindings` — adds `actualOrigin`,
  `allowedOrigins`, `developmentMode`
