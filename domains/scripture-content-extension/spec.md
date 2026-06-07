# @agenticprimitives/scripture-content-extension — spec

Design lives in [`../../specs/267-scripture-demo-vertical.md`](../../specs/267-scripture-demo-vertical.md)
(the scripture vertical) on top of
[`../../specs/266-verifiable-content-substrate.md`](../../specs/266-verifiable-content-substrate.md)
(the generic substrate).

Architecture decision:
[ADR-0033](../../docs/architecture/decisions/0033-content-agnostic-verifiable-content-firewall.md)
— content-agnostic core + the **`domains/` tier**: a reused vertical is a named
package OUTSIDE `packages/` (which stays pure substrate). Amends ADR-0021.

Do not edit a divergent copy here — edit the canonical spec.
