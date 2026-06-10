# @agenticprimitives/fedcm-rp

**Browser-native sign-in for the relying party — that hands back identity, never authority.**

When the browser supports FedCM, a relying site can skip the redirect dance entirely: the browser shows a native account chooser and returns a signed assertion. `fedcm-rp` is the thin, dependency-free wrapper over `navigator.credentials.get({ identity })` that makes that call correctly — including the post-Chrome-145 field shapes that broke naive integrations — and returns the IdP token. It is the FedCM **strategy** you inject into [`@agenticprimitives/browser-identity`](https://github.com/agentictrustlabs/agenticprimitives/tree/master/packages/browser-identity)'s `chooseSignIn` — FedCM-first, not FedCM-only ([ADR-0031](https://github.com/agentictrustlabs/agenticprimitives/blob/master/docs/architecture/decisions/0031-fedcm-and-browser-credential-apis-are-adapters.md); [spec 264](https://github.com/agentictrustlabs/agenticprimitives/blob/master/specs/264-fedcm-idp-adapter.md)).

The returned `token` is a **thin identity bootstrap**: it says who signed in, nothing more. The deep capability/delegation object — scoped, revocable, on-chain-enforceable authority — is obtained from the substrate **after** this token (ADR-0031), never decoded from a FedCM scope. Sign-in and authorization stay separate layers, which is exactly where stitched stacks leak.

> Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

## Install

```bash
npm install @agenticprimitives/fedcm-rp
```

## Usage (as the injected FedCM strategy)

```ts
import { chooseSignIn } from '@agenticprimitives/browser-identity';
import { fedcmSupported, fedcmGet } from '@agenticprimitives/fedcm-rp';

const result = await chooseSignIn({
  // Run FedCM when the browser supports it; otherwise the guaranteed spec-259 fallback.
  fedcm: fedcmSupported()
    ? async () => {
        const { token } = await fedcmGet({
          providers: [{
            configURL: 'https://www.example/fedcm/config.json',
            clientId: 'demo-gs',
            // post-145: nonce + custom params ride INSIDE params
            params: { nonce, scope: 'profile.read', intent: 'signin' },
          }],
        });
        return exchangeAssertionForSession(token); // → your app session + substrate delegation
      }
    : undefined,
  fallback: () => startConnectPopup(),
});
```

### `fedcmGet(options)`

`providers[]` (1+; Chrome 136 multi-IdP), `context` (`signin`|`signup`|`use`|`continue`), `mode`
(`passive`|`active` — `active` requires a single provider + a user gesture), `mediation`
(`optional`|`required`|`silent`), `signal`. Returns `{ token, configURL?, isAutoSelected? }`. Throws if
unsupported / dismissed / errored — treat a throw as "use the fallback."

## How it's different from calling FedCM directly

You could call `navigator.credentials.get({ identity })` yourself. Three reasons this wrapper earns its place:

- **It tracks the moving contract.** FedCM's request shape changed across Chrome 143→145 (`nonce` and custom params moved inside `params`); this package encodes the current shape so your app code does not chase browser releases.
- **It is failure-honest.** A throw means "use the fallback" — composing cleanly with `browser-identity`'s selector instead of leaving every caller to invent its own unsupported/dismissed/error handling.
- **It refuses to be an authorization channel.** No token decoding, no scope interpretation, no substrate imports. The consumer exchanges the token with the substrate; permissions can never ride in on a browser credential.

The IdP half lives in [`fedcm-idp`](../fedcm-idp); the FedCM-vs-fallback selection in [`browser-identity`](../browser-identity).

## Boundaries

Generic + transport-agnostic ([ADR-0021](https://github.com/agentictrustlabs/agenticprimitives/blob/master/docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md)):
no app imports, no hostnames. The consumer supplies `configURL` / `clientId` / `params`, and exchanges the
token with the substrate.

## Status — draft, and labeled as such

**This package is a draft (spec 264 Phase 1, `private: true`).** FedCM is Chromium-only today, and the field names changed across Chrome 143→145 (`params.nonce`, `.error`). Verify against a live Chrome before relying on this in production (spec 264 Phase 1b).

Beyond that caveat: testnet/pilot-ready. Production launch is gated on the public checklist in the root README — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).

## Validate

```bash
pnpm --filter @agenticprimitives/fedcm-rp build
pnpm --filter @agenticprimitives/fedcm-rp test
```

## License

MIT
