# Use case 4 — Steward → delegate → agent chain

> **Status:** preview / blocked by H5. The route now visualizes the parent -> steward -> agent chain and marks runtime subset verification as the remaining blocker.

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

Code: `apps/demo-web-pro/src/flows/steward-attenuation/`.
