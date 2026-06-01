---
"@agenticprimitives/mcp-runtime": minor
---

R8.1 — closed ATL-SEC-02 (policy-by-convention → hard invariant) on
`withDelegation`'s production-strict gate.

Wave H1 made the wrapper production-by-default at RUNTIME (throws at
construction time if `classification` or `auditSink` is missing). R8.1
converts that runtime gate into a TYPE-LEVEL invariant via two public
overloads:

- `ProductionWithDelegationOpts` — `classification` + `auditSink` REQUIRED
  (the canonical shape for production code).
- `DevelopmentWithDelegationOpts` — `developmentMode: true` REQUIRED to
  explicitly opt out of the strict gate.

Existing call sites are unaffected: demo-mcp's three handlers already
pass `classification + auditSink + environment`, and the type system
routes them to the production overload. Tests that previously omitted
opts now require an explicit `{ developmentMode: true }`.

Runtime checks remain as defense-in-depth (consumers can still `as any`
past the type system). The audit's gap was the TYPE — not the runtime.

New public exports:
- `WithDelegationOpts` (union)
- `ProductionWithDelegationOpts`
- `DevelopmentWithDelegationOpts`
