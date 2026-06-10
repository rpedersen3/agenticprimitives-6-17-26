# @agenticprimitives/browser-identity

**Adopt browser-native sign-in the day your users' browsers support it — without betting your auth flow on it.**

FedCM is how browsers want federated login to work: no third-party cookies, no redirect dance, a native account chooser. It is also MDN "Limited availability" — building on it exclusively strands every non-Chromium user. `browser-identity` is the adapter seam that resolves the tension: it feature-detects the browser's FedCM API and chooses the browser-native path when available, otherwise a guaranteed fallback. **FedCM-first, not FedCM-only** ([ADR-0031](https://github.com/agentictrustlabs/agenticprimitives/blob/master/docs/architecture/decisions/0031-fedcm-and-browser-credential-apis-are-adapters.md); [spec 264](https://github.com/agentictrustlabs/agenticprimitives/blob/master/specs/264-fedcm-idp-adapter.md)).

The deeper design point: browser credential APIs (FedCM, WebAuthn, the Digital Credentials API, OAuth/OIDC, SIWE) are *adapters* over the agenticprimitives authority substrate — not the substrate. Sign-in proves who showed up; the capability/delegation object that says what the agent may do is issued by the substrate *after* sign-in, never smuggled into a browser credential. This package owns only the generic, transport-agnostic **selector + feature-detect**; the concrete sign-in strategies are **injected by the consumer**.

> Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

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

## How it's different

Most FedCM integrations are written directly against `navigator.credentials.get` inside one app, which couples the auth flow to a still-moving browser API. This package is the deliberately small alternative:

- **The seam is free.** With no `fedcm` strategy provided, `chooseSignIn` runs the fallback — zero behaviour change versus calling your launcher directly. You can ship the seam today and inject the real FedCM strategy (see [`fedcm-rp`](../fedcm-rp)) when ready.
- **No opinion about your result type.** Strategies return your `T`; the selector never inspects it. It composes with any session shape, including the substrate's `AgentSession`.
- **Identity bootstrap only.** Authority — what the signed-in agent may do — comes from the substrate's delegation layer afterward, so a browser API change can never widen permissions.

## Boundaries

Generic + transport-agnostic ([ADR-0021](https://github.com/agentictrustlabs/agenticprimitives/blob/master/docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md)):
no app imports, no transport SDKs, no concrete hostnames. The FedCM **IdP endpoint hosting** + the
account list live in the consuming app, not here.

## Status

This package is intentionally minimal — the spec-264 Phase 0 seam (selector + feature-detect); concrete FedCM strategies live in [`fedcm-rp`](../fedcm-rp) and are injected per Phase 1. Testnet/pilot-ready. Production launch is gated on the public checklist in the root README — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).

## Validate

```bash
pnpm --filter @agenticprimitives/browser-identity build
pnpm --filter @agenticprimitives/browser-identity test
```

## License

MIT
