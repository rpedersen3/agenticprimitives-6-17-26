# @agenticprimitives/browser-identity

The **browser-integration adapter seam** for agenticprimitives sign-in. It feature-detects the browser's
FedCM API and chooses the browser-native federated path when available, otherwise a guaranteed fallback.
**FedCM-first, not FedCM-only** ([ADR-0031](https://github.com/agentictrustlabs/agenticprimitives/blob/master/docs/architecture/decisions/0031-fedcm-and-browser-credential-apis-are-adapters.md);
[spec 264](https://github.com/agentictrustlabs/agenticprimitives/blob/master/specs/264-fedcm-idp-adapter.md)).

Browser credential APIs (FedCM, WebAuthn, the Digital Credentials API, OAuth/OIDC, SIWE) are *adapters*
over the agenticprimitives authority substrate — not the substrate. This package owns only the generic,
transport-agnostic **selector + feature-detect**; the concrete sign-in strategies are **injected by the
consumer**, and the deep capability/delegation object is issued by the substrate *after* sign-in.

## Install

```bash
npm install @agenticprimitives/browser-identity
```

## Usage

```ts
import { chooseSignIn, fedcmAvailable } from '@agenticprimitives/browser-identity';

// The app injects its own strategies; this package only chooses between them and never inspects T.
const result = await chooseSignIn({
  // Phase 1+: the FedCM RP path (navigator.credentials.get({ identity })). Omit it until wired —
  // the fallback runs, so the seam is in place with zero behaviour change (Phase 0).
  // fedcm: () => fedcmSignIn(providers),
  fallback: () => startConnectPopup(),  // the guaranteed home popup/redirect (spec 259)
});

if (fedcmAvailable()) {
  // ... progressive enhancement when the browser supports FedCM
}
```

### `chooseSignIn(options)`

| Option | Type | Notes |
| --- | --- | --- |
| `fallback` | `() => Promise<T>` | **Required.** The path that works in every browser (spec 259). |
| `fedcm` | `() => Promise<T>` | Optional. The browser-native FedCM path; run only when supported. |
| `prefer` | `'auto' \| 'fedcm' \| 'fallback'` | `'auto'` (default) feature-detects; the others pin a path (tests, opt-out, staged rollout). |

Returns the consumer's own result type `T` — this package is agnostic to its shape.

### `fedcmAvailable()`

Returns `true` only when `navigator.credentials.get` and the FedCM `IdentityCredential` interface are
present. SSR-safe (returns `false` off the browser). FedCM is MDN "Limited availability," so a `false`
here is expected on many browsers — the fallback handles them.

## Boundaries

Generic + transport-agnostic ([ADR-0021](https://github.com/agentictrustlabs/agenticprimitives/blob/master/docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md)):
no app imports, no transport SDKs, no concrete hostnames. The FedCM **IdP endpoint hosting** + the
account list live in the app (demo-sso), not here.

## License

MIT
