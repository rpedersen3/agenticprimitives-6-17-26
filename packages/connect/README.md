# @agenticprimitives/connect

**Agentic Connect** — the SSO broker ([spec 224](../../specs/224-agentic-connect.md);
[ADR-0014](../../docs/architecture/decisions/0014-connect-is-an-sso-broker.md)).
It runs at one central origin, proves a credential once (via
[`connect-auth`](../connect-auth)), resolves it to a canonical agent (via
[`identity-directory`](../identity-directory)), and issues a **CAIP-10-subject,
no-owner `AgentSession`** that relying sites verify with the broker's public key.

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
