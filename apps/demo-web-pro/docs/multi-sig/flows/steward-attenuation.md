# Use case 4 — Steward → delegate → agent chain

> **Status:** stub. Cross-delegation substrate (`verifyCrossDelegation`)
> is open as system audit finding H5 in
> `docs/architecture/product-readiness-audit.md`. This flow lands
> after H5 closes; spec 207 § 11 references it as an open question.

Maps to spec 207 § 4.1 use case #4. User grants a steward primary
role with profile-read + limited-write authority. Steward
re-delegates a NARROWER scope to an agent. System proves the child
delegation is a subset of the parent (attenuation). Agent cannot
widen scope.

This walkthrough will cover:

1. The user → steward parent delegation (T2 Write tier).
2. Steward → agent child delegation with attenuated caveats.
3. The on-chain attenuation check: child caveats ⊆ parent caveats
   (no caveat removal, no widened bounds).
4. The audit trail showing the delegation chain.

Code: `apps/demo-web-pro/src/flows/steward-attenuation/` (lands
post-H5).
