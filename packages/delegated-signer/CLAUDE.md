# @agenticprimitives/delegated-signer — Claude guide

Generic **named delegated-signer resolution** (spec 276 KCS-D6). Answers: "give me a
signer for the NAMED identity X, authorized by delegation chain Y." It is the vertical-agnostic
core that an app's bespoke `trust-context.ts` orchestration reduces to.

## What this package owns
- `resolveDelegatedSigner(opts)` — resolves a name → SA, confirms the account, verifies the
  delegation chain's **authority linkage** (rooted at the named SA, terminating at the signer key),
  and returns `{ signerAddress, delegatorAgent, sign(digest) }`.
- `NameResolver` / `AccountVerifier` injected-client types.

## What this package does NOT own
- **Naming / account network access** — INJECTED (`resolveName`, `verifyAccount`). This package never
  imports `agent-naming` / `agent-account` directly, never hardcodes a TLD/registry (ADR-0021).
- **Delegation semantics** — `delegation` owns `Delegation`, `hashDelegation`, `ROOT_AUTHORITY`,
  `verifyAuthorization`. We compose them; we don't redefine them.
- **KMS signing** — `key-custody` owns `KmsAccountBackend` + the signing crypto. We only call it.
- **On-chain ERC-1271 signature verification** of each link — that's `delegation.verifyAuthorization`;
  inject it upstream if needed. We verify structure + authority-hash linkage (fail-closed, ADR-0013).
- **Vertical defaults** (`bsb.impact`, D1 tables, Worker routes, secret names) — those stay in apps.

## Dependency position
Top-level **leaf** (like `mcp-runtime`): depends on `delegation` + `key-custody` (+ `types`, `viem`).
Nothing in Ring 0 depends on this. No back-edges.

## Allowed imports
`@agenticprimitives/types`, `@agenticprimitives/delegation`, `@agenticprimitives/key-custody`
(barrel, type-only), `viem`.

## Forbidden imports
`apps/*`; `@agenticprimitives/agent-naming` / `agent-account` (use the injected client callbacks).

## Validate
```bash
pnpm --filter @agenticprimitives/delegated-signer typecheck
pnpm --filter @agenticprimitives/delegated-signer test
```
