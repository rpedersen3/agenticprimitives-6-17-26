# ADR-0013 — No silent fallbacks in read/auth paths

**Status:** Accepted (2026-05-24).
**Related:** [ADR-0012](./0012-no-eth-getlogs-in-product-read-paths.md),
[spec 100](../../../specs/100-package-boundary-doctrine.md),
[spec 215](../../../specs/215-agent-naming.md),
[spec 222](../../../specs/222-ens-aligned-reverse-resolution.md).

---

## Context

`AgentNamingClient.reverseResolve` was written as a two-tier path: try the
spec/222 single-call `reverseResolveString`, and **if it returned empty or
threw, fall back** to a chunked `eth_getLogs` walk (`_reconstructName`). The
fallback was framed as back-compat for "older deployments."

In practice the fallback was a trap. On the current deployment a missing reverse
record (e.g. a primary name not yet backfilled) makes `reverseResolveString`
return `""` — which is the *correct* "no name" answer. But the empty return
silently triggered the fallback, and `_reconstructName` fired up to
`10 depths × 250 chunks` of `eth_getLogs`. Every `NameDisplay` re-render (with
React Query `staleTime` + refetch-on-focus) re-entered that walk, and the
browser drowned the worker's `/rpc` passthrough in requests until Alchemy
returned `429` — a continuous storm from what should have been one cheap read.

The fallback also violated [ADR-0012](./0012-no-eth-getlogs-in-product-read-paths.md):
it was the *only* `eth_getLogs` walker left in a product read path, kept alive
solely as the "transitional exception."

A fallback hides the real state of the system. When the primary path is correct,
the fallback is dead weight that occasionally fires and does the wrong, expensive
thing. When the primary path is broken, the fallback masks the breakage instead
of surfacing it. Either way the architecture stops telling the truth.

## Decision

> **Read and resolution paths have exactly one mechanism. No silent fallbacks.**
>
> A function does the correct thing once. If it has no answer, it returns
> `null` / empty / throws a typed error — it does NOT reach for a second,
> different, more expensive mechanism to paper over the gap.

Concretely:

- **One read path per fact.** Reverse-resolve is a single `reverseResolveString`
  view call. Forward-resolve is a single `resolveName`. No "try A, catch, try B."
- **Empty is an answer, not a trigger.** An empty/zero/`null` result from the
  canonical path is the result. Do not treat it as "primary failed, escalate."
- **No back-compat shims for deployments we don't run.** We control the
  contracts and redeploy is cheap ([feedback: architecture purity over compat]).
  Delete the old path; don't keep it as a fallback.
- **Fail closed and loud, not open and silent.** Auth, custody, and signature
  paths must not fall back to a weaker check when the strong one is unavailable.
- **A cache is a seed, not a fallback.** Reading an app cache first (e.g.
  `name-cache`) and skipping the network read when present is allowed — the
  cache holds the *same* answer the canonical read would produce, written by a
  canonical read at mint/claim/boot time. That is one mechanism with a memo, not
  two mechanisms.

### Forbidden

- `try { fastPath() } catch { slowDifferentPath() }` where the catch changes
  the *mechanism* (RPC method, contract, trust level), not just retries the same
  call.
- Empty/zero result from the canonical read silently escalating to a log walk,
  a wider scan, or a second contract.
- "Legacy path (older deployments only)" branches retained as runtime fallbacks.
- Downgrading an auth/verification check (strong → weak) when the strong path
  errors.

### Allowed

- A single canonical read returning `null`/empty as a first-class answer.
- Bounded **retries of the same call** on transient transport errors (the
  mechanism is unchanged; viem `retryCount`, `_submit` retry loop).
- Cache-first reads where the cache stores the canonical answer (see above).
- Typed errors that propagate to the caller for the caller to handle.

## Consequences

**Positive:**

- Removes the last `eth_getLogs` walker in any product read path — closes the
  [ADR-0012](./0012-no-eth-getlogs-in-product-read-paths.md) transitional
  exception.
- One mechanism is predictable: same RPC cost every time, no hidden
  storm-on-miss.
- Breakage surfaces immediately instead of being masked by a degraded path.

**Negative:**

- Addresses with no on-chain reverse record render as a truncated address
  rather than being reconstructed from history. Correct: no name set ⇒ no name
  shown. Backfill the primary name to fix it at the source.
- Removing back-compat branches means old, un-migrated deployments are
  unsupported. Acceptable under [feedback: architecture purity over compat] —
  redeploy instead.

## Cross-references

- [ADR-0012 — no `eth_getLogs` in product read paths](./0012-no-eth-getlogs-in-product-read-paths.md)
- [spec 222 — ENS-aligned reverse resolution](../../../specs/222-ens-aligned-reverse-resolution.md)
- `packages/agent-naming/src/client.ts` — `reverseResolve` (single call, no fallback)
