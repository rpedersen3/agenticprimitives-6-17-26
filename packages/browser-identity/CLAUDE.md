# @agenticprimitives/browser-identity — Claude guide

The browser-integration **adapter seam** (spec 264 Phase 0; [ADR-0031](../../docs/architecture/decisions/0031-fedcm-and-browser-credential-apis-are-adapters.md)).

## What this package owns
- `fedcmAvailable()` — feature-detect the browser's FedCM API (`navigator.credentials.get({identity})`). SSR-safe.
- `chooseSignIn({ fedcm?, fallback, prefer? })` — pick the browser-native FedCM path when supported + provided, else the **guaranteed fallback**. **FedCM-first, not FedCM-only.**
- `SignInStrategy<T>` / `ChooseSignInOptions<T>` — the injection types.

## What this package does NOT own
- **The substrate / authority.** FedCM/the assertion is a thin *identity* bootstrap; the capability/delegation object is issued by the substrate AFTER sign-in, never here (ADR-0031).
- **Concrete sign-in strategies.** The FedCM RP path + the home popup/redirect fallback (spec 259) are **injected by the consumer** (the app). This package never inspects the result `T`.
- **Transport / app / hostname literals.** Generic + transport-agnostic (ADR-0021); the app supplies origins. No MCP/A2A/LangChain/Vercel/wallet imports.

## Phase 0 behaviour (the seam)
With no `fedcm` strategy provided, `chooseSignIn` runs the `fallback` — **zero behaviour change** vs calling the launcher directly. Phase 1 (spec 264) injects the real FedCM RP strategy; this file's contract is unchanged.

## Vocabulary
**Owns:** `chooseSignIn`, `fedcmAvailable`, `SignInStrategy`. **Does not use:** `@modelcontextprotocol`, `a2a-js`, `langchain`, `@vercel/ai`, concrete hostnames (see `capability.manifest.json:forbiddenTerms`).

## Validate
`pnpm --filter @agenticprimitives/browser-identity build && pnpm --filter @agenticprimitives/browser-identity test`
