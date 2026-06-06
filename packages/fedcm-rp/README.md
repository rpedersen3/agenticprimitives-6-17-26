# @agenticprimitives/fedcm-rp

The **relying-party** FedCM wrapper: a thin, dependency-free call over
`navigator.credentials.get({ identity })` that returns the IdP token. It is the FedCM **strategy** you
inject into [`@agenticprimitives/browser-identity`](https://github.com/agentictrustlabs/agenticprimitives/tree/master/packages/browser-identity)'s
`chooseSignIn` — FedCM-first, not FedCM-only ([ADR-0031](https://github.com/agentictrustlabs/agenticprimitives/blob/master/docs/architecture/decisions/0031-fedcm-and-browser-credential-apis-are-adapters.md);
[spec 264](https://github.com/agentictrustlabs/agenticprimitives/blob/master/specs/264-fedcm-idp-adapter.md)).

The returned `token` is a **thin identity bootstrap**; the deep capability/delegation object is obtained
from the substrate **after** this token (ADR-0031), never decoded from a FedCM scope.

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

## Boundaries

Generic + transport-agnostic ([ADR-0021](https://github.com/agentictrustlabs/agenticprimitives/blob/master/docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md)):
no app imports, no hostnames. The consumer supplies `configURL` / `clientId` / `params`, and exchanges the
token with the substrate.

## License

MIT
