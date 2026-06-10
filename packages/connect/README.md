# @agenticprimitives/connect

**Single sign-on where the session subject is an on-chain identity, not a vendor account.**

Every hosted identity provider can tell a relying site "this is user `8f3a…` in our database." None can tell it "this is Smart Agent `0xAB12…`, with custody policy behind it and authority you can verify on-chain." That gap is what `connect` closes. It is the SSO broker of the agenticprimitives stack ([spec 224](../../specs/224-agentic-connect.md); [ADR-0014](../../docs/architecture/decisions/0014-connect-is-an-sso-broker.md)): it runs at one central origin, proves a credential once (via [`connect-auth`](../connect-auth)), resolves it to a canonical agent (via [`identity-directory`](../identity-directory)), and issues a **CAIP-10-subject, no-owner `AgentSession`** that relying sites verify with the broker's public key. One passkey enrollment serves every relying site — and the token names the agent itself, never a vendor user ID.

> Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

## What's here

```
token.ts     AgentSession mint/verify + JWKS — asymmetric (EdDSA/ES256), alg-pinned (CN-4)
broker.ts    convergence (0→bootstrap / 1→issue / many→disambiguate) + issuance gates (CN-2/5/6/8)
redirect.ts  redirect_uri allowlist + single-use auth-code store (CN-1/9)
```

## Usage (sketch)

```ts
import { generateBrokerKeypair, issueForResolution, verifyAgentSession, publishJwks } from '@agenticprimitives/connect';

const signer = await generateBrokerKeypair();           // EdDSA by default
const jwks = await publishJwks([signer]);               // serve at /.well-known/jwks.json

// after connect-auth verifies a credential and identity-directory resolves it:
const out = await issueForResolution({ resolution, principal, signer, aud: clientId, iss: connectOrigin, ttlSeconds: 600 });
// out.status: 'issued' (token) | 'bootstrap' | 'disambiguate' | 'rejected'

// relying site:
const v = await verifyAgentSession(token, { keys: await importJwks(jwks), expectedIss: connectOrigin, expectedAud: clientId });
```

## Security (audit CN controls)

This is an IdP-class trust concentration, and the package treats it that way — each control below maps to a finding ID in the [spec 224](../../specs/224-agentic-connect.md) audit:

- **Token (CN-4):** verification pins the algorithm to the key (by `kid`), never
  the token's header — rejects `alg:none` + RS/ES↔HS confusion; an `AgentSession`
  carrying an `owner` is rejected (ADR-0016).
- **Issuance (CN-6/CN-8):** an existing-agent session needs `onchain-confirmed`
  assurance (which the directory only assigns after an on-chain membership
  confirm — a revoked credential never reaches issuance); a non-`eip155` subject
  is identifier-only (no control session).
- **Disambiguation (CN-5):** the chosen subject is server-validated against the
  resolution set; never a client-echoed `sub`.
- **Redirect (CN-1/9):** exact-match `redirect_uri` allowlist + single-use,
  TTL-bounded auth-code exchange — the token never rides in a URL.
- **Step-up (CN-2):** `requiresStepUp` classifies custody-class actions; a
  login-grade session authorizes no on-chain write.

The HS256 same-origin `BrokerSession` is `connect-auth`'s, a different token from
this asymmetric cross-origin `AgentSession`.

## Why this instead of Privy, Dynamic, or Web3Auth

Auth and embedded-wallet vendors end at login plus a key held inside their account system. `connect` begins there. The session it issues is bound to a canonical on-chain Smart Agent — an identity with custody policy, recoverable credentials, and delegated authority behind it, none of which depends on the broker's database surviving. Two consequences worth naming:

- **A login-grade session authorizes no on-chain write.** Custody-class actions require explicit step-up classification (CN-2); execution happens on-chain, never inside this package. Vendor sessions typically carry whatever the embedded key can sign.
- **The subject outlives the credential.** Recovery rotates passkeys; the CAIP-10 subject — and every delegation the agent ever issued — stays valid ([ADR-0011](../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md)).

What this package deliberately does not do: verify credentials (that is `connect-auth`), own the resolution graph (`identity-directory`), or execute custody changes (on-chain modules). One job, audited.

## Status

Testnet/pilot-ready. Production launch is gated on the public checklist in the root README — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).

## Validate

```bash
pnpm --filter @agenticprimitives/identity-directory build   # dep dist for vitest
pnpm --filter @agenticprimitives/connect typecheck
pnpm --filter @agenticprimitives/connect test
pnpm check:forbidden-terms
```
