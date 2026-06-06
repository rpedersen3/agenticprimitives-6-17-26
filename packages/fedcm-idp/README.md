# @agenticprimitives/fedcm-idp

The **FedCM Identity Provider contract** as pure, dependency-free builders + validators. It encodes the
browser↔IdP wire shapes — the `/.well-known/web-identity` manifest, the provider config, the accounts
list, the **thin** id-assertion claims, and the request validators — so an app (demo-sso) can host the
FedCM IdP endpoints without hand-rolling the contract.

Part of the FedCM **adapter** over the agenticprimitives authority substrate — FedCM-first, not
FedCM-only ([ADR-0031](https://github.com/agentictrustlabs/agenticprimitives/blob/master/docs/architecture/decisions/0031-fedcm-and-browser-credential-apis-are-adapters.md);
[spec 264](https://github.com/agentictrustlabs/agenticprimitives/blob/master/specs/264-fedcm-idp-adapter.md)).
This package performs **no I/O, holds no key, signs nothing** — the app owns the session + account list
and signs the assertion claims with its existing OIDC key. The deep capability/delegation object is
issued by the substrate **after** the assertion (ADR-0031); the assertion is a thin identity+intent
bootstrap only.

## Install

```bash
npm install @agenticprimitives/fedcm-idp
```

## Usage (in the IdP app's route handlers)

```ts
import {
  buildWebIdentity, buildProviderConfig, buildAccountsResponse,
  buildAssertionClaims, isWebIdentityRequest, parseAssertionRequest,
} from '@agenticprimitives/fedcm-idp';

// GET /.well-known/web-identity
return Response.json(buildWebIdentity(['https://www.example/fedcm/config.json']));

// GET /fedcm/config.json
return Response.json(buildProviderConfig({
  accountsEndpoint: '/fedcm/accounts',
  idAssertionEndpoint: '/fedcm/assertion',
  loginUrl: '/fedcm/login',
  branding: { name: 'Impact' },
}));

// GET /fedcm/accounts  — app resolves the signed-in agents → rows; id = SA address (stable key)
if (!isWebIdentityRequest(req.headers.get('sec-fetch-dest'))) return new Response(null, { status: 400 });
return Response.json(buildAccountsResponse(agents.map(a => ({ id: a.address, name: a.label }))));

// POST /fedcm/assertion  — parse, then the APP signs the claims with its OIDC key
const parsed = parseAssertionRequest(Object.fromEntries(await req.formData()));
if (!parsed) return new Response(null, { status: 400 });
const claims = buildAssertionClaims({ iss, aud: parsed.clientId, sub: accountAddress, origin, nonce: parsed.nonce, iat });
const token = await signWithOidcKey(claims);          // app's key — NOT this package
return Response.json({ token });
```

## Boundaries

Generic + transport-agnostic ([ADR-0021](https://github.com/agentictrustlabs/agenticprimitives/blob/master/docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md)):
no hostnames, no signing, no app imports. The endpoint **hosting**, the account list, the OIDC signer,
and the substrate delegation all live in the app.

## Draft note

FedCM IdP field names follow the W3C/Chrome contract, which had breaking changes across Chrome 143→145.
Verify against the current FedCM spec + a live Chrome before relying on this in production (spec 264
Phase 1b).

## License

MIT
