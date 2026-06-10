# @agenticprimitives/fedcm-idp

**Become a FedCM identity provider for agents — where the account ID is an on-chain address, not a database row.**

FedCM lets a browser broker federated sign-in natively, but hosting the IdP side means getting a fussy wire contract exactly right: the `/.well-known/web-identity` manifest, the provider config, the accounts list, the id-assertion exchange. `fedcm-idp` encodes that contract as pure, dependency-free builders and validators, so an app can host the FedCM IdP endpoints without hand-rolling the shapes — and with one substrate-grade twist: the account `id` the browser's chooser keys on is the Smart Agent address ([ADR-0010](https://github.com/agentictrustlabs/agenticprimitives/blob/master/docs/architecture/decisions/0010-smart-agent-canonical-identifier.md)), a stable on-chain identifier, never a name or a vendor user ID.

This is the IdP half of the FedCM **adapter** over the agenticprimitives authority substrate — FedCM-first, not FedCM-only ([ADR-0031](https://github.com/agentictrustlabs/agenticprimitives/blob/master/docs/architecture/decisions/0031-fedcm-and-browser-credential-apis-are-adapters.md); [spec 264](https://github.com/agentictrustlabs/agenticprimitives/blob/master/specs/264-fedcm-idp-adapter.md)). The package performs **no I/O, holds no key, signs nothing** — the app owns the session and account list and signs the assertion claims with its existing OIDC key. The assertion is a **thin** identity+intent bootstrap only; the deep capability/delegation object is issued by the substrate **after** the assertion, never as a FedCM scope.

> Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

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
  branding: { name: 'Example IdP' },
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

The validators fail closed: `isWebIdentityRequest` rejects anything but a genuine browser FedCM fetch, and `parseAssertionRequest` returns nothing rather than a partially-valid request.

## How it's different from rolling the FedCM contract yourself

Most FedCM IdP implementations are bespoke route handlers written against the W3C/Chrome docs, with the wire shapes inlined and the key handling entangled. This package splits the concerns the way an auditor would want:

- **Pure contract, zero authority.** Builders and validators only — no fetch, no storage, no signing key. The blast radius of this package is a malformed JSON body, not a forged token.
- **Stable subjects by design.** The accounts-list `id` is the canonical Smart Agent address, so the browser's per-account state and the relying party's subject survive credential rotation and renames.
- **Authority stays out of the assertion.** Scoped, revocable permissions come from the substrate's delegation layer after sign-in — a compromised or drifting FedCM contract cannot widen what an agent may do.

The relying-party half lives in [`fedcm-rp`](../fedcm-rp); the FedCM-vs-fallback selection lives in [`browser-identity`](../browser-identity).

## Boundaries

Generic + transport-agnostic ([ADR-0021](https://github.com/agentictrustlabs/agenticprimitives/blob/master/docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md)):
no hostnames, no signing, no app imports. The endpoint **hosting**, the account list, the OIDC signer,
and the substrate delegation all live in the app.

## Status — draft, and labeled as such

**This package is a draft (spec 264 Phase 1, `private: true`).** FedCM IdP field names follow the W3C/Chrome contract, which had breaking changes across Chrome 143→145. Verify against the current FedCM spec and a live Chrome before relying on this in production (spec 264 Phase 1b).

Beyond that caveat: testnet/pilot-ready. Production launch is gated on the public checklist in the root README — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).

## Validate

```bash
pnpm --filter @agenticprimitives/fedcm-idp build
pnpm --filter @agenticprimitives/fedcm-idp test
```

## License

MIT
