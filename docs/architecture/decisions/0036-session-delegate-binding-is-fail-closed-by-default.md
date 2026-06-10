# ADR-0036 — Session-delegate binding is fail-closed by default

**Status:** accepted (2026-06-10) · **Finding:** DEL-001 (Critical), [2026-06-09 independent package audit](../../audits/archive/2026-06-09/2026-06-09-independent-package-audit.md) + [P0-2 enforcement-ledger](../../audits/findings.yaml) · **Touches:** spec 270 v4 (connection-agnostic session binding), [ADR-0013](0013-no-silent-fallbacks.md) (one mechanism), [ADR-0011](0011-credential-recovery-and-re-association.md) (delegation ≠ credential)

## Context

`verifyDelegationToken` carries the full signed `delegation` in cleartext inside every token. A verifier that only checks "*some* session key signed these claims" lets anyone who OBSERVES a token re-mint it with their own session key and impersonate the delegator (DEL-001, the observe-and-re-mint vector).

Spec 270 v4 closed the *mechanism*: a `sessionDelegation` LEAF binds the presenting session key to the delegator's canonical SA — `leaf.delegator === delegation.delegator`, `leaf.delegate === presenting session key`, signed by that SA and validated through the `UniversalSignatureValidator` (ERC-1271 / ERC-6492 / ECDSA, so it holds for any connection strategy). `sessionDelegateBindingError` does the chain-free leaf checks; the USV does the signature check.

But the *default* was wrong. Binding was **opt-in** via `requireSessionDelegateBinding` (and a separate `strictSessionBinding` construction guard in mcp-runtime). A verifier that configured nothing silently accepted unbound tokens — the exact observe-and-re-mint class the leaf exists to close. Enforcement was therefore *per-source*: it held only where every route remembered to set the flag, backstopped by a deploy preflight that grepped for the chain. The enforcement-ledger gate (P0-2) correctly refused to call DEL-001 `production-enforced` while the library default was fail-open: a single forgotten flag reopened a Critical.

A fail-open default for a Critical-severity authorization check is a latent hole, not a configuration choice. Per [ADR-0013](0013-no-silent-fallbacks.md), a security-relevant path has one mechanism and it defaults to closed.

## Decision

**Invert the default: the session-delegate binding is ENFORCED unless explicitly opted out.**

- `verifyDelegationToken` enforces binding whenever `allowUnboundSessionToken` is falsy (the default). A token with no valid `sessionDelegation` leaf is rejected — `session-delegation required (DEL-001)` — with no flag needed.
- The opt-out is a single boolean, `allowUnboundSessionToken: true`. It is the **greppable escape hatch**: the only way to accept an unbound token, named so an audit can enumerate every caller that takes it.
- The prior flags are **removed**, not deprecated (architecture-purity doctrine — deletes over deprecations): `requireSessionDelegateBinding` and `strictSessionBinding` no longer exist in `delegation` or `mcp-runtime`. There is no "strict vs. lax" axis anymore — binding is the baseline; `allowUnboundSessionToken` is the one documented hole.
- `mcp-runtime` threads the same single opt-out through `McpResourceVerifyConfig.allowUnboundSessionToken` into `verifyDelegationToken`. A resource that configures nothing is safe by default.

The gate in `token.ts` is literally `if (!opts.allowUnboundSessionToken) { …enforce… }` — the absence of the flag is the secure state.

## Consequences

- **This is a breaking change for any caller that minted unbound tokens.** Two classes exist:
  - **Client-minted, leaf-bound tokens** (demo-jp → demo-a2a → demo-mcp vault path): already carry the leaf; they verify unchanged and are now protected even if a route's config is edited.
  - **Legacy / non-client-minted tokens** (trusted-relayer / persona paths, e.g. demo-mcp's documented C-1 persona hole): must set `allowUnboundSessionToken: true` explicitly, or they fail closed. demo-mcp does exactly this — default (binding enforced) for the vault server, opt-out ONLY on the persona config, with the C-1 acceptance noted inline.
- **DEL-001 → `production-enforced`.** Enforcement is now universal (the library guarantees it), not per-source (a convention each route had to remember). The deploy preflight that grepped for the binding chain is no longer the thing standing between us and a reopened Critical — the default is.
- **Tests prove the default.** The remint-attack regression (`remint-attack.test.ts`) and `verify-universal-validator.test.ts` now assert rejection with **no opt-in flag set**; the leafless-acceptance cases must set `allowUnboundSessionToken: true`, making every unbound path explicit in the test corpus too.
- No address/contract change — this is an off-chain verifier-default change. No redeploy required; package-version bump only.

## Alternatives rejected

- **Keep binding opt-in; rely on the deploy preflight + `strictSessionBinding` guard.** That is the pre-ADR state. It makes safety a property of *every consumer remembering a flag* plus a grep that can drift, rather than of the library. The enforcement-ledger (P0-2) explicitly refused to count that as production-enforced, and it was right to.
- **Deprecate `requireSessionDelegateBinding` (default-flip it but keep accepting it).** Leaves two names for one axis and a back-compat surface that invites "set it to false to make the error go away." Deletion forces every call site to confront the one honest question — *does this path accept unbound tokens, yes or no* — via the single `allowUnboundSessionToken` boolean.
- **Make binding mandatory with no opt-out at all.** Cleanest in principle, but the persona/trusted-relayer demo paths legitimately mint unbound tokens (a documented, scoped testnet hole — C-1). A no-opt-out world would either break those or force a fake leaf; the greppable boolean keeps the hole explicit and enumerable instead of hidden.
