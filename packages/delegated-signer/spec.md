# @agenticprimitives/delegated-signer — spec

The full design lives in
[`../../specs/276-kms-consumer-surface.md`](../../specs/276-kms-consumer-surface.md)
(decision KCS-D6).

This package is the generic core of an app's bespoke "named delegated signer"
orchestration: resolve a name to a Smart Agent (injected `agent-naming` client),
confirm the account (injected `agent-account` client), verify a delegation
chain's authority linkage (`@agenticprimitives/delegation`), and bind the result
to an operational signing key (`@agenticprimitives/key-custody`).

Architecture decisions:

- [ADR-0006](../../docs/architecture/decisions/0006-injected-context-pattern.md)
  — naming/account reach the network through INJECTED clients, so the package
  stays a pure, unit-testable leaf.
- [ADR-0021](../../docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md)
  — vertical/deploy specifics (TLDs, registries, Worker routes) live in apps,
  never here.
- [ADR-0013](../../docs/architecture/decisions/0013-no-silent-fallbacks.md)
  — fail-closed on any unresolved name, invalid account, or broken chain.

Do not edit a divergent copy here — edit the canonical spec.
