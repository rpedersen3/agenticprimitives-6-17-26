# @agenticprimitives/connect — Claude guide

## The SSO broker (trust concentration)
Ties credential ceremonies (`connect-auth`) + resolution (`identity-directory`)
into a **CAIP-10-subject, no-owner `AgentSession`** ([spec 224](../../specs/224-agentic-connect.md);
[ADR-0014](../../docs/architecture/decisions/0014-connect-is-an-sso-broker.md)).
It runs at ONE central origin (the passkey RP) so one enrollment serves every
relying site. This is an IdP-class trust concentration — treat every change here
as security-critical.

## What this package owns
- **AgentSession token layer** (CN-4): asymmetric mint/verify (EdDSA default,
  ES256 fallback) + JWKS publish/import. `verifyAgentSession` PINS the alg to the
  key (by `kid`), never the token's header; rejects `alg:none`/confusion and any
  `owner` field (ADR-0016).
- **Broker convergence + issuance** (CN-2/5/6/8): `convergence` (0→bootstrap,
  1→issue, many→disambiguate), `canIssueSession` (non-EVM gate + assurance
  floor), `selectFromResolution` (server-binds the disambiguation choice),
  `requiresStepUp`, `issueForResolution`.
- **Redirect/response** (CN-1/9): `validateRedirectUri` (exact-match allowlist) +
  a single-use, TTL-bounded auth-code store (code-exchange, not bearer-in-URL).

## What this package does NOT own
- Credential ceremonies (OIDC / passkey / SIWE verification) → `connect-auth`.
  The broker calls connect-auth, then resolves the verified principal.
- Resolution / the directory graph → `identity-directory` (+ adapters).
- The HS256 same-origin `BrokerSession` → `connect-auth`'s `mintSession`
  (the broker's own cookie session; NOT the cross-origin AgentSession here).
- Custody / credential rotation / step-up *execution* → on-chain
  (`account-custody`/`agent-account`); the broker only CLASSIFIES + initiates.
- The runtime CAIP-10 builder → `agent-profile`.

## Vocabulary
**Owns:** `AgentSession` (minting; the type is in `types`), `BrokerSigner`,
`VerifyKey`, `Convergence`, `IssueOutcome`, `AuthCodeStore`. **"session"** here =
the cross-origin `AgentSession` (asymmetric), distinct from `BrokerSession`
(HS256, connect-auth) and `SessionRow` (delegation). See
[`docs/architecture/vocabulary-map.md`](../../docs/architecture/vocabulary-map.md).
**Does not use:** `Delegation`, `Caveat`, `evaluatePolicy`, `withDelegation`.

## Read these first (in order)
1. `capability.manifest.json` — boundary (types + connect-auth + identity-directory).
2. `../../specs/224-agentic-connect.md` §3–§9 + the audit CN-1…CN-12.
3. `src/token.ts` (the security core) then `src/broker.ts`, `src/redirect.ts`.

## Stable public exports
- Token: `generateBrokerKeypair`, `mintAgentSession`, `verifyAgentSession`,
  `exportPublicJwk`, `publishJwks`, `importJwks` (+ `BrokerAlg`/`BrokerSigner`/`VerifyKey`).
- Broker: `convergence`, `canIssueSession`, `isCustodiedNamespace`,
  `SESSION_ISSUANCE_FLOOR`, `selectFromResolution`, `requiresStepUp`,
  `CUSTODY_CLASS_ACTIONS`, `issueForResolution`.
- Redirect: `validateRedirectUri`, `newAuthCode`, `createInMemoryAuthCodeStore`.

## Allowed imports
`@agenticprimitives/types`, `@agenticprimitives/connect-auth`,
`@agenticprimitives/identity-directory`.

## Forbidden imports
- `apps/*`
- `agent-naming` / `agent-profile` / `identity-directory-adapters` (the broker
  consumes the directory CORE + injected ports; apps wire the adapters).
- Every other `@agenticprimitives/*`.

## Drift triggers — STOP and route
- "Verify an OIDC id_token / passkey assertion here" — **STOP.** `connect-auth`.
- "Read the credential set on-chain here" — **STOP.** The directory's
  `OnChainReadPort` confirms (resolution returns `onchain-confirmed`); the broker
  enforces the FLOOR on that, it does not re-implement the read.
- "Issue an on-chain write / grant custody from a login-grade session" — **STOP.**
  Login-grade authorizes no write (CN-2); custody-class needs step-up + on-chain
  validation.
- "Deliver the AgentSession as a token in the redirect URL" — **STOP.** Use the
  code-exchange (§4a / CN-1/9).
- "Reuse the HS256 secret to verify the cross-origin token" — **STOP.** Asymmetric
  only; iss/kid-separated (CN-4).

## Before you write code
- [ ] Does `verifyAgentSession` still pin alg to the key (never the token header)?
- [ ] Does issuance still enforce the non-EVM gate + the `onchain-confirmed` floor?
- [ ] Is a disambiguation choice server-validated against the resolution set (CN-5)?
- [ ] Is the AgentSession still owner-free (ADR-0016)?
- [ ] Did I update `specs/224-agentic-connect.md` if the public API changed?

## Security invariants (DO NOT BREAK)
- **Alg-pinned verification** (CN-4): the key (by `kid`) dictates the algorithm;
  reject `alg:none`/HS/confusion; `iss`-first.
- **No-owner AgentSession** (ADR-0016): reject any token carrying `owner`.
- **Issuance floor + non-EVM gate** (CN-6/CN-8): existing-agent sessions need
  `onchain-confirmed`; non-`eip155` subjects are identifier-only.
- **Code-exchange, not bearer-in-URL** (CN-1/9): single-use, TTL-bounded codes;
  exact-match redirect_uri allowlist.

## Validate the package
```bash
pnpm --filter @agenticprimitives/identity-directory build   # dep dist for vitest
pnpm --filter @agenticprimitives/connect typecheck
pnpm --filter @agenticprimitives/connect test
pnpm check:forbidden-terms
```

## Common task routing
- New entry flow → wire connect-auth verify → `directory.resolveBy*` →
  `issueForResolution`; add the flow to `apps/demo-sso`, keep verification in connect-auth.
- New token algorithm → `src/token.ts` (`BrokerAlg` + the param maps); keep
  verification alg-pinned.
- Step-up execution → on-chain (agent-account/account-custody), not here.

## Capabilities this package participates in
- **SSO / session issuance** — the capstone of the identity stack (connect-auth +
  identity-directory + ontology). Audit: per spec 224, issuance/verification
  decisions can emit via a consumer `AuditSink` (wired in `apps/demo-sso`).
- Index: [`docs/architecture/cross-cutting-capabilities.md`](../../docs/architecture/cross-cutting-capabilities.md).

## Generated files (ignore)
`dist/`, `node_modules/`, `coverage/`, `*.tsbuildinfo`.
